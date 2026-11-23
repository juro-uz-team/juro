"""Seal exact compact-input vectors, reusing the accepted corpus coordinates."""
import argparse
from contextlib import closing, ExitStack
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

import numpy as np

from .runner import exclusive
from .store import atomic_json

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS / 'corpus_search'))
from package import PreparedPackage, file_hash
from vector_identity import VectorIdentityIndex
from vectors import VectorPool, WIDTH


def vector_bytes(value):
    with np.errstate(over='ignore', invalid='ignore'):
        coordinates = np.asarray(value, dtype='<f4')
    if coordinates.shape != (3072,) or not np.isfinite(coordinates).all() or not np.any(coordinates):
        raise ValueError('maintenance_vector_invalid')
    return coordinates.tobytes()


class EmbeddingCache:
    def __init__(self, db):
        self.db = db
        db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS coordinates (
                hash BLOB PRIMARY KEY, vector BLOB NOT NULL, digest BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reservations (
                id INTEGER PRIMARY KEY, day TEXT NOT NULL, tokens INTEGER NOT NULL,
                state TEXT NOT NULL
            );
        """)

    def get(self, key):
        row = self.db.execute('SELECT vector,digest FROM coordinates WHERE hash=?', (key,)).fetchone()
        if row:
            if len(row[0]) != WIDTH or hashlib.sha256(row[0]).digest() != row[1]:
                raise ValueError('maintenance_vector_cache_corrupt')
            return row[0]
        return None

    def request(self, items, embed, limit):
        if self.db.execute("SELECT 1 FROM reservations WHERE state='pending' LIMIT 1").fetchone():
            raise ValueError('maintenance_embedding_outcome_unresolved')
        day = datetime.now(timezone.utc).date().isoformat()
        tokens = sum(item[2] for item in items)
        used = self.db.execute("SELECT coalesce(sum(tokens),0) FROM reservations WHERE day=? AND state<>'rejected'",
                               (day,)).fetchone()[0]
        if used + tokens > limit:
            raise ValueError('maintenance_embedding_daily_budget')
        with self.db:
            intent = self.db.execute("INSERT INTO reservations(day,tokens,state) VALUES (?,?,'pending')",
                                     (day, tokens)).lastrowid
        result = embed([item[1] for item in items])
        if result.get('rejected') in (400, 401, 403, 404, 413, 429):
            with self.db:
                self.db.execute("UPDATE reservations SET state='rejected' WHERE id=?", (intent,))
            raise ValueError('maintenance_embedding_rejected')
        vectors = result.get('vectors')
        if not isinstance(vectors, list) or len(vectors) != len(items):
            raise ValueError('maintenance_embedding_outcome_unresolved')
        raw = [vector_bytes(value) for value in vectors]
        with self.db:
            self.db.executemany('INSERT INTO coordinates VALUES (?,?,?)',
                [(item[0], value, hashlib.sha256(value).digest()) for item, value in zip(items, raw)])
            self.db.execute("UPDATE reservations SET state='complete' WHERE id=?", (intent,))
        return raw


def fill(rows, base, identities, cache, embed, limit):
    keys = [row[1] for row in rows]
    ordinals = identities.lookup(keys)
    available = [ordinal for ordinal in ordinals if ordinal is not None]
    inherited = iter(base.read(available)) if available else iter(())
    ready = [vector_bytes(next(inherited)) if ordinal is not None else cache.get(key)
             for key, ordinal in zip(keys, ordinals)]
    requested = [index for index, value in enumerate(ready) if value is None]
    if requested:
        generated = cache.request([(keys[index], rows[index][2], rows[index][3]) for index in requested],
                                  embed, limit)
        for index, value in zip(requested, generated):
            ready[index] = value
    return zip(keys, ready)


def produce_vectors(package, base, identities, cache, embed, limit, destination):
    destination = Path(destination)
    if destination.exists():
        with closing(VectorPool(destination, file_hash(destination/'completion.json'))) as existing:
            if existing.completion.get('package_sha256') != package.sha256:
                raise ValueError('maintenance_embedding_generation_mismatch')
        return file_hash(destination/'completion.json')
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        root = Path(temporary) / 'vectors'
        (root / 'vectors').mkdir(parents=True)
        (root / 'receipts').mkdir()
        shards = []
        for part, receipt in enumerate(package.embeddings['input_receipts']):
            stream = package.input_rows(part)
            source = iter(stream)
            for start in range(0, receipt['rows'], 50_000):
                job = f'p{part:03d}-{start:05d}'
                stem = root/'vectors'/job
                count = min(50_000, receipt['rows'] - start)
                from itertools import islice
                with stem.with_suffix('.hashes').open('xb') as hashes, stem.with_suffix('.f32').open('xb') as vectors:
                    for begin in range(0, count, 32):
                        batch = list(islice(source, min(32, count - begin)))
                        for key, raw in fill(batch, base, identities, cache, embed, limit):
                            hashes.write(key)
                            vectors.write(raw)
                stem.with_suffix('.done').write_bytes(bytes([1]) * count)
                shard = {'job': job, 'count': count, 'model': 'text-embedding-3-large', 'dimensions': 3072,
                         'dtype': 'little-endian-float32', 'transformation': 'none',
                         'input_hashes_sha256': file_hash(stem.with_suffix('.hashes')),
                         'vectors_sha256': file_hash(stem.with_suffix('.f32'))}
                atomic_json(root/'receipts'/f'{job}.json', shard)
                shards.append(shard)
            if next(source, None) is not None or not stream.verified:
                raise ValueError('maintenance_embedding_projection_unverified')
        atomic_json(root/'completion.json', {'model': 'text-embedding-3-large', 'dimensions': 3072,
                    'package_sha256': package.sha256, 'inputs': sum(row['count'] for row in shards), 'shards': shards})
        pin = file_hash(root/'completion.json')
        with closing(VectorPool(root, pin)) as verify:
            verify.verify_all()
        root.rename(destination)
        return pin


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('package_sha256')
    parser.add_argument('destination', type=Path)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--base-sha256', required=True)
    parser.add_argument('--identities', type=Path, required=True)
    parser.add_argument('--identities-sha256', required=True)
    parser.add_argument('--daily-new-input-tokens', type=int, required=True)
    args = parser.parse_args()
    if args.daily_new_input_tokens < 0:
        parser.error('The token limit must be nonnegative')
    package = PreparedPackage(args.package, args.package_sha256)
    with exclusive(args.cache), ExitStack() as resources:
        db = resources.enter_context(closing(sqlite3.connect(args.cache/'vectors.sqlite')))
        base = resources.enter_context(closing(VectorPool(args.base, args.base_sha256, trust_prepared=True)))
        base.open_retained()
        identities = resources.enter_context(closing(VectorIdentityIndex(args.identities, args.identities_sha256,
                                                                          args.base_sha256)))
        process = None

        def embed(inputs):
            nonlocal process
            if not os.environ.get('OPENAI_API_KEY'):
                return {'rejected': 401}
            if process is None:
                process = resources.enter_context(subprocess.Popen(
                    ['node', '--import', 'tsx', 'scripts/lexuz-embedding-vectors.mts'],
                    cwd=SCRIPTS.parent/'apps/platform', stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    encoding='utf-8', text=True))
                resources.callback(process.stdin.close)
            process.stdin.write(json.dumps(inputs, ensure_ascii=False) + '\n')
            process.stdin.flush()
            return json.loads(process.stdout.readline())

        print(produce_vectors(package, base, identities, EmbeddingCache(db), embed,
                              args.daily_new_input_tokens, args.destination))


if __name__ == '__main__':
    main()
