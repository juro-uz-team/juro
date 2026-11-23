"""One writer, immutable compressed objects, transactional stage receipts."""
import hashlib
import json
import os
import sqlite3
import shutil
import time
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

from .compression import existing_key, reader, writer

PREPARATION_LANE = "CASE WHEN kind='document' THEN 0 WHEN kind IN ('asset','member') THEN 2 ELSE 1 END"


class ResourcePause(Exception):
    pass


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8', newline='\n') as stream:
        stream.write(encoded(value) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def retain_stream(root, chunks):
    """Publish a compressed immutable payload without materializing it in RAM."""
    root = Path(root)
    (root/'temporary').mkdir(exist_ok=True)
    temporary = root/'temporary'/(uuid.uuid4().hex+'.partial')
    sha, length = hashlib.sha256(), 0
    try:
        with temporary.open('wb') as target:
            with writer(target) as compressed:
                for chunk in chunks:
                    if shutil.disk_usage(root).free < 10*1024**3:
                        raise ResourcePause('disk_reserve_breach')
                    sha.update(chunk)
                    length += len(chunk)
                    compressed.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        key = existing_key(root, sha.hexdigest()) or f'objects/{sha.hexdigest()[:2]}/{sha.hexdigest()}.zst'
        path = root/key
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            try:
                os.replace(temporary, path)
            except OSError:
                # A concurrent writer can publish the same immutable hash
                # after the existence check. Windows may then deny replacement
                # while a reader holds that valid object open.
                if not path.is_file():
                    raise
        return {'object_key': key, 'sha256': sha.hexdigest(), 'bytes': length}
    finally:
        if temporary.exists():
            temporary.unlink()


class Store:
    def __init__(self, root, recover=True):
        self.root = Path(root)
        self.readonly = not recover
        self.batching = False
        self.rollback_generation = 0
        self.discovery = None
        if self.readonly:
            self.db = sqlite3.connect((self.root / 'manifest.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
            self.db.row_factory = sqlite3.Row
            return
        self.publication_locks = [threading.Lock() for _ in range(64)]
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / 'objects').mkdir(exist_ok=True)
        (self.root / 'temporary').mkdir(exist_ok=True)
        self.db = sqlite3.connect(self.root / 'manifest.sqlite')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          PRAGMA journal_mode=WAL;
          PRAGMA synchronous=FULL;
          PRAGMA cache_size=-65536;
          CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS work(
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, url TEXT NOT NULL, context TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
            due REAL NOT NULL DEFAULT 0, raw_hash TEXT, object_key TEXT, bytes INTEGER,
            receipt TEXT, prepared_key TEXT, config_hash TEXT, error TEXT,
            repeats INTEGER NOT NULL DEFAULT 0, elapsed REAL NOT NULL DEFAULT 0);
          CREATE INDEX IF NOT EXISTS work_queue ON work(state,due);
          CREATE INDEX IF NOT EXISTS work_url ON work(url,kind);
          CREATE TABLE IF NOT EXISTS edges(parent TEXT NOT NULL, child TEXT NOT NULL,
            locator TEXT NOT NULL, PRIMARY KEY(parent,child,locator));
          CREATE TABLE IF NOT EXISTS partitions(phase TEXT, language INTEGER, reported INTEGER,
            count INTEGER, receipt TEXT, PRIMARY KEY(phase,language));
          CREATE TABLE IF NOT EXISTS catalog(phase TEXT, language INTEGER, source TEXT,
            url TEXT, signature TEXT, PRIMARY KEY(phase,language,source));
          CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, work TEXT, stage TEXT,
            observed REAL, detail TEXT);
          CREATE INDEX IF NOT EXISTS events_work_stage ON events(work,stage,id);
          CREATE INDEX IF NOT EXISTS events_stage_observed ON events(stage,observed);
          CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, object_key TEXT NOT NULL);
        ''')
        # Each lane can claim its oldest eligible item without scanning the
        # higher-priority attachment backlog or sorting other queued kinds.
        self.db.execute(f'CREATE INDEX IF NOT EXISTS work_preparation_lane ON work(state,({PREPARATION_LANE}),due)')
        # Coverage reports need only these columns for media. Avoid scanning
        # millions of document contexts and receipts to summarize their pages.
        self.db.execute("CREATE INDEX IF NOT EXISTS work_media_summary ON work(raw_hash,id) WHERE kind IN ('asset','member')")
        if recover:
            interrupted = self.db.execute("SELECT count(*) FROM work WHERE state IN ('fetching','preparing')").fetchone()[0]
            self.db.execute("UPDATE work SET attempts=CASE WHEN state='fetching' THEN max(0,attempts-1) ELSE attempts END, state=CASE state WHEN 'fetching' THEN 'pending' ELSE 'acquired' END, repeats=repeats+1 WHERE state IN ('fetching','preparing')")
            if interrupted:
                self.event(None, 'recover_leases', {'count': interrupted, 'reason': 'Previous coordinator stopped before committing a receipt'})
            # A sole coordinator owns this namespace. Partial writes carry no receipt.
            for path in (self.root / 'temporary').glob('*.partial'):
                path.unlink()
            self.db.commit()
        if self.setting('build_id') is None:
            self.set('build_id', self.root.name)
            self.set('started', time.time())
        self.held_network_kinds = set(self.setting('network_holds') or [])

    def __enter__(self):
        return self

    def __exit__(self, *args):
        if not self.readonly:
            self.db.commit()
            self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        self.db.close()

    def set(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, encoded(value)))
        self.db.commit()

    def setting(self, key):
        row = self.db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def enqueue(self, kind, url, context=None, parent=None, locator='', identity=None):
        identity = identity or digest(encoded([kind, url]))
        changed = self.db.execute('INSERT OR IGNORE INTO work(id,kind,url,context,state) VALUES (?,?,?,?,?)',
                                 (identity, kind, url, encoded(context or {}),
                                  'held' if kind in self.held_network_kinds else 'pending')).rowcount
        if parent:
            changed += self.db.execute('INSERT OR IGNORE INTO edges VALUES (?,?,?)', (parent, identity, locator)).rowcount
            # Prioritize media needed by a repaired representation, without
            # promoting the entire graph of cross-referenced laws and cards.
            if kind in ('asset', 'member'):
                self.db.execute("UPDATE work SET due=-1 WHERE id=? AND state='pending' AND due=0 AND EXISTS (SELECT 1 FROM work WHERE id=? AND due<0)", (identity, parent))
        if changed:
            self.db.execute("DELETE FROM settings WHERE key IN ('frozen','last_export')")
        if not self.batching:
            self.db.commit()
        return identity

    @contextmanager
    def batch(self):
        self.batching = True
        try:
            with self.db:
                yield
        except BaseException:
            self.rollback_generation += 1
            raise
        finally:
            self.batching = False

    def get(self, identity):
        row = self.db.execute('SELECT * FROM work WHERE id=?', (identity,)).fetchone()
        return dict(row) if row else None

    def revise_context(self, identity, context):
        row = self.get(identity)
        value = encoded(context)
        if row['context'] == value:
            return
        successful_raw = row['receipt'] and json.loads(row['receipt']).get('status') == 200 and row['bytes']
        state = 'acquired' if successful_raw and row['state'] != 'fetching' else row['state']
        self.db.execute('UPDATE work SET context=?,state=?,prepared_key=NULL,config_hash=NULL,repeats=repeats+1,error=? WHERE id=?',
                        (value, state, None if successful_raw else row['error'], identity))
        self.db.execute("DELETE FROM settings WHERE key IN ('frozen','last_export')")
        self.event(identity, 'invalidate_context', {'reason': 'Parent source metadata corrected',
                   'previous_context': json.loads(row['context']), 'context': context})
        if self.discovery is not None:
            self.discovery.schedule(identity)
        if not self.batching:
            self.db.commit()

    def claim(self, stage, lane=None):
        with self.db:
            return self._claim(stage, lane)

    def claim_network_batch(self, limit=32):
        """Amortize durable lease commits without changing queue order."""
        with self.db:
            rows = self.db.execute("SELECT * FROM work WHERE state='pending' AND due<=? ORDER BY due,rowid LIMIT ?",
                                   (time.time(), limit)).fetchall()
            self.db.executemany("UPDATE work SET state='fetching',attempts=attempts+1 WHERE id=?",
                                ((row['id'],) for row in rows))
        return [dict(row) | {'state': 'fetching', 'attempts': row['attempts']+1} for row in rows]

    def return_network_batch(self, rows):
        with self.db:
            self.db.executemany("UPDATE work SET state='pending',attempts=attempts-1 WHERE id=? AND state='fetching'",
                                ((row['id'],) for row in rows))

    def _claim(self, stage, lane=None):
        state = 'pending' if stage == 'network' else 'acquired'
        now = time.time()
        if stage == 'prepare' and lane is not None:
            if lane not in (0, 1, 2):
                raise ValueError('Unknown preparation lane')
            row = None
            # Metadata slots should lend CPU capacity to legal bodies before
            # waiting behind the single GPU consumer. The media lane keeps its
            # own reserved slots, and metadata still takes immediate priority.
            for preferred in ((1, 0, 2) if lane == 1 else (lane, (lane + 1) % 3, (lane + 2) % 3)):
                row = self.db.execute(f'SELECT * FROM work WHERE state=? AND ({PREPARATION_LANE})=? AND due<=? ORDER BY due,rowid LIMIT 1',
                                      (state, preferred, now)).fetchone()
                if row:
                    break
        else:
            row = self.db.execute('SELECT * FROM work WHERE state=? AND due<=? ORDER BY due,rowid LIMIT 1', (state, now)).fetchone()
        if not row:
            return None
        next_state = 'fetching' if stage == 'network' else 'preparing'
        self.db.execute('UPDATE work SET state=?,attempts=attempts+? WHERE id=?',
                        (next_state, int(stage == 'network'), row['id']))
        # The sole writer changed only these two fields. Reuse the row already
        # selected instead of loading its context and receipt a second time.
        return dict(row) | {'state': next_state, 'attempts': row['attempts'] + int(stage == 'network')}

    def event(self, identity, stage, detail):
        self.db.execute('INSERT INTO events(work,stage,observed,detail) VALUES (?,?,?,?)',
                        (identity, stage, time.time(), encoded(detail)))

    def publish(self, temporary, sha, length, *, base=None, storage=None):
        # One coordinator owns the namespace, but its filesystem threads can
        # finish identical transfers together. A delta's dependency header must
        # remain immutable even if two writers proposed different valid bases.
        with self.publication_locks[int(sha[:2], 16) % len(self.publication_locks)]:
            return self._publish(temporary, sha, length, base=base, storage=storage)

    def _publish(self, temporary, sha, length, *, base=None, storage=None):
        key = existing_key(self.root, sha)
        if key is None:
            from .edition_storage import try_delta
            suffix, detail = try_delta(self.root, temporary, sha, length, base)
            if storage is not None:
                storage.update(detail)
            key = f'objects/{sha[:2]}/{sha}{suffix}'
        path = self.root / key
        path.parent.mkdir(exist_ok=True)
        if path.exists():
            temporary.unlink()
        else:
            try:
                os.replace(temporary, path)
            except OSError:
                if not path.is_file():
                    raise
                temporary.unlink()
        if storage is not None and key.endswith('.zdelta'):
            from .edition_storage import read_header
            storage.clear()
            storage.update(format='zstd-edition-delta-v1', base=read_header(path)['base'])
        return key

    def edition_base(self, row):
        """One bounded indexed lookup for a previously downloaded edition."""
        from .edition_storage import MAX_BYTES, family
        source = family(row)
        if source is None:
            return None
        cached = self.setting('edition_base:' + digest(source))
        if cached:
            return cached
        # Existing runs need no corpus-wide backfill. Exact URL first, then its
        # edition query range; signed IDs and route/language prefixes stay exact.
        for clause, values in (('url=?', (source,)), ('url>=? AND url<?', (source+'?', source+'@'))):
            prior = self.db.execute(f'''SELECT object_key,raw_hash,bytes FROM work
                WHERE {clause} AND kind='document' AND bytes BETWEEN 1 AND ?
                AND json_extract(receipt,'$.status')=200
                AND (object_key LIKE '%.gz' OR object_key LIKE '%.zst') LIMIT 1''', (*values, MAX_BYTES)).fetchone()
            if prior:
                return {'key': prior['object_key'], 'sha256': prior['raw_hash'], 'bytes': prior['bytes']}
        return None

    def put(self, payload):
        # Known bytes can reuse an already atomically published immutable object
        # before paying compression, file creation and fsync again. Streamed
        # acquisitions still hash while receiving their previously unknown body.
        sha = digest(payload)
        key = existing_key(self.root, sha) or f'objects/{sha[:2]}/{sha}.zst'
        if (self.root / key).is_file():
            return key
        return retain_stream(self.root, [payload])['object_key']

    def commit_raw(self, identity, payload, receipt):
        self.receipt(identity, digest(payload), self.put(payload), len(payload), receipt)

    def receipt(self, identity, sha, key, length, receipt, *, pending_failure=False, row=None, base=None):
        receipt = {**receipt, 'observed': receipt.get('observed', time.time()), 'sha256': sha, 'bytes': length, 'object_key': key}
        valid = receipt.get('status') == 200 and length > 0
        with self.db:
            self.db.execute("UPDATE work SET state=?,raw_hash=?,object_key=?,bytes=?,receipt=?,error=? WHERE id=?",
                            ('acquired' if valid else ('fetching' if pending_failure else 'blocked'), sha, key, length, encoded(receipt), None if valid else 'response_not_successful', identity))
            self.event(identity, 'receive_reuse' if receipt.get('reused_from') else 'receive', receipt)
            if valid and row is not None:
                from .edition_storage import MAX_BYTES, family
                source = family(row)
                anchor = base or ({'key': key, 'sha256': sha, 'bytes': length}
                                  if key.endswith(('.gz', '.zst')) and length <= MAX_BYTES else None)
                if source and anchor:
                    operation = 'REPLACE' if receipt.get('storage', {}).get('delta_fallback') else 'IGNORE'
                    self.db.execute(f'INSERT OR {operation} INTO settings VALUES (?,?)',
                                    ('edition_base:' + digest(source), encoded(anchor)))
            if self.discovery is not None:
                self.discovery.schedule(identity)

    def read_object(self, key):
        with reader(self.root / key) as stream:
            return stream.read()

    def read_raw(self, identity):
        return self.read_object(self.get(identity)['object_key'])

    def prepared(self, identity, result, config_hash, elapsed, prepared_key=None):
        # Callers may publish immutable bytes off the event loop, then commit
        # the owning receipt here on the sole SQLite coordinator thread.
        key = prepared_key if prepared_key is not None else self.put(encoded(result).encode())
        with self.db:
            self._record_prepared(identity, result, config_hash, elapsed, key)

    def prepared_and_claim(self, identity, result, config_hash, elapsed, prepared_key, lane=None, claim_next=True, cache_entry=None):
        # Both operations become durable before the next lease is returned.
        # The prepared object has already been atomically published and fsynced.
        with self.db:
            if cache_entry is not None:
                self.db.execute('INSERT OR REPLACE INTO cache VALUES (?,?)', cache_entry)
            self._record_prepared(identity, result, config_hash, elapsed, prepared_key)
            return self._claim('prepare', lane) if claim_next else None

    def _record_prepared(self, identity, result, config_hash, elapsed, key):
        gaps = list(dict.fromkeys(result.get('gaps', [])))
        state = 'blocked' if gaps else ('excluded' if result.get('scope_exclusion') else 'done')
        self.db.execute("UPDATE work SET state=?,prepared_key=?,config_hash=?,error=?,elapsed=elapsed+? WHERE id=?",
                        (state, key, config_hash, ';'.join(gaps) if gaps else None, elapsed, identity))
        self.event(identity, 'prepare', {'config_hash': config_hash, 'elapsed': elapsed,
            'raw_hash': self.get(identity)['raw_hash'],
            'pages': len(result.get('pages', [])), 'units': len(result.get('units', [])),
            'chunks': len(result.get('chunks', [])), 'gaps': len(gaps)})
        if self.discovery is not None:
            self.discovery.prepared(identity)

    def release(self, identity, state):
        with self.db:
            self.db.execute('UPDATE work SET state=? WHERE id=?', (state, identity))

    def invalidate_kind(self, kind, config_hash):
        with self.db:
            changed = self.db.execute("UPDATE work SET state='acquired',repeats=repeats+1 WHERE kind=? AND state='done' AND config_hash<>?", (kind, config_hash)).rowcount
        if changed:
            with self.db:
                self.event(None, 'invalidate', {'kind': kind, 'configuration_hash': config_hash, 'count': changed,
                                               'reason': 'Relevant stage configuration changed'})
            self.set('frozen', None)
        return changed

    def invalidate_stages(self, hashes):
        # One compatibility scan, rather than scanning every completed receipt
        # once per kind on every resume. Only affected kinds are then changed.
        if not hashes:
            return 0
        cases = ' '.join('WHEN ? THEN ?' for _ in hashes)
        parameters = [value for pair in hashes.items() for value in pair]
        changed = self.db.execute(f"SELECT DISTINCT kind FROM work WHERE state='done' AND config_hash <> CASE kind {cases} ELSE config_hash END",
                                  parameters).fetchall()
        return sum(self.invalidate_kind(row[0], hashes[row[0]]) for row in changed)

    def fail(self, identity, reason, transient=False, delay=0):
        row = self.get(identity)
        state = 'pending' if transient and row['attempts'] < 5 else 'blocked'
        with self.db:
            self.db.execute('UPDATE work SET state=?,error=?,due=? WHERE id=?', (state, reason, time.time()+delay, identity))
            self.event(identity, 'failure', {'reason': reason, 'transient': transient})

    def defer_outage(self, identity, reason):
        """An unavailable connection is not a failed content identity."""
        with self.db:
            self.db.execute("UPDATE work SET state='pending',attempts=max(0,attempts-1),due=0,error=? WHERE id=? AND state IN ('fetching','blocked')",
                            ('connectivity_wait:' + reason, identity))
            self.event(identity, 'network_deferred', {'reason': reason, 'retry_charged': False})

    def retry(self, identities, reason, refetch=False):
        if not reason.strip():
            raise ValueError('A concrete remedy is required')
        for identity in identities:
            row = self.get(identity)
            if not row:
                raise ValueError(f'Unknown work: {identity}')
            with self.db:
                receipt = json.loads(row['receipt']) if row['receipt'] else {}
                reusable = bool(row['object_key'] and row['bytes'] and receipt.get('status') == 200)
                self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('refetch:'+identity, encoded(refetch or not reusable)))
                self.db.execute("UPDATE work SET state=?,attempts=0,due=-2,error=NULL,repeats=repeats+1 WHERE id=?",
                                ('acquired' if reusable and not refetch else 'pending', identity))
                self.event(identity, 'retry', {'reason': reason})
        self.set('frozen', None)
        self.set('last_export', None)

    def hold_network(self, kinds, reason, release=False):
        """Hold new requests without dropping identities or blocking retained preparation.

        Explicit targeted retries remain allowed as bounded recovery probes.
        """
        if not reason.strip():
            raise ValueError('A concrete hold/release reason is required')
        holds = self.held_network_kinds - set(kinds) if release else self.held_network_kinds | set(kinds)
        with self.db:
            for kind in kinds:
                self.db.execute('UPDATE work SET state=? WHERE kind=? AND state=?',
                                ('pending' if release else 'held', kind, 'held' if release else 'pending'))
            self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('network_holds', encoded(sorted(holds))))
            self.db.execute("DELETE FROM settings WHERE key IN ('frozen','last_export')")
            self.event(None, 'network_release' if release else 'network_hold', {'kinds': list(kinds), 'reason': reason})
        self.held_network_kinds = holds

    def recover_failures(self):
        """Apply qualified remedies once per identity, in bounded transactions.

        Successful raw/preparation objects and historical failure events survive.
        Restarting cannot replay the same unsuccessful remedy indefinitely.
        """
        counts = {}
        identities = [r[0] for r in self.db.execute("SELECT id FROM work WHERE state='blocked' AND kind IN ('asset','member')")]
        for offset in range(0, len(identities), 500):
            with self.db:
                for identity in identities[offset:offset+500]:
                    row = self.get(identity)
                    error = row['error'] or ''
                    policy, state = None, 'acquired'
                    receipt = json.loads(row['receipt'] or '{}')
                    if row['kind'] == 'asset' and error == 'unexplained_empty_response':
                        policy, state = 'empty-asset-refetch-v1', 'pending'
                    elif row['object_key'] and row['bytes'] and (row['kind'] == 'member' or receipt.get('status') == 200):
                        if 'vector_graphics_unresolved' in error:
                            policy = 'pdf-cell-border-coverage-v1'
                        elif 'orientation_unresolved' in error:
                            with reader(self.root / row['object_key']) as stream:
                                signature = stream.read(4)
                            if signature == b'\xd7\xcd\xc6\x9a':
                                policy = 'wmf-orientation-png-v1'
                    if not policy:
                        continue
                    marker = 'recovery:' + policy + ':' + row['id']
                    if self.db.execute('SELECT 1 FROM settings WHERE key=?', (marker,)).fetchone():
                        continue
                    self.db.execute('INSERT INTO settings VALUES (?,?)', (marker, encoded({'applied': time.time()})))
                    if state == 'pending':
                        self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('refetch:' + row['id'], 'true'))
                    self.db.execute("UPDATE work SET state=?,attempts=0,due=-2,error=NULL,repeats=repeats+1 WHERE id=?", (state, row['id']))
                    self.event(row['id'], 'recovery', {'policy': policy, 'previous_error': error, 'state': state})
                    counts[policy] = counts.get(policy, 0) + 1
                if counts:
                    self.db.execute("DELETE FROM settings WHERE key IN ('frozen','last_export')")
        return counts

    def invalidate(self, config_hash):
        with self.db:
            self.db.execute("UPDATE work SET state='acquired',repeats=repeats+1 WHERE state='done' AND config_hash<>?", (config_hash,))

    def counts(self):
        return {row[0]: row[1] for row in self.db.execute('SELECT state,count(*) FROM work GROUP BY state')}
