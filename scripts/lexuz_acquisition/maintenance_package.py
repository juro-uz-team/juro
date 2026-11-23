"""Package verified daily source additions in the prepared corpus wire format."""
import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys
import tempfile

from .shards import Shards
from .store import Store, atomic_json, digest, encoded

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from embedding_input_codec import decode


def checked_input(entry):
    original = entry['input']
    compact = entry['compactInput']
    locator = entry['chunk']['articleNumber']
    if (digest(original) != entry['inputHash'] or decode(compact, locator) != original
            or entry['dimensions'] != 3072 or entry['model'] != 'text-embedding-3-large'
            or entry['tokenizer'] != 'cl100k_base' or type(entry['compactTokens']) is not int
            or not 0 < entry['compactTokens'] <= 8192):
        raise ValueError('maintenance_embedding_input_invalid')
    return bytes.fromhex(digest(compact)), locator


def bind_attachments(work, subtree):
    row, document = subtree[work]
    units = list(document.get('units', []))
    chunks = list(document.get('chunks', []))
    next_ordinal = max((unit['ordinal'] for unit in units if type(unit['ordinal']) is int), default=-1) + 1
    origins = []
    for number, (attachment, (source, prepared)) in enumerate(subtree.items(), 1):
        if source['kind'] not in ('asset', 'member') or not prepared.get('chunks'):
            continue
        transforms = {}
        for unit in prepared.get('units', []):
            position = f"annex:{number}:{unit['locator']}"
            transforms[str(unit['ordinal'])] = {**unit, 'ordinal': next_ordinal, 'locator': position,
                'attachmentOrigin': {'work': attachment, 'sha256': source['raw_hash'], 'locator': unit['locator']}}
            next_ordinal += 1
        for entry in prepared['chunks']:
            chunk = entry['chunk']
            suffix = chunk['snapshotProvisionId'].removeprefix(attachment + ':')
            ordinal, segment, index = suffix.partition(':segment:')
            unit = transforms[ordinal]
            unit['hierarchy'] = chunk['hierarchy']
            parent = f"{work}:{unit['ordinal']}" + (segment + index if segment else '')
            stamp = digest(encoded({'ordinal': chunk['ordinal'], 'policyVersion': chunk['policyVersion'],
                'snapshotProvisionId': parent, 'targetTokens': chunk['targetTokens'],
                'officialTextSha256': chunk['officialTextSha256']}))
            original = json.loads(entry['input'])
            original['articleNumber'] = unit['locator']
            text = encoded(original) + '\n'
            chunks.append({**entry, 'work': work, 'locator': unit['locator'], 'input': text, 'inputHash': digest(text),
                'chunk': {**chunk, 'id': chunk['policyVersion'] + ':' + stamp,
                          'articleNumber': unit['locator'], 'snapshotProvisionId': parent}})
        origins.append(attachment)
        units.extend(transforms.values())
        subtree[attachment] = source, {**prepared, 'chunks': []}
    if origins:
        subtree[work] = row, {**document, 'units': units, 'chunks': chunks, 'projected_attachments': origins}


def select_rows(store, works):
    selected = {}
    waiting = []
    for work in works:
        subtree = {}
        queue = [work]
        while queue:
            key = queue.pop()
            if key in subtree:
                continue
            row = store.get(key)
            if row is None or row['state'] != 'done' or not row['prepared_key']:
                break
            prepared = json.loads(store.read_object(row['prepared_key']))
            if prepared.get('gaps') or prepared.get('publisher_alias'):
                break
            subtree[key] = (row, prepared)
            queue.extend(item[0] for item in store.db.execute("""SELECT w.id FROM edges e
                JOIN work w ON w.id=e.child WHERE e.parent=? AND w.kind IN ('asset','member')""", (key,)))
        else:
            if any(prepared.get('chunks') for _, prepared in subtree.values()):
                bind_attachments(work, subtree)
                for related in store.db.execute("""SELECT w.* FROM work w JOIN edges e ON w.id=e.child
                    WHERE e.parent=? AND w.kind IN ('card','surface','detail') AND w.state='done'
                      AND w.prepared_key IS NOT NULL ORDER BY w.id""", (work,)):
                    prepared = json.loads(store.read_object(related['prepared_key']))
                    if not prepared.get('gaps'):
                        subtree[related['id']] = (related, prepared)
                selected.update(subtree)
                continue
        waiting.append(work)
    return selected, waiting


def receipt(root, path):
    with path.open('rb') as stream:
        sha256 = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'path': path.relative_to(root).as_posix(), 'sha256': sha256, 'bytes': path.stat().st_size}


def write_package(store, selected, waiting, destination, provenance=None):
    import duckdb
    destination = Path(destination)
    if destination.exists() or not selected:
        raise ValueError('maintenance_package_destination_or_selection')
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        root = Path(temporary) / 'package'
        for folder in ('corpus', 'memberships', 'embedding-inputs', 'provenance'):
            (root / folder).mkdir(parents=True)
        names = ('inventory', 'prepared', 'chunks', 'taxonomy')
        writers = {name: Shards(root / 'corpus', name) for name in names}
        member_hash = hashlib.sha256()
        member_bytes = members = 0
        with closing(duckdb.connect(str(Path(temporary) / 'projection.duckdb'))) as db:
            db.execute("""CREATE TABLE members (ordinal BIGINT, chunk BLOB, input_hash BLOB, work VARCHAR);
                CREATE TABLE inputs (input_hash BLOB PRIMARY KEY, input VARCHAR, tokens INTEGER);
                CREATE TABLE mappings (original_hash BLOB PRIMARY KEY, input_hash BLOB, locator VARCHAR)""")
            try:
                rows = sorted(selected.items()) if isinstance(selected, dict) else selected
                for work, (row, data) in rows:
                    inventory = dict(row)
                    for field in ('context', 'receipt'):
                        inventory[field] = json.loads(row[field])
                    if row['kind'] == 'document' and '/pdfs/' in inventory['url']:
                        inventory['capture_url'] = inventory['url']
                        inventory['url'] = inventory['url'].replace('/pdfs/', '/docs/', 1)
                    if inventory['receipt'].get('status') != 200 or inventory['receipt'].get('sha256') != row['raw_hash']:
                        # Archived members carry the archive receipt plus their own verified digest.
                        if row['kind'] != 'member' or inventory['receipt'].get('status') != 200 or not row['raw_hash']:
                            raise ValueError('maintenance_capture_receipt_mismatch')
                    writers['inventory'].write(inventory)
                    writers['prepared'].write({'work': work, **{key: value for key, value in data.items() if key != 'chunks'}})
                    for node in data.get('taxonomy', []):
                        writers['taxonomy'].write({'work': work, **node})
                    for entry in data.get('chunks', []):
                        chunk = entry['chunk']
                        if entry['work'] != work or not chunk['snapshotProvisionId'].startswith(work + ':'):
                            raise ValueError('maintenance_chunk_identity')
                        compact, locator = checked_input(entry)
                        original = bytes.fromhex(entry['inputHash'])
                        writers['chunks'].write({**chunk, 'work': work, 'method': entry['method'], 'locator': entry['locator']})
                        candidate = bytes.fromhex(chunk['id'].removeprefix('retrieval-chunk-v1:'))
                        if len(candidate) != 32:
                            raise ValueError('maintenance_chunk_identity')
                        raw = ('{"chunk":"'+chunk['id']+'","input":"'+entry['inputHash']+'","work":'
                               +json.dumps(work, ensure_ascii=False)+'}\n').encode()
                        member_hash.update(raw)
                        member_bytes += len(raw)
                        db.execute('INSERT INTO members VALUES (?,?,?,?)', (members, candidate, original, work))
                        db.execute('INSERT INTO inputs VALUES (?,?,?) ON CONFLICT DO NOTHING',
                                   (compact, entry['compactInput'], entry['compactTokens']))
                        db.execute('INSERT INTO mappings VALUES (?,?,?) ON CONFLICT DO NOTHING',
                                   (original, compact, locator))
                        members += 1
                for writer in writers.values():
                    writer.close()
            finally:
                for writer in writers.values():
                    writer.abort()
            if not members:
                raise ValueError('maintenance_package_no_membership')
            files = []
            def project(relative, sql):
                path = root / relative
                db.execute(f'COPY ({sql}) TO ? (FORMAT PARQUET, COMPRESSION ZSTD)', [str(path)])
                item = receipt(root, path)
                files.append(item)
                return {**item, 'path': path.name}

            part = project('memberships/part-0000.parquet', 'SELECT chunk,input_hash,work FROM members ORDER BY ordinal')
            inputs = project('embedding-inputs/inputs-0000.parquet', 'SELECT * FROM inputs ORDER BY input_hash')
            mappings = project('embedding-inputs/mappings-0000.parquet', 'SELECT * FROM mappings ORDER BY original_hash')
            inputs['rows'], inputs['tokens'] = db.execute('SELECT count(*),sum(tokens) FROM inputs').fetchone()
            mappings['rows'] = db.execute('SELECT count(*) FROM mappings').fetchone()[0]
        source = root / 'provenance/handoff-manifest.json'
        atomic_json(source, {'schema_version': 4, **(provenance or {'build_id': store.root.name,
                    'observation_window': [store.setting('started'), store.setting('last_checkpoint')]}),
                    'memberships': members,
                    'unresolved_works': waiting, 'shards': {name: writer.receipts for name, writer in writers.items()}})
        files.append(receipt(root, source))
        atomic_json(root / 'memberships/manifest.json', {'status': 'exact_projection_verified', 'rows': members,
                    'pin': {'format': 'membership-storage-v1', 'source_manifest_sha256': files[-1]['sha256']},
                    'receipts': [{**part, 'format': 'binary-membership-parquet-v1', 'rows': members,
                                  'reconstructed_sha256': member_hash.hexdigest(),
                                  'source_receipt': {'count': members, 'uncompressed_bytes': member_bytes,
                                                     'uncompressed_sha256': member_hash.hexdigest()}}]})
        input_source = root / 'embedding-inputs/source-manifest.json'
        configuration = {'model': 'text-embedding-3-large', 'dimensions': 3072, 'tokenizer': 'cl100k_base',
                         'codec_version': 'legal-embedding-input-compact-v2'}
        atomic_json(input_source, {'configuration': configuration, 'inputs': inputs['rows'], 'originals': mappings['rows']})
        atomic_json(root / 'embedding-inputs/manifest.json', {'format': 'legal-embedding-storage-v1',
                    'status': 'exact_projection_verified', 'configuration': configuration,
                    'pin': {'source_manifest_sha256': receipt(root, input_source)['sha256']},
                    'input_count': inputs['rows'], 'tokens': inputs['tokens'], 'original_input_count': mappings['rows'],
                    'input_receipts': [inputs], 'mapping_receipts': [mappings]})
        files.extend(receipt(root, root / name) for name in ('embedding-inputs/source-manifest.json',
                     'embedding-inputs/manifest.json', 'memberships/manifest.json'))
        files.extend({**item, 'path': 'corpus/' + item['path']} for writer in writers.values() for item in writer.receipts)
        atomic_json(root / 'package-manifest.json', {'files': files})
        pin = receipt(root, root/'package-manifest.json')['sha256']
        sys.path.insert(0, str(ROOT/'corpus_search'))
        from package import PreparedPackage
        package = PreparedPackage(root, pin)
        # The serving decoder independently verifies the stored projections.
        for read in (package.membership_rows, package.input_rows, package.mapping_rows):
            stream = read(0)
            for _ in stream:
                pass
            if not stream.verified:
                raise ValueError('maintenance_projection_unverified')
        root.rename(destination)
        return pin


def cumulative_works(root, journal, unresolved):
    """Choose the latest verified capture of each exact publisher edition."""
    seen_urls, seen_works, taxonomy = set(), set(), None
    days = journal.execute('SELECT day FROM runs WHERE completed IS NOT NULL ORDER BY day DESC').fetchall()
    for (day,) in days:
        roots = journal.execute('SELECT work FROM changed_works WHERE day=? ORDER BY work', (day,))
        with Store(root/day, recover=False) as store:
            if taxonomy is None:
                row = store.db.execute("SELECT * FROM work WHERE kind='taxonomy' AND state='done' AND prepared_key IS NOT NULL").fetchone()
                if row:
                    taxonomy = (row['id'], (row, json.loads(store.read_object(row['prepared_key']))))
            records = [source for (work,) in roots if (source := store.get(work)) is not None]
            records.sort(key=lambda row: (json.loads(row['receipt']).get('observed', 0), row['id']), reverse=True)
            for source in records:
                work = source['id']
                if source is None or source['url'] in seen_urls:
                    continue
                selected, waiting = select_rows(store, [work])
                if waiting:
                    unresolved.extend(waiting)
                    continue
                seen_urls.add(source['url'])
                for key, item in selected.items():
                    if key not in seen_works:
                        seen_works.add(key)
                        yield key, item
    if seen_works and taxonomy:
        yield taxonomy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('day')
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.day):
        parser.error('Expected an acquisition day (YYYY-MM-DD)')
    path = (args.root / 'maintenance.sqlite').resolve(strict=True)
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as journal:
        works = [row[0] for row in journal.execute('SELECT work FROM changed_works WHERE day=? ORDER BY work', (args.day,))]
    with Store(args.root / args.day, recover=False) as store:
        selected, waiting = select_rows(store, works)
        if selected:
            print(write_package(store, selected, waiting, args.destination))


if __name__ == '__main__':
    main()
