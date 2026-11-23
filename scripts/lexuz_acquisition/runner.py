"""Local coordinator. This program has no embedding, index or release operation."""
import argparse
import asyncio
import concurrent.futures
import contextlib
import errno
import hashlib
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import uuid
import weakref
from collections import OrderedDict, deque
from itertools import islice
from pathlib import Path

from .media import Media, OCR_CONFIG
from .input_cache import InputCache, cache_limits
from .discovery import DiscoveryQueue
from .connectivity import Connectivity
from .live import LiveProgress
from .compression import reader
from .shards import ExportInterrupted, Shards
from .comparison import comparison_navigation
from .card_templates import template_key, make_template, bind_template
from .network import Budget, Receiver, RequestFailure, ResourcePause, retry_delay, acquisition_timeouts
from .publisher import CARDS, PARSER_VERSIONS, TAXONOMY_URL, catalog_form, catalog_rows, catalog_page, document, parse_html, script_segments, refresh_rejected_language, publisher_navigation, supplementary_html_kind
from .store import Store, atomic_json, digest, encoded

REPO = Path(__file__).resolve().parents[2]
CONFIG = {'parser': PARSER_VERSIONS, 'ocr': OCR_CONFIG, 'chunk_policy': 'retrieval-chunk-v1',
          'target_tokens': 512, 'serializer': 'legal-embedding-input-v1+compact-v2', 'tokenizer': 'gpt-tokenizer-4.0.0/cl100k_base',
          'model': 'text-embedding-3-large', 'dimensions': 3072, 'ceiling': 8192,
          'transform': 'none'}
CONFIG_HASH = digest(encoded(CONFIG))


def stage_hash(kind):
    return digest(encoded({'parser': PARSER_VERSIONS.get(kind, 'media-v4'),
                           'input': {k: v for k, v in CONFIG.items() if k not in ('ocr', 'parser')} if kind in ('document', 'asset', 'member') else None,
                           'ocr': OCR_CONFIG if kind in ('asset', 'member') else None}))


def pdf_viewer(row):
    return '/pdfs/' in row['url'] and document(row['url']) is not None


def parse_retained(root, row):
    with reader(Path(root)/row['object_key']) as stream:
        payload = stream.read()
    context = json.loads(row['context'])
    if row['kind'] == 'catalog_search':
        reported, form = catalog_form(payload)
        return {'reported': reported, 'form': form}
    if row['kind'] == 'catalog_export':
        return {'catalog': catalog_rows(payload)}
    if row['kind'] == 'catalog_page':
        return catalog_page(payload)
    kind = supplementary_html_kind(row['url']) or ('document' if pdf_viewer(row) else row['kind'])
    result = parse_html(payload, row['url'], kind, context)
    receipt = json.loads(row['receipt'])
    final_url = receipt.get('final_url', row['url'])
    requested, returned = document(row['url']), document(final_url)
    if requested and returned and requested['source'] != returned['source']:
        result['publisher_alias'] = {'requested': requested, 'returned': returned, 'evidence': receipt.get('chain', [])}
        result['source'] = returned['source']
        result['discoveries'].append({'kind': 'document', 'url': returned['url'], 'context': returned, 'locator': 'http_redirect_alias'})
    return result


class InputWriter:
    def __init__(self, cache=None):
        self.cache = cache
        self.process = None
        self.lock = asyncio.Lock()

    @staticmethod
    def source(unit, title, identity, document_type=None):
        return {'snapshotProvisionId': identity + ':' + str(unit['ordinal']), 'sourceDocumentTitle': title,
                'documentType': document_type or 'publisher form not supplied', 'articleNumber': unit['locator'], 'articleTitle': None,
                'hierarchy': unit['hierarchy'], 'language': unit['language'], 'script': unit['script'], 'officialText': unit['text']}

    async def exchange(self, payload):
        async with self.lock:
            if self.process is None:
                self.process = await asyncio.create_subprocess_exec('node', '--import', 'tsx', 'scripts/lexuz-embedding-inputs.mts',
                    cwd=REPO / 'apps/platform', stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    limit=64*1024*1024)
            self.process.stdin.write(payload + b'\n')
            await self.process.stdin.drain()
            line = await self.process.stdout.readline()
            if not line:
                raise ValueError('embedding_input_worker_terminated')
            return json.loads(line)

    async def prepare(self, unit, title, identity, document_type=None):
        result = await self.exchange(encoded(self.source(unit, title, identity, document_type)).encode())
        if result.get('error'):
            raise ValueError(result['error'])
        return result['chunks']

    async def prepare_many(self, units, title, identity, document_type=None):
        """Reuse validated content across slots; batch remaining inputs in order."""
        owned, deferred = [], []
        try:
            results, batch, pending = [], [], []
            size = len(b'{"batch":[]}')

            async def flush():
                nonlocal size
                if not batch:
                    return
                response = await self.exchange(b'{"batch":[' + b','.join(batch) + b']}')
                if response.get('error'):
                    raise ValueError(response['error'])
                if len(response.get('results', [])) != len(batch):
                    raise ValueError('embedding_input_batch_count_mismatch')
                for (index, key, future), value in zip(pending, response['results'], strict=True):
                    results[index] = value
                    if key is not None:
                        self.cache.put(key, value)
                        self.cache.complete(key, value, future)
                batch.clear()
                pending.clear()
                size = len(b'{"batch":[]}')

            for unit in units:
                index, key, future = len(results), None, None
                results.append(None)
                try:
                    source = self.source(unit, title, identity, document_type)
                    if self.cache is not None and self.cache.eligible(source['snapshotProvisionId']):
                        neutral = encoded({k: v for k, v in source.items() if k != 'snapshotProvisionId'}).encode()
                        key = digest(neutral)
                        reused = self.cache.get(key, source['snapshotProvisionId'])
                        if reused is not None:
                            results[index] = reused
                            continue
                        future, owner = self.cache.reserve(key)
                        if not owner:
                            deferred.append((index, source['snapshotProvisionId'], future))
                            continue
                        owned.append((key, future))
                        payload = neutral[:-1] + b',"snapshotProvisionId":' + encoded(source['snapshotProvisionId']).encode() + b'}'
                    else:
                        payload = encoded(source).encode()
                except Exception as error:
                    results[index] = {'error': str(error)}
                    continue
                extra = len(payload) + bool(batch)
                if len(batch) == 64 or size + extra > 1024*1024:
                    await flush()
                if len(payload) + len(b'{"batch":[]}') > 1024*1024:
                    value = await self.exchange(payload)
                    results[index] = value
                    if key is not None:
                        self.cache.put(key, value)
                        self.cache.complete(key, value, future)
                else:
                    size += len(payload) + bool(batch)
                    batch.append(payload)
                    pending.append((index, key, future))
            await flush()
            # Flush owned requests before waiting on other slots, preventing
            # circular waits when two batches share different overlapping units.
            for index, snapshot, future in deferred:
                value = await asyncio.shield(future)
                results[index] = self.cache.reidentify(value, snapshot)
            return results
        finally:
            for key, future in owned:
                self.cache.complete(key, {'error': 'embedding_input_owner_interrupted'}, future)

    async def close(self):
        if self.process:
            self.process.stdin.close()
            try:
                await asyncio.wait_for(self.process.wait(), 10)
            except asyncio.TimeoutError:
                # No requests remain at coordinator shutdown. A lingering
                # serializer must not indefinitely prevent the checkpoint.
                with contextlib.suppress(ProcessLookupError):
                    self.process.kill()
                await self.process.wait()


class Coordinator:
    def __init__(self, store, media, reserve=10*1024**3, receiver=None):
        self.store, self.media = store, media
        self.budget = Budget(adaptive=store.setting('rate_mode') != 'fixed')
        self.receiver = receiver or Receiver(store, self.budget, reserve)
        self.connectivity = Connectivity(store, self.receiver)
        if receiver is not None:
            self.store.set('qualification', True)
        self.preparation_workers = store.setting('preparation_workers') or 4
        self.network_workers = store.setting('network_workers') or 40
        self.network_claims = deque()
        self.discovery_workers = store.setting('discovery_workers')
        if self.discovery_workers is None:
            self.discovery_workers = 2
        self.discovery = store.discovery = DiscoveryQueue(store, PARSER_VERSIONS['document'])
        input_cache_mib = store.setting('input_cache_mib')
        self.input_cache = InputCache(**cache_limits(64 if input_cache_mib is None else input_cache_mib))
        self.inputs = [InputWriter(self.input_cache) for _ in range(self.preparation_workers)]
        self.html_pool = None
        self.preparation_pool = None
        self.stop = False
        self.reserve = reserve
        self.started = time.monotonic()
        self.status = 'running'
        self.asset_locks = weakref.WeakValueDictionary()
        self.parse_locks = weakref.WeakValueDictionary()
        self.expanded_documents = OrderedDict()
        self.expansion_generation = store.rollback_generation

    def catalogs(self, phase):
        for lang in range(1, 5):
            self.store.enqueue('catalog_search', f'https://lex.uz/ru/search/all?lang={lang}',
                               {'phase': phase, 'language': lang}, identity=f'catalog:{phase}:{lang}:search')

    def discover(self, item, parent=None, locator=''):
        context = item.get('context', {})
        request_key = digest(encoded([item['kind'], item['url'], context['form'].get('__EVENTTARGET'), context['form'].get('__EVENTARGUMENT')])) if context.get('form') else None
        if item['kind'] == 'asset':
            # Storage/HTTP is shared by URL; text inputs keep contextual membership.
            request_key = digest(encoded(['asset', item['url'], context]))
            if parent:
                prior = self.store.db.execute('''SELECT w.id,w.context FROM work w JOIN edges e ON e.child=w.id
                    WHERE e.parent=? AND e.locator=? AND w.kind='asset' AND w.url=?''', (parent, locator, item['url'])).fetchone()
                if prior:
                    old = json.loads(prior['context'])
                    if all(old.get(key) == context.get(key) for key in ('source', 'edition', 'hierarchy', 'orientation')):
                        request_key = prior['id']
                        self.store.revise_context(request_key, context)
        identity = self.store.enqueue(item['kind'], item['url'], context, parent, locator, identity=request_key)
        if item['kind'] == 'document':
            # Incoming edges above are always retained. Only the already
            # completed, source-invariant six-card expansion can be reused.
            if self.expansion_generation != self.store.rollback_generation:
                self.expanded_documents.clear()
                self.expansion_generation = self.store.rollback_generation
            if identity in self.expanded_documents:
                self.expanded_documents.move_to_end(identity)
            else:
                ref = document(item['url'])
                for card in CARDS:
                    self.store.enqueue('card', f'https://lex.uz/actinfo/{card}/{ref["source"]}',
                                       {'source': ref['source'], 'surface': card}, identity, 'publisher:' + card)
                self.expanded_documents[identity] = None
                if len(self.expanded_documents) > 32768:
                    self.expanded_documents.popitem(last=False)
        return identity

    async def network_worker(self):
        while not self.stop:
            if not await self.connectivity.allow(lambda: self.stop):
                break
            if not self.network_claims:
                self.network_claims.extend(self.store.claim_network_batch())
            row = self.network_claims.popleft() if self.network_claims else None
            if not row:
                await asyncio.sleep(.1)
                continue
            try:
                context = json.loads(row['context'])
                comparison = comparison_navigation(row['url'])
                if comparison:
                    with self.store.batch():
                        for item in comparison['discoveries']:
                            self.discover(item, row['id'], item['locator'])
                    self.store.prepared(row['id'], comparison, stage_hash(row['kind']), 0)
                    await asyncio.sleep(0)
                    continue
                if row['kind'] == 'asset':
                    async with self.asset_locks.setdefault(row['url'], asyncio.Lock()):
                        prior = None if self.store.setting('refetch:'+row['id']) else self.store.db.execute("SELECT * FROM work WHERE url=? AND id<>? AND object_key IS NOT NULL AND bytes>0 AND json_extract(receipt,'$.status') IN (200,404,410) ORDER BY json_extract(receipt,'$.observed') DESC LIMIT 1", (row['url'], row['id'])).fetchone()
                        if prior:
                            receipt = {**json.loads(prior['receipt']), 'reused_from': prior['id']}
                            self.store.receipt(row['id'], prior['raw_hash'], prior['object_key'], prior['bytes'], receipt)
                            if receipt['status'] != 200:
                                raise RequestFailure(f'http_{receipt["status"]}')
                        else:
                            if not await self.connectivity.allow(lambda: self.stop):
                                self.store.return_network_batch([row])
                                continue
                            await self.receiver.fetch(row)
                            self.store.set('refetch:'+row['id'], None)
                else:
                    if not await self.connectivity.allow(lambda: self.stop):
                        self.store.return_network_batch([row])
                        continue
                    await self.receiver.fetch(row, 'POST' if context.get('form') else 'GET', context.get('form'))
            except ResourcePause as error:
                self.store.fail(row['id'], str(error))
                self.store.release(row['id'], 'pending')
                self.status, self.stop = 'paused_resource', True
            except RequestFailure as error:
                if error.transient and str(error).startswith(('transport:', 'http_')) and await self.connectivity.failure_is_outage():
                    self.store.defer_outage(row['id'], str(error))
                    continue
                self.store.fail(row['id'], str(error), error.transient, retry_delay(row['attempts'], error.retry_after))
                if row['kind'] == 'catalog_export' and self.store.get(row['id'])['state'] == 'blocked':
                    self.catalog_fallback(row)
            except Exception as error:
                self.store.fail(row['id'], f'network_internal:{error}')

    def parse(self, row):
        if row['kind'] == 'asset' and publisher_navigation(row['url']):
            return {'units': [], 'gaps': [], 'scope_exclusion': {'reason': 'publisher_homepage_navigation', 'url': row['url']}}
        if row['kind'] in ('asset', 'member') and not pdf_viewer(row) and not supplementary_html_kind(row['url']):
            return self.media.prepare(self.store.read_object(row['object_key']), json.loads(row['context']))
        return parse_retained(self.store.root, row)

    def catalog_fallback(self, row):
        context = json.loads(row['context'])
        search = self.store.get(f'catalog:{context["phase"]}:{context["language"]}:search')
        if not search or not search['object_key']:
            return
        identity = self.store.enqueue('catalog_page', row['url'], {**context, 'page': 0, 'recovery_for': row['id']},
                                      row['id'], 'advertised_pagination_fallback', identity=row['id']+':page:0')
        if self.store.get(identity)['state'] == 'pending':
            self.store.receipt(identity, search['raw_hash'], search['object_key'], search['bytes'], json.loads(search['receipt']))

    async def parse_cached(self, row, publication=None):
        comparison = comparison_navigation(row['url'])
        if comparison:
            return comparison
        context = json.loads(row['context'])
        supplementary = supplementary_html_kind(row['url'])
        html_surface = pdf_viewer(row) or publisher_navigation(row['url']) or supplementary
        if row['kind'] in ('asset', 'member') and not html_surface:
            relevant = ['media-v4', row['raw_hash'], context.get('language'), context.get('orientation'), OCR_CONFIG]
        else:
            relevant = [row['raw_hash'], row['kind'], row['url'], row['context'],
                        PARSER_VERSIONS[supplementary or ('document' if html_surface else row['kind'])]]
        parse_key = digest(encoded(relevant))
        shared_key = template_key(row, PARSER_VERSIONS['card'])
        async with self.parse_locks.setdefault(shared_key or parse_key, asyncio.Lock()):
            if shared_key:
                shared = self.store.db.execute('SELECT object_key FROM cache WHERE key=?', (shared_key,)).fetchone()
                if shared:
                    self.store.event(row['id'], 'parse_reuse', {'key': shared_key, 'scope': 'empty_card_template'})
                    cached_result = await self.preparation_io(lambda: json.loads(self.store.read_object(shared[0])))
                    return bind_template(cached_result, row)
            cached = self.store.db.execute('SELECT object_key FROM cache WHERE key=?', (parse_key,)).fetchone()
            if cached:
                self.store.event(row['id'], 'parse_reuse', {'key': parse_key})
                cached_result = await self.preparation_io(lambda: json.loads(self.store.read_object(cached[0])))
                return refresh_rejected_language(cached_result)
            if self.html_pool is not None and (row['kind'] not in ('asset', 'member') or pdf_viewer(row) or supplementary):
                result = await asyncio.get_running_loop().run_in_executor(self.html_pool, parse_retained, str(self.store.root), row)
            else:
                result = await self.preparation_io(self.parse, row)
            if not result.get('gaps'):
                template = make_template(row, result) if shared_key else None
                if template is None and row['kind'] in ('card', 'asset', 'member', 'detail', 'surface') and not result.get('units') and 'members' not in result:
                    # Metadata has no chunk transformation. Publish the same
                    # bytes for its parse cache and completed preparation so
                    # the immutable-object fast path avoids a second fsync.
                    result['chunks'] = []
                key = await self.publish_result(template if template is not None else result)
                if (publication is not None and template is None and row['kind'] in ('card', 'asset', 'member', 'detail', 'surface')
                        and not result.get('units') and 'members' not in result):
                    # Unitless metadata is already the exact final artifact.
                    # Its cache entry and completion receipt can become durable
                    # together, after the discovered dependencies are recorded.
                    publication.update(object_key=key, cache_entry=(parse_key, key))
                    return result
                self.store.db.execute('INSERT OR REPLACE INTO cache VALUES (?,?)',
                                      (shared_key if template is not None else parse_key, key))
                self.store.db.commit()
            return result

    async def preparation_io(self, function, *args):
        # Long media jobs and completed-artifact writes must not queue behind
        # every download chunk in the loop's default filesystem executor.
        return await asyncio.get_running_loop().run_in_executor(self.preparation_pool, function, *args)

    async def publish_result(self, result):
        # Object encoding/compression/fsync do not touch SQLite. Keep them off
        # the coordinator loop; receipt commits still belong to its sole writer.
        return await self.preparation_io(lambda: self.store.put(encoded(result).encode()))

    async def record_catalog(self, row, context, rows):
        for offset in range(0, len(rows), 100):
            with self.store.batch():
                for item in rows[offset:offset+100]:
                    signature = digest(item['metadata'])
                    self.store.db.execute('INSERT OR REPLACE INTO catalog VALUES (?,?,?,?,?)',
                        (context['phase'], context['language'], item['source'], item['url'], signature))
                    initial = self.store.db.execute("SELECT signature FROM catalog WHERE phase='initial' AND language=? AND source=?",
                                                    (context['language'], item['source'])).fetchone()
                    identity = self.discover({'kind': 'document', 'url': item['url'], 'context': {'source': item['source'], 'catalog_metadata': item['metadata']}}, row['id'], item['publisher_url'])
                    if context['phase'] == 'final' and initial and initial[0] != signature:
                        self.store.enqueue('document', item['url'], {'source': item['source'], 'change_evidence': signature}, row['id'], 'changed_catalog_entry', identity=identity+':final')
            await asyncio.sleep(0)

    async def prepare_worker(self, inputs=None, lane=None):
        inputs = inputs or self.inputs[0]
        preferred = lane if lane is not None else 0
        next_row = None
        while not self.stop:
            row = next_row or self.store.claim('prepare', lane=preferred)
            next_row = None
            if not row:
                await asyncio.sleep(.1)
                continue
            if lane is None:
                # With fewer than three workers, rotate preferences rather than
                # permanently reserving the available slots for only two kinds.
                preferred = (preferred + 1) % 3
            start = time.monotonic()
            try:
                if shutil.disk_usage(self.store.root).free < self.reserve:
                    raise ResourcePause('disk_reserve_breach')
                publication = {}
                result = await self.parse_cached(row, publication)
                if self.store.get(row['id'])['context'] != row['context']:
                    continue
                context = json.loads(row['context'])
                if row['kind'] == 'catalog_search':
                    self.store.enqueue('catalog_export', row['url'], {**context, **result}, row['id'], 'full-export',
                                       identity=f'catalog:{context["phase"]}:{context["language"]}:export')
                elif row['kind'] in ('catalog_export', 'catalog_page'):
                    rows = result.pop('catalog')
                    await self.record_catalog(row, context, rows)
                    count = self.store.db.execute('SELECT count(*) FROM catalog WHERE phase=? AND language=?', (context['phase'], context['language'])).fetchone()[0]
                    result.update(reported=context['reported'], count=count)
                    if result.get('next_form'):
                        if not rows:
                            raise ValueError('catalog_pagination_empty_page')
                        page = context['page']+1
                        self.store.enqueue('catalog_page', row['url'], {**context, 'page': page, 'form': result.pop('next_form')}, row['id'], 'next_page', identity=context['recovery_for']+f':page:{page}')
                    else:
                        with self.store.db:
                            self.store.db.execute('INSERT OR REPLACE INTO partitions VALUES (?,?,?,?,?)',
                                (context['phase'], context['language'], context['reported'], count, row['id']))
                        if count != context['reported']:
                            if row['kind'] == 'catalog_export':
                                self.catalog_fallback(row)
                            raise ValueError(f'catalog_partition_incomplete:expected={context["reported"]}:actual={count}')
                        if context.get('recovery_for'):
                            self.store.prepared(context['recovery_for'], {'recovered_by': row['id'], 'count': count}, stage_hash('catalog_export'), 0)
                else:
                    discoveries = [] if row['kind'] == 'document' and self.discovery.expanded(row) else result.get('discoveries', [])
                    for offset in range(0, len(discoveries), 100):
                        with self.store.batch():
                            for item in discoveries[offset:offset+100]:
                                self.discover(item, row['id'], item['locator'])
                        await asyncio.sleep(0)
                    for member in result.pop('members', []):
                        member_context = {**context, 'member': member['name']}
                        identity = self.store.enqueue('member', row['url'] + '#member:' + str(member['ordinal']),
                            member_context, row['id'], member['name'], identity=digest(encoded([row['id'], member['ordinal']])))
                        self.store.revise_context(identity, member_context)
                        if self.store.get(identity)['state'] == 'pending':
                            self.store.receipt(identity, member['sha256'], member['object_key'], member['bytes'],
                                               {'archive_work': row['id'], 'member': member['name'], 'status': 200})
                    result['chunks'] = []
                    units = (segment for original in result.get('units', []) for segment in script_segments(original))
                    while batch := list(islice(units, 64)):
                        if row['kind'] in ('asset', 'member'):
                            batch = [{**unit, 'hierarchy': context.get('hierarchy', []) + unit['hierarchy']} for unit in batch]
                        responses = await inputs.prepare_many(batch,
                            result.get('title') or context.get('title') or f'Lex.uz {context.get("source", row["url"])}',
                            row['id'], result.get('document_form') or context.get('document_form'))
                        for unit, response in zip(batch, responses, strict=True):
                            if response.get('error'):
                                result.setdefault('gaps', []).append(f'unit:{unit["locator"]}:{response["error"]}')
                                continue
                            for chunk in response['chunks']:
                                chunk.update(work=row['id'], locator=unit['locator'], method=unit['method'])
                            result['chunks'].extend(response['chunks'])
                if self.store.get(row['id'])['context'] == row['context']:
                    key = publication.get('object_key') or await self.publish_result(result)
                    # Publication yields: a parent correction can supersede this
                    # result while its immutable object is being written.
                    if self.store.get(row['id'])['context'] == row['context']:
                        next_row = self.store.prepared_and_claim(
                            row['id'], result, stage_hash(row['kind']), time.monotonic()-start,
                            key, lane=preferred, claim_next=not self.stop,
                            cache_entry=publication.get('cache_entry'))
                # A corrected parent may supersede an in-flight preparation.
                # revise_context already queued its retained raw bytes again.
            except ResourcePause:
                if self.store.get(row['id'])['context'] == row['context']:
                    self.store.release(row['id'], 'acquired')
                self.status, self.stop = 'paused_resource', True
            except Exception as error:
                if self.store.get(row['id'])['context'] != row['context']:
                    continue
                self.store.fail(row['id'], f'preparation:{error}')
                if 'publisher_challenge' in str(error):
                    self.status, self.stop = 'interrupted', True
                    self.store.set('pause_reason', 'publisher_challenge; resolve source access before resume')

    async def discovery_worker(self):
        while not self.stop:
            row = self.discovery.claim()
            if row is None:
                await asyncio.sleep(.1)
                continue
            try:
                if shutil.disk_usage(self.store.root).free < self.reserve:
                    raise ResourcePause('disk_reserve_breach')
                result = await self.parse_cached(row)
                discoveries = [] if self.discovery.expanded(row) else result.get('discoveries', [])
                for offset in range(0, len(discoveries), 100):
                    if not self.discovery.current(row):
                        break
                    with self.store.batch():
                        for item in discoveries[offset:offset+100]:
                            self.discover(item, row['id'], item['locator'])
                    await asyncio.sleep(0)
                self.discovery.finish(row)
            except ResourcePause:
                self.status, self.stop = 'paused_resource', True
                # Active discovery is recovered on resume; no content receipt
                # is changed or falsely completed by a storage pause.
            except Exception as error:
                self.discovery.finish(row, str(error))
                if 'publisher_challenge' in str(error):
                    self.status, self.stop = 'interrupted', True
                    self.store.set('pause_reason', 'publisher_challenge; resolve source access before resume')

    async def run(self, bounded=False):
        # Preparation coroutines bound submitted CPU work across both executors.
        # Pure HTML uses processes to avoid the GIL; media shares one GPU worker.
        loop = asyncio.get_running_loop()
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=self.preparation_workers)
        loop.set_default_executor(pool)
        self.store.set('configuration', CONFIG)
        self.store.set('artifact_storage_profile', {
            'raw': 'zstd-or-one-level-edition-delta-v1',
            'ocr': 'qualified-lossless-webp-v1-with-original-fallback',
            'handoff': 'schema-4; URL locality; zstd-8MiB-window'})
        code_files = sorted(Path(__file__).parent.glob('*.py')) + [REPO/'apps/platform/scripts/lexuz-embedding-inputs.mts']
        self.store.set('code_hash', digest(b''.join(path.read_bytes() for path in code_files if not path.name.startswith(('test_', 'qualify')))))
        kinds = [row[0] for row in self.store.db.execute('SELECT DISTINCT kind FROM work INDEXED BY work_url')]
        self.store.invalidate_stages({kind: stage_hash(kind) for kind in kinds})
        self.discovery.seed()
        self.store.set('status', 'running')
        if not self.store.setting('inventory_started') and not bounded:
            self.catalogs('initial')
            self.store.set('inventory_started', True)
        if not bounded:
            self.store.enqueue('taxonomy', TAXONOMY_URL, {'scheme': 'LBC', 'provenance': 'publisher advanced-search selector'})
        last = 0
        with (concurrent.futures.ProcessPoolExecutor(max_workers=self.preparation_workers) as html_pool,
              concurrent.futures.ThreadPoolExecutor(max_workers=self.preparation_workers,
                                                    thread_name_prefix='preparation-io') as preparation_pool):
            self.html_pool = html_pool
            self.preparation_pool = preparation_pool
            if self.media is not None:
                self.media.render_pool = html_pool
            try:
                return await self.run_workers(bounded, last)
            finally:
                self.html_pool = None
                self.preparation_pool = None
                if self.media is not None:
                    self.media.render_pool = None

    async def run_workers(self, bounded, last):
        reporting = None
        previous_requests, previous_request_time = 0, time.monotonic()
        async with self.receiver, LiveProgress(self.store, lambda: 'stopping' if self.stop else self.status,
                                              metrics=getattr(getattr(self.receiver, 'metrics', None), 'snapshot', None)):
            tasks = [asyncio.create_task(self.network_worker()) for _ in range(self.network_workers)]
            tasks += [asyncio.create_task(self.prepare_worker(inputs, lane=index % 3 if len(self.inputs) >= 3 else None))
                      for index, inputs in enumerate(self.inputs)]
            tasks += [asyncio.create_task(self.discovery_worker()) for _ in range(self.discovery_workers)]
            try:
                while not self.stop:
                    checkpoint_request = self.store.root/'checkpoint-request.json'
                    if checkpoint_request.exists():
                        self.status, self.stop = 'interrupted', True
                        checkpoint_request.unlink()
                        break
                    active = self.store.db.execute("SELECT 1 FROM work WHERE state IN ('pending','fetching','acquired','preparing') LIMIT 1").fetchone()
                    if not active:
                        if not bounded and not self.store.setting('final_catalog_started'):
                            self.catalogs('final')
                            self.store.set('final_catalog_started', True)
                        else:
                            break
                    if reporting is not None and reporting.done():
                        report = reporting.result()
                        request_time = time.monotonic()
                        request_interval = max(.001, request_time-previous_request_time)
                        report.update(target_rps=self.budget.rate, requests=self.budget.requests,
                                      measured_request_rps=self.budget.requests/max(1, time.monotonic()-self.started),
                                      request_rps_interval=(self.budget.requests-previous_requests)/request_interval,
                                      request_interval_seconds=request_interval,
                                      ocr_calls=self.media.calls, ocr_reuse=self.media.reuses,
                                      input_cache_hits=self.input_cache.hits, input_cache_misses=self.input_cache.misses,
                                      input_cache_bytes=self.input_cache.bytes, input_cache_coalesced=self.input_cache.coalesced,
                                      input_cache_capacity_bytes=self.input_cache.max_bytes,
                                      input_cache_entries=len(self.input_cache.entries), input_cache_evictions=self.input_cache.evictions)
                        print(encoded(report), flush=True)
                        previous_requests, previous_request_time = self.budget.requests, request_time
                        reporting = None
                        last = time.monotonic()
                    if reporting is None and time.monotonic()-last >= (self.store.setting('status_interval') or 60):
                        # Full coverage summaries can scan a large manifest. A
                        # separate read-only snapshot leaves workers and the
                        # checkpoint loop responsive while the report is built.
                        reporting = asyncio.create_task(asyncio.to_thread(status_snapshot, self.store.root, False))
                    await asyncio.sleep(.2)
            finally:
                self.stop = True
                # Let in-flight transfers finish or hit finite read-idle timeouts.
                await asyncio.gather(*tasks)
                self.store.return_network_batch(self.network_claims)
                self.network_claims.clear()
                await asyncio.gather(*(inputs.close() for inputs in self.inputs))
                if reporting is not None:
                    await reporting
        if self.status == 'running':
            self.status = 'qualified_fixture' if bounded else 'completed'
        self.store.set('status', self.status)
        self.store.set('last_checkpoint', time.time())
        if self.status in ('paused_resource', 'interrupted'):
            report = {**progress_status(self.store), 'state': self.status, 'checkpoint': 'manifest.sqlite',
                      'stop_boundary': 'no embeddings or serving changes'}
            atomic_json(self.store.root/'checkpoint.json', report)
            return report
        return self.export_result(bounded)

    def export_result(self, bounded):
        return export(self.store, bounded)


def status_snapshot(root, coverage=True):
    started = time.monotonic()
    with Store(root, recover=False) as reader:
        reader.db.execute('BEGIN')
        report = status(reader) if coverage else progress_status(reader)
    report['report_seconds'] = time.monotonic() - started
    return report


def progress_status(store):
    """Live counters only; full completeness reconciliation belongs to status/export."""
    observed = time.time()
    queues = store.counts()
    total = sum(queues.values())
    return {'build_id': store.setting('build_id'), 'status': store.setting('status'),
            'observed_at': observed, 'queues': queues, 'discovered_work_total': total,
            'connectivity': store.setting('connectivity') or {'state': 'online'},
            'progress_percent': {key: round(100*value/total, 2) if total else 0 for key, value in queues.items()},
            'progress_scope': 'Currently discovered work; denominator grows with discovery. Done excludes blocked and excluded work.',
            'report_scope': 'live_progress; use status or final export for full coverage',
            'elapsed_seconds': round(observed-(store.setting('started') or observed)),
            'free_bytes': shutil.disk_usage(store.root).free,
            'held_network_kinds': store.setting('network_holds') or [],
            'network_workers': store.setting('network_workers') or 40,
            'preparation_workers': store.setting('preparation_workers') or 4,
            'discovery_workers': store.setting('discovery_workers') if store.setting('discovery_workers') is not None else 2,
            'discovery_queue': dict(store.db.execute('SELECT state,count(*) FROM discovery GROUP BY state')) if store.db.execute("SELECT 1 FROM sqlite_master WHERE name='discovery'").fetchone() else {},
            'discovery_per_second_last_60s': store.db.execute("SELECT count(*) FROM events WHERE stage='discovery' AND observed>?", (observed-60,)).fetchone()[0]/60,
            'prepared_per_second_last_60s': store.db.execute("SELECT count(*) FROM events WHERE stage='prepare' AND observed>?", (observed-60,)).fetchone()[0]/60,
            'useful_rps_last_60s': store.db.execute("SELECT count(*) FROM events WHERE stage='receive' AND observed>? AND json_extract(detail,'$.status')=200 AND json_extract(detail,'$.bytes')>0", (observed-60,)).fetchone()[0]/60}


def status(store):
    observed = time.time()
    queues = store.counts()
    total = sum(queues.values())
    progress = {state: round(100 * count / total, 2) if total else 0 for state, count in queues.items()}
    totals = store.db.execute('SELECT coalesce(sum(bytes),0),coalesce(sum(elapsed),0),coalesce(sum(repeats),0) FROM work').fetchone()
    elapsed = max(1, observed-(store.setting('started') or observed))
    acquired_count = store.db.execute('SELECT count(*) FROM work WHERE object_key IS NOT NULL').fetchone()[0]
    pending_count = store.db.execute("SELECT count(*) FROM work WHERE state IN ('pending','fetching')").fetchone()[0]
    useful = store.db.execute("SELECT count(*) FROM events WHERE stage='receive' AND observed>? AND json_extract(detail,'$.status')=200 AND json_extract(detail,'$.bytes')>0", (observed-60,)).fetchone()[0]
    prepared = store.db.execute("SELECT count(*) FROM events WHERE stage='prepare' AND observed>?", (observed-60,)).fetchone()[0]
    # Summaries are committed by preparation. Status never reopens source files or
    # counts repeated attempts and shared asset contexts as new physical pages.
    page_counts = store.db.execute('''
        SELECT coalesce(sum(pages),0), coalesce(sum(unknown),0) FROM (
          SELECT w.raw_hash,
            max(CASE WHEN json_extract(e.detail,'$.raw_hash')=w.raw_hash THEN json_extract(e.detail,'$.pages') END) AS pages,
            max(json_extract(e.detail,'$.raw_hash') IS NOT w.raw_hash OR json_extract(e.detail,'$.pages') IS NULL) AS unknown
          FROM work w JOIN events e ON e.id=(
            SELECT max(id) FROM events WHERE work=w.id AND stage='prepare')
          WHERE w.kind IN ('asset','member') GROUP BY w.raw_hash)''').fetchone()
    return {'build_id': store.setting('build_id'), 'status': store.setting('status'), 'queues': queues,
            'observed_at': observed,
            'connectivity': store.setting('connectivity') or {'state': 'online'},
            'progress_percent': progress, 'discovered_work_total': total,
            'progress_scope': 'Currently discovered work; denominator grows with discovery. Done excludes blocked and excluded work.',
            'rate_mode': store.setting('rate_mode') or 'adaptive',
            'status_interval_seconds': store.setting('status_interval') or 60,
            'network_workers': store.setting('network_workers') or 40,
            'preparation_workers': store.setting('preparation_workers') or 4,
            'held_network_kinds': store.setting('network_holds') or [],
            'acquired_bytes': totals[0], 'preparation_seconds': totals[1], 'repeat_work': totals[2],
            'elapsed_seconds': elapsed, 'free_bytes': shutil.disk_usage(store.root).free,
            'observed_bytes_per_second': totals[0]/elapsed,
            'useful_rps_last_60s': useful/60, 'prepared_per_second_last_60s': prepared/60,
            'estimated_remaining_acquisition_bytes': int(pending_count * totals[0]/acquired_count) if acquired_count else None,
            'cpu_seconds': os.times().user + os.times().system,
            'acquisition_timeouts': store.setting('acquisition_timeouts'),
            'unique_acquired_assets': store.db.execute("SELECT count(DISTINCT raw_hash) FROM work WHERE kind IN ('asset','member') AND state<>'excluded' AND bytes>0 AND json_extract(receipt,'$.status')=200").fetchone()[0],
            'unique_prepared_pages': page_counts[0], 'assets_without_page_summary': page_counts[1],
            'edition_coverage': [dict(row) for row in store.db.execute("SELECT CASE WHEN json_extract(context,'$.edition') IS NULL THEN 'current' ELSE 'historical' END AS edition,state,count(*) AS count FROM work WHERE kind='document' GROUP BY edition,state")],
            'card_surface_coverage': [dict(row) for row in store.db.execute("SELECT kind,coalesce(json_extract(context,'$.surface'),'discovered') AS surface,state,count(*) AS count FROM work WHERE kind IN ('card','surface','detail') GROUP BY kind,surface,state")],
            'source_ids': store.db.execute("SELECT count(DISTINCT json_extract(context,'$.source')) FROM work WHERE kind='document'").fetchone()[0],
            'coverage': [dict(row) for row in store.db.execute('SELECT kind,state,count(*) AS count FROM work GROUP BY kind,state')],
            'forecast_scope': 'Discovered work only; unseen editions/assets have no volume estimate.'}


def export(store, bounded=False):
    try:
        with contextlib.ExitStack() as resources:
            return export_records(store, bounded, resources)
    except (ResourcePause, ExportInterrupted, OSError) as error:
        if isinstance(error, OSError) and error.errno != errno.ENOSPC and getattr(error, 'winerror', None) != 112:
            raise
        store.db.rollback()
        state = 'interrupted' if isinstance(error, ExportInterrupted) else 'paused_resource'
        if state == 'interrupted':
            (store.root/'checkpoint-request.json').unlink(missing_ok=True)
        store.set('status', state)
        store.set('last_checkpoint', time.time())
        report = {**progress_status(store), 'state': state, 'reason': str(error),
                  'checkpoint': 'manifest.sqlite', 'stage': 'export',
                  'stop_boundary': 'no embeddings or serving changes'}
        atomic_json(store.root/'checkpoint.json', report)
        return report


def export_records(store, bounded, resources):
    # Consume validation receipts. Do not rehash/reparse/OCR raw objects here.
    frozen = store.setting('frozen')
    if frozen:
        store.set('status', frozen['state'])
        return frozen
    last_export = store.setting('last_export')
    last_event = store.db.execute('SELECT max(id) FROM events').fetchone()[0]
    if last_export and last_export['event'] == last_event:
        store.set('status', last_export['report']['state'])
        return last_export['report']
    root = store.root / 'handoff'
    root.mkdir(exist_ok=True)
    names = ('inventory', 'prepared', 'chunks', 'inputs', 'membership', 'relationships', 'taxonomy', 'unresolved')
    shards = {name: Shards(root, name) for name in names}
    for shard in shards.values():
        resources.callback(shard.abort)
    store.db.executescript('DROP TABLE IF EXISTS exported_inputs; CREATE TABLE exported_inputs(hash BLOB PRIMARY KEY, tokens INTEGER) WITHOUT ROWID;')
    gaps = chunks = memberships = token_total = 0
    # work_url supplies the family ordering without a corpus-wide sort.
    # Keep complete edition identities; locality only improves compression.
    for row in store.db.execute('SELECT * FROM work ORDER BY url,kind,id'):
        row = dict(row)
        shards['inventory'].write({**row, 'context': json.loads(row['context']), 'receipt': json.loads(row['receipt']) if row['receipt'] else None})
        if row['state'] not in ('done', 'excluded'):
            gaps += 1
            shards['unresolved'].write({'work': row['id'], 'kind': row['kind'], 'url': row['url'], 'state': row['state'],
                'reason': row['error'], 'attempts': row['attempts'], 'evidence': row['object_key'],
                'remedy': 'Correct the reported acquisition/parser/model issue, then resume --retry this work ID --reason the remedy.'})
        if not row['prepared_key']:
            continue
        prepared = json.loads(store.read_object(row['prepared_key']))
        for node in prepared.get('taxonomy', []):
            shards['taxonomy'].write({'work': row['id'], **node})
        output_chunks = prepared.pop('chunks', [])
        shards['prepared'].write({'work': row['id'], **prepared})
        for entry in output_chunks:
            chunk, input_hash = entry['chunk'], entry['inputHash']
            shards['chunks'].write({**chunk, 'work': row['id'], 'locator': entry['locator'], 'method': entry['method']})
            shards['membership'].write({'work': row['id'], 'chunk': chunk['id'], 'input': input_hash})
            inserted = store.db.execute('INSERT OR IGNORE INTO exported_inputs VALUES (?,?)', (bytes.fromhex(input_hash), chunk['embeddingTokenCount'])).rowcount
            if inserted:
                shards['inputs'].write({k: v for k, v in entry.items() if k not in ('chunk', 'work', 'locator', 'method') } | {'tokens': chunk['embeddingTokenCount']})
                token_total += chunk['embeddingTokenCount']
            chunks += 1
            memberships += 1
    for row in store.db.execute('SELECT * FROM edges ORDER BY parent,child,locator'):
        shards['relationships'].write(dict(row))
    partitions = [dict(row) for row in store.db.execute('SELECT * FROM partitions')]
    if not bounded:
        if len(partitions) != 8 or any(row['reported'] != row['count'] for row in partitions):
            gaps += 1
            shards['unresolved'].write({'reason': 'catalog_closure_incomplete', 'partitions': partitions})
        for row in store.db.execute("SELECT DISTINCT source FROM catalog WHERE phase='initial' EXCEPT SELECT DISTINCT source FROM catalog WHERE phase='final'"):
            gaps += 1
            shards['unresolved'].write({'reason': 'catalog_identity_disappeared_requires_reconciliation', 'source': row[0]})
    orphan = store.db.execute('SELECT count(*) FROM edges e LEFT JOIN work w ON e.child=w.id LEFT JOIN work p ON e.parent=p.id WHERE w.id IS NULL OR p.id IS NULL').fetchone()[0]
    gaps += orphan
    for shard in shards.values():
        shard.close()
    operational = store.setting('status')
    state = operational if operational in ('paused_resource', 'interrupted') else ('blocked' if gaps else ('fixture_ready' if bounded or store.setting('qualification') else 'preembedding_ready'))
    report = {**status(store), 'schema_version': 4, 'state': state, 'configuration': CONFIG, 'configuration_hash': CONFIG_HASH,
              'artifact_storage': {'independent_objects': ['gzip', 'zstd'],
                                   'edition_delta': 'zstd-edition-delta-v1; one independent retained base; exact decoded SHA-256',
                                   'ocr_images': ['original-gzip', 'webp-lossless-v1; exact RGBA pixels and qualified PNG metadata']},
              'code_hash': store.setting('code_hash'),
              'observation_window': [store.setting('started'), time.time()], 'partitions': partitions,
              'unresolved_count': gaps, 'chunks': chunks, 'memberships': memberships,
              'unique_inputs': store.db.execute('SELECT count(*) FROM exported_inputs').fetchone()[0], 'unique_input_tokens': token_total,
              'shards': {name: shard.receipts for name, shard in shards.items()},
              'stop_boundary': 'validated_embedding_inputs; no embedding requests, vectors, indexes or serving changes',
              'snapshot_limit': 'Observation window, not an atomic publisher snapshot.'}
    atomic_json(root / 'manifest.json', report)
    store.db.commit()
    store.set('status', state)
    store.set('last_export', {'event': last_event, 'report': report})
    if state in ('preembedding_ready', 'fixture_ready'):
        store.set('frozen', report)
    return report


@contextlib.contextmanager
def exclusive(root):
    root.mkdir(parents=True, exist_ok=True)
    path = root / 'coordinator.lock'
    stream = path.open('a+b')
    try:
        if os.name == 'nt':
            import msvcrt
            stream.seek(0)
            if path.stat().st_size == 0:
                stream.write(b'0')
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        stream.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('start', 'resume', 'status', 'checkpoint'))
    parser.add_argument('--root', type=Path)
    parser.add_argument('--model-root', type=Path)
    parser.add_argument('--tessdata', type=Path)
    parser.add_argument('--tesseract', default='tesseract')
    parser.add_argument('--ocr-device', choices=('cpu', 'cuda'), default='cpu')
    parser.add_argument('--connect-timeout', type=float, help='Finite positive connect timeout in seconds (initially 15; retained on resume)')
    parser.add_argument('--read-idle-timeout', type=float, help='Finite positive read-idle timeout in seconds (initially 90; retained on resume)')
    parser.add_argument('--retry', action='append', default=[])
    parser.add_argument('--recover-failures', action='store_true', help='Bulk requeue failure families with qualified remedies, once per remedy and work identity')
    parser.add_argument('--reason', default='')
    parser.add_argument('--refetch', action='store_true', help='With --retry, request a new observation after an acquisition remedy')
    parser.add_argument('--hold-kind', action='append', default=[], help='Hold new acquisitions of this kind; preserve queued identities and readiness gaps')
    parser.add_argument('--release-kind', action='append', default=[], help='Release a held acquisition kind after source recovery')
    parser.add_argument('--rate-mode', choices=('adaptive', 'fixed'), help='Persist shared 150-RPS fixed budget or adaptive backoff; Retry-After is honored in either mode')
    parser.add_argument('--status-interval', type=int, help='Persist progress report interval in seconds')
    parser.add_argument('--network-workers', type=int, help='Persist maximum simultaneous downloads, all sharing one rate budget')
    parser.add_argument('--preparation-workers', type=int, help='Persist combined preparation slots with one serializer per slot')
    parser.add_argument('--input-cache-mib', type=int, help='Persist shared validated-input cache budget (1-4096 MiB; default 64)')
    parser.add_argument('--discovery-workers', type=int, help='Advance HTML discovery slots sharing the CPU pool; zero disables the advance pass')
    args = parser.parse_args()
    if args.input_cache_mib is not None:
        try:
            cache_limits(args.input_cache_mib)
        except ValueError as error:
            parser.error(str(error))
    if args.status_interval is not None and args.status_interval < 1:
        parser.error('--status-interval must be positive')
    if args.discovery_workers is not None and not 0 <= args.discovery_workers <= 16:
        parser.error('--discovery-workers must be between 0 and 16')
    for name in ('network_workers', 'preparation_workers'):
        value = getattr(args, name)
        if value is not None and value < 1:
            parser.error('--'+name.replace('_', '-')+' must be positive')
    if os.name == 'nt' and args.preparation_workers is not None and args.preparation_workers > 61:
        parser.error('--preparation-workers cannot exceed 61 on Windows')
    if args.root is None:
        if args.command != 'start':
            parser.error('--root is required for status/resume')
        args.root = REPO/'.scratch/lexuz-fast-acquisition/runs'/(time.strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:8])
    if args.command in ('status', 'checkpoint'):
        if not (args.root / 'manifest.sqlite').exists():
            parser.error('No run manifest at --root')
        if args.command == 'checkpoint':
            atomic_json(args.root/'checkpoint-request.json', {'requested': time.time()})
            print(encoded({'state': 'checkpoint_requested', 'root': str(args.root)}))
            return
        print(encoded(status_snapshot(args.root)))
        return
    if args.command == 'start' and (args.root / 'manifest.sqlite').exists():
        parser.error('Run already exists; use resume')
    if args.command == 'resume' and not (args.root / 'manifest.sqlite').exists():
        parser.error('No run to resume')
    with exclusive(args.root), Store(args.root) as store:
        if store.setting('qualification'):
            parser.error('This is a fixture namespace; use a new --root for live acquisition')
        try:
            acquisition_timeouts(store, args.connect_timeout, args.read_idle_timeout)
        except ValueError as error:
            parser.error(str(error))
        if args.hold_kind:
            store.hold_network(args.hold_kind, args.reason)
        if args.release_kind:
            store.hold_network(args.release_kind, args.reason, release=True)
        if args.retry:
            store.retry(args.retry, args.reason, args.refetch)
        if args.recover_failures:
            print(encoded({'failure_recovery': store.recover_failures()}), flush=True)
        if args.rate_mode:
            store.set('rate_mode', args.rate_mode)
        if args.status_interval is not None:
            store.set('status_interval', args.status_interval)
        for name in ('network_workers', 'preparation_workers', 'discovery_workers', 'input_cache_mib'):
            value = getattr(args, name)
            if value is not None:
                store.set(name, value)
        OCR_CONFIG['device'] = args.ocr_device
        media = Media(args.root, args.model_root, args.tessdata, args.tesseract, device=args.ocr_device)
        runner = Coordinator(store, media)
        def stop(*_):
            runner.status, runner.stop = 'interrupted', True
        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        report = asyncio.run(runner.run())
        print(encoded(report))


if __name__ == '__main__':
    main()
