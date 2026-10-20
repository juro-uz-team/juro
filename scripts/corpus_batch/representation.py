"""Verified full-precision index storage, retaining the original embedding receipts.

Publication never removes raw files. Operators may reclaim a raw shard only
after publishing and verifying its representation and deploying this reader.
The immutable completion receipt continues to describe the reconstructed bytes.
"""
import hashlib
import json
import os
import pathlib
import re

import numpy as np

DIMENSIONS = 3072
WIDTH = DIMENSIONS * 4
ENGINE_VERSION = '2.21.0'


def file_hash(path):
    with open(path, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def sync_directory(path):
    if os.name != 'nt':
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def engine():
    import usearch
    from usearch.index import Index
    if usearch.__version__ != ENGINE_VERSION:
        raise ValueError('vector_representation_engine_mismatch')
    return Index


def source_receipt(root, job):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', job):
        raise ValueError('invalid_vector_job')
    root = pathlib.Path(root)
    receipt_path = root / 'receipts' / f'{job}.json'
    receipt = json.loads(receipt_path.read_bytes())
    if (receipt.get('job') != job or type(receipt.get('count')) is not int
            or not 0 < receipt['count'] <= 50000
            or receipt.get('dimensions') != DIMENSIONS
            or receipt.get('model') != 'text-embedding-3-large'
            or receipt.get('dtype') != 'little-endian-float32'
            or receipt.get('transformation') != 'none'):
        raise ValueError('vector_representation_source_invalid')
    for name in ('vectors_sha256', 'input_hashes_sha256'):
        if not re.fullmatch(r'[a-f0-9]{64}', receipt.get(name, '')):
            raise ValueError('vector_representation_source_hash_invalid')
    hashes = root / 'vectors' / f'{job}.hashes'
    bits = (root / 'vectors' / f'{job}.done').read_bytes()
    if (bits != bytes([1]) * receipt['count']
            or hashes.stat().st_size != receipt['count'] * 32
            or file_hash(hashes) != receipt['input_hashes_sha256']):
        raise ValueError('vector_representation_identity_mismatch')
    return receipt, file_hash(receipt_path)


class IndexedVectors:
    """Read-only original coordinates, authenticated on open and reconstructed.

    IDs are shard-local ordinals. The immutable .hashes file maps these to the
    original embedding inputs; a search release supplies the shard identity.
    """
    def __init__(self, root, job):
        root = pathlib.Path(root)
        self.receipt, receipt_sha = source_receipt(root, job)
        self.count = self.receipt['count']
        manifest = json.loads((root / 'vectors' / f'{job}.representation.json').read_bytes())
        expected = {'version': 1, 'format': 'usearch-original-f32', 'engine': ENGINE_VERSION,
                    'job': job, 'count': self.count, 'source_receipt_sha256': receipt_sha,
                    'raw_export_sha256': self.receipt['vectors_sha256'],
                    'dimensions': DIMENSIONS, 'metric': 'cos', 'connectivity': 16,
                    'expansion_add': 128, 'expansion_search': 512}
        if (set(manifest) != set(expected) | {'index_sha256', 'index_bytes'}
                or any(manifest.get(key) != value for key, value in expected.items())
                or not re.fullmatch(r'[a-f0-9]{64}', manifest.get('index_sha256', ''))
                or type(manifest.get('index_bytes')) is not int or manifest['index_bytes'] <= 0):
            raise ValueError('vector_representation_manifest_mismatch')
        # Never accept a manifest-controlled arbitrary path or external symlink.
        path = root / 'representations' / (manifest['index_sha256'] + '.usearch')
        if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink():
            raise ValueError('vector_representation_path_invalid')
        if path.stat().st_size != manifest['index_bytes'] or file_hash(path) != manifest['index_sha256']:
            raise ValueError('vector_representation_hash_mismatch')
        self.index = engine().restore(str(path), view=True)
        self.index.expansion_search = 512
        if len(self.index) != self.count:
            raise ValueError('vector_representation_count_mismatch')
        reconstructed = hashlib.sha256()
        for start in range(0, self.count, 1024):
            block = self.read(start, min(1024, self.count-start))
            values = np.frombuffer(block, dtype='<f4').reshape(-1, DIMENSIONS)
            if not np.isfinite(values).all() or np.any(np.linalg.norm(values, axis=1) == 0):
                raise ValueError('vector_representation_coordinates_invalid')
            reconstructed.update(block)
        if reconstructed.hexdigest() != self.receipt['vectors_sha256']:
            raise ValueError('vector_representation_export_mismatch')

    def read(self, start, count=1):
        if type(start) is not int or type(count) is not int or start < 0 or count < 1 or start+count > self.count:
            raise ValueError('vector_representation_position')
        values = np.asarray(self.index.get(np.arange(start, start+count, dtype=np.uint64), dtype='f32'), dtype='<f4')
        if values.shape != (count, DIMENSIONS):
            raise ValueError('vector_representation_missing_coordinate')
        return values.tobytes()

    def close(self):
        self.index = None

    def search(self, query, count):
        """Return shard-local candidates reranked against original coordinates.

        Legal membership expansion and eligibility belong to the release reader;
        these are input-vector candidates, never directly citable legal evidence.
        Callers may widen through the entire shard to establish exhaustion.
        """
        values = np.asarray(query, dtype=np.float64)
        if (values.shape != (DIMENSIONS,) or not np.isfinite(values).all()
                or not np.isfinite(np.linalg.norm(values)) or np.linalg.norm(values) == 0
                or type(count) is not int or not 0 < count <= self.count):
            raise ValueError('vector_representation_query_invalid')
        provider_values = values.astype(np.float32)
        if not np.isfinite(provider_values).all() or np.linalg.norm(provider_values) == 0:
            raise ValueError('vector_representation_query_invalid')
        # Approximate graph traversal cannot prove exhaustion: a disconnected
        # component may remain unreachable even when requesting every vector.
        # At full widening enumerate the verified coordinate inventory instead.
        if count == self.count:
            keys = np.arange(self.count,dtype=np.uint64)
        else:
            matches = self.index.search(provider_values, count=count, threads=2)
            keys = np.asarray(matches.keys, dtype=np.uint64)
        if (keys.shape != (count,) or len(np.unique(keys)) != count
                or np.any(keys >= self.count)):
            raise ValueError('vector_representation_candidates_invalid')
        normalized = values / np.linalg.norm(values)
        scores = np.empty(count, dtype=np.float64)
        for start in range(0, count, 1024):
            selected = keys[start:start+1024]
            vectors = np.asarray(self.index.get(selected, dtype='f32'), dtype=np.float64)
            if vectors.shape != (len(selected), DIMENSIONS):
                raise ValueError('vector_representation_missing_coordinate')
            scores[start:start+len(selected)] = (vectors @ normalized) / np.linalg.norm(vectors, axis=1)
        if not np.isfinite(scores).all():
            raise ValueError('vector_representation_scores_invalid')
        scores = np.clip(scores, -1, 1)
        order = np.lexsort((keys, -scores))
        return [(int(keys[i]), float(scores[i])) for i in order]


def publish(root, job):
    """Build one bounded shard and publish after saved-index byte verification.

    The operator must hold the batch runner's maintenance fence. An existing
    publication is verified and reused. Neither completion nor source receipts
    are rewritten, and this function never unlinks original vectors.
    """
    root = pathlib.Path(root)
    receipt, receipt_sha = source_receipt(root, job)
    target = root / 'vectors' / f'{job}.representation.json'
    if target.exists():
        indexed = IndexedVectors(root, job)
        indexed.close()
        return json.loads(target.read_bytes())
    raw = root / 'vectors' / f'{job}.f32'
    if raw.stat().st_size != receipt['count'] * WIDTH or file_hash(raw) != receipt['vectors_sha256']:
        raise ValueError('vector_representation_raw_mismatch')
    directory = root / 'representations'
    directory.mkdir(exist_ok=True)
    if directory.is_symlink() or not directory.resolve().is_relative_to(root.resolve()):
        raise ValueError('vector_representation_path_invalid')
    # A stable exclusive file prevents concurrent publishers for this shard.
    lock = directory / f'{job}.building'
    with lock.open('xb') as guard:
        guard.write(str(os.getpid()).encode()); guard.flush(); os.fsync(guard.fileno())
    temporary = directory / f'{job}.partial'
    try:
        vectors = np.memmap(raw, dtype='<f4', mode='r', shape=(receipt['count'], DIMENSIONS))
        index = engine()(ndim=DIMENSIONS, metric='cos', dtype='f32', connectivity=16,
                         expansion_add=128, expansion_search=512)
        for start in range(0, receipt['count'], 1024):
            block = vectors[start:start+1024]
            if not np.isfinite(block).all() or np.any(np.linalg.norm(block, axis=1) == 0):
                raise ValueError('vector_representation_coordinates_invalid')
            index.add(np.arange(start, start+len(block), dtype=np.uint64), block, threads=2)
        index.save(str(temporary)); del index
        with temporary.open('rb') as saved:
            os.fsync(saved.fileno())
        index = engine().restore(str(temporary), view=True)
        exported = hashlib.sha256()
        for start in range(0, receipt['count'], 1024):
            count = min(1024, receipt['count']-start)
            block = np.asarray(index.get(np.arange(start, start+count, dtype=np.uint64), dtype='f32'), dtype='<f4')
            if block.shape != (count, DIMENSIONS) or block.tobytes() != vectors[start:start+count].tobytes():
                raise ValueError('vector_representation_export_mismatch')
            exported.update(block.tobytes())
        if len(index) != receipt['count'] or exported.hexdigest() != receipt['vectors_sha256']:
            raise ValueError('vector_representation_export_mismatch')
        del index, vectors
        index_sha = file_hash(temporary)
        manifest = {'version': 1, 'format': 'usearch-original-f32', 'engine': ENGINE_VERSION,
                    'job': job, 'count': receipt['count'], 'source_receipt_sha256': receipt_sha,
                    'raw_export_sha256': exported.hexdigest(), 'dimensions': DIMENSIONS,
                    'metric': 'cos', 'connectivity': 16, 'expansion_add': 128, 'expansion_search': 512,
                    'index_sha256': index_sha, 'index_bytes': temporary.stat().st_size}
        published = directory / f'{index_sha}.usearch'
        if published.exists():
            if file_hash(published) != index_sha:
                raise ValueError('vector_representation_existing_corrupt')
            temporary.unlink()
        else:
            os.replace(temporary, published)
        sync_directory(directory)
        pending = target.with_suffix('.json.partial')
        with pending.open('wb') as output:
            output.write(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode())
            output.flush(); os.fsync(output.fileno())
        os.replace(pending, target)
        sync_directory(target.parent)
        return manifest
    finally:
        # A host/process crash intentionally leaves the lock for inspection;
        # an expired observation alone is not permission to start another build.
        lock.unlink()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--job', required=True)
    args = parser.parse_args()
    print(json.dumps(publish(args.root, args.job)))
