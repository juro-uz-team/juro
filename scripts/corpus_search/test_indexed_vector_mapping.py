"""Owned buffer lifecycle and exact original-coordinate retrieval, without APIs."""
import hashlib
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

import numpy as np

from scripts.corpus_batch import representation
from scripts.corpus_batch.representation import IndexedVectors
from vectors import VectorPool


class IndexedVectorMappingTests(unittest.TestCase):
    def setUp(self):
        try:
            representation.engine()
        except ImportError:
            self.skipTest('Pinned USearch engine required')
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = pathlib.Path(self.directory.name)
        (self.root / 'vectors').mkdir();(self.root / 'receipts').mkdir()
        self.job = 'mapping-test'
        self.values = np.random.default_rng(17).normal(size=(9, 3072)).astype('<f4')
        identities = b''.join(hashlib.sha256(str(i).encode()).digest() for i in range(9))
        self.raw = self.root / 'vectors' / f'{self.job}.f32'
        self.raw.write_bytes(self.values.tobytes())
        self.raw.with_suffix('.hashes').write_bytes(identities)
        self.raw.with_suffix('.done').write_bytes(bytes([1]) * 9)
        receipt = {'job': self.job, 'count': 9, 'dimensions': 3072,
                   'model': 'text-embedding-3-large', 'dtype': 'little-endian-float32',
                   'transformation': 'none', 'vectors_sha256': hashlib.sha256(self.values.tobytes()).hexdigest(),
                   'input_hashes_sha256': hashlib.sha256(identities).hexdigest()}
        (self.root / 'receipts' / f'{self.job}.json').write_text(json.dumps(receipt))
        # Construct a pinned fixture directly: publication's fsync on a read-only
        # descriptor is not portable to Windows and is outside this reader test.
        (self.root / 'representations').mkdir()
        temporary = self.root / 'representations' / 'fixture.usearch'
        index = representation.engine()(ndim=3072, metric='cos', dtype='f32', connectivity=16,
                                        expansion_add=128, expansion_search=512)
        index.add(np.arange(9, dtype=np.uint64), self.values)
        index.save(str(temporary));index.reset()
        digest = representation.file_hash(temporary)
        self.artifact = temporary.with_name(digest + '.usearch');temporary.rename(self.artifact)
        self.manifest = {'version': 1, 'format': 'usearch-original-f32', 'engine': representation.ENGINE_VERSION,
            'job': self.job, 'count': 9, 'source_receipt_sha256': representation.file_hash(self.root / 'receipts' / f'{self.job}.json'),
            'raw_export_sha256': receipt['vectors_sha256'], 'dimensions': 3072, 'metric': 'cos',
            'connectivity': 16, 'expansion_add': 128, 'expansion_search': 512,
            'index_sha256': digest, 'index_bytes': self.artifact.stat().st_size}
        self.raw.with_suffix('.representation.json').write_text(json.dumps(self.manifest))

    def test_owned_readonly_buffer_retains_exact_bytes_without_raw_storage(self):
        self.raw.unlink()  # Synthetic test fixture only.
        indexed = IndexedVectors(self.root, self.job)
        self.addCleanup(indexed.close)
        mapping = indexed.mapping
        with self.assertRaises(TypeError):
            mapping[0] = 0
        self.assertEqual(indexed.read(0, 9), self.values.tobytes())
        indexed.prepare_random_reads()
        selected = [8, 0, 4, 4, 1]
        self.assertEqual(indexed.read_positions(np.asarray(selected,dtype=np.uint64)).tobytes(),
                         self.values[selected].tobytes())
        self.assertEqual(indexed.index.get(np.asarray(selected, dtype=np.uint64), dtype='f32').tobytes(),
                         self.values[selected].tobytes())
        self.assertEqual(representation.file_hash(self.artifact), self.manifest['index_sha256'])
        indexed.close();indexed.close()
        self.assertTrue(mapping.closed)

    def test_retained_shuffled_storage_reads_original_ids_without_rehash_or_permutation_scan(self):
        order=np.asarray([7,2,8,0,5,1,6,4,3],dtype=np.uint64)
        index=representation.engine()(ndim=3072,metric='cos',dtype='f32',connectivity=16,
                                      expansion_add=128,expansion_search=512)
        index.add(order,self.values[order]);index.save(str(self.artifact));index.reset()
        digest=representation.file_hash(self.artifact)
        target=self.artifact.with_name(digest+'.usearch');self.artifact.rename(target);self.artifact=target
        self.manifest.update(index_sha256=digest,index_bytes=target.stat().st_size)
        self.raw.with_suffix('.representation.json').write_text(json.dumps(self.manifest))
        original_hash=representation.file_hash
        def metadata_only(path):
            if pathlib.Path(path).suffix!='.json':raise AssertionError('retained corpus rehash')
            return original_hash(path)
        with mock.patch.object(representation,'file_hash',side_effect=metadata_only), \
             mock.patch('scripts.corpus_batch.original_coordinates.OriginalCoordinates',side_effect=AssertionError('permutation scan')):
            indexed=IndexedVectors(self.root,self.job,trust_prepared=True)
            try:
                indexed.prepare_random_reads()
                selected=np.asarray([8,0,4,4,1],dtype=np.uint64)
                self.assertEqual(indexed.read_positions(selected).tobytes(),self.values[selected].tobytes())
                with self.assertRaises(TypeError):indexed.mapping[0]=0
            finally:indexed.close()

    def test_restore_and_reconstruction_failures_close_owned_mapping(self):
        real_mmap = representation.mmap.mmap
        for fail in ['restore', 'coordinates']:
            with self.subTest(fail=fail):
                opened = []
                def capture(*args, **kwargs):
                    mapping = real_mmap(*args, **kwargs);opened.append(mapping);return mapping
                fake_index = mock.Mock()
                fake_index.__len__ = mock.Mock(return_value=9)
                fake_index.get.return_value = np.ones((9, 3072), dtype='<f4')
                engine = mock.Mock()
                engine.restore.side_effect = ValueError('restore failed') if fail == 'restore' else None
                engine.restore.return_value = fake_index
                with mock.patch.object(representation.mmap, 'mmap', side_effect=capture), \
                     mock.patch.object(representation, 'engine', return_value=engine):
                    with self.assertRaisesRegex(ValueError, 'restore failed|export_mismatch'):
                        IndexedVectors(self.root, self.job)
                self.assertEqual(len(opened), 1)
                self.assertTrue(opened[0].closed)
                if fail == 'coordinates':
                    fake_index.reset.assert_called_once()

    def test_pool_preserves_scattered_duplicate_coordinates_and_closes_mapping(self):
        receipt = json.loads((self.root / 'receipts' / f'{self.job}.json').read_bytes())
        completion = json.dumps({'model': 'text-embedding-3-large', 'dimensions': 3072,
                                 'inputs': 9, 'shards': [receipt]}).encode()
        (self.root / 'completion.json').write_bytes(completion)
        self.raw.unlink()  # Indexed representation is the sole coordinate store.
        pool = VectorPool(self.root, hashlib.sha256(completion).hexdigest())
        self.addCleanup(pool.close)
        pool.verify_all()
        mapping = pool.opened[0]['backend'].mapping
        pool.prepare_random_reads()
        selected = [8, 0, 4, 4, 1]
        self.assertEqual(pool.read(selected).tobytes(), self.values[selected].tobytes())
        self.assertEqual(pool.input_hashes(selected),
                         [hashlib.sha256(str(i).encode()).digest() for i in selected])
        pool.close();pool.close()
        self.assertTrue(mapping.closed)

    def test_corrupt_artifact_is_rejected_before_engine_restore(self):
        data = bytearray(self.artifact.read_bytes());data[-1] ^= 1;self.artifact.write_bytes(data)
        with mock.patch.object(representation, 'engine') as engine:
            with self.assertRaisesRegex(ValueError, 'hash_mismatch'):
                IndexedVectors(self.root, self.job)
            engine.assert_not_called()


class MappingAdviceTests(unittest.TestCase):
    def test_index_releases_view_before_mapping_and_close_is_idempotent(self):
        events = []
        indexed = IndexedVectors.__new__(IndexedVectors)
        indexed.index = SimpleNamespace(reset=lambda: events.append('index'))
        indexed.mapping = SimpleNamespace(close=lambda: events.append('mapping'))
        indexed.coordinates = SimpleNamespace(close=lambda: events.append('coordinates'))
        indexed.close();indexed.close()
        self.assertEqual(events, ['coordinates', 'index', 'mapping'])

    def test_retrieval_advice_dispatches_to_raw_and_indexed_mappings(self):
        mapping = mock.Mock();indexed = IndexedVectors.__new__(IndexedVectors)
        indexed.mapping = mapping
        indexed.coordinates = mock.Mock()
        pool = VectorPool.__new__(VectorPool)
        pool.assert_unchanged = mock.Mock()
        raw_mapping = mock.Mock()
        pool.opened = {0: {'kind': 'indexed', 'backend': indexed},
                       1: {'kind': 'raw', 'backend': SimpleNamespace(_mmap=raw_mapping)}}
        with mock.patch.object(representation.mmap, 'MADV_RANDOM', 1, create=True):
            pool.prepare_random_reads()
        pool.assert_unchanged.assert_called_once()
        mapping.madvise.assert_called_once_with(1)
        raw_mapping.madvise.assert_called_once_with(1)


if __name__ == '__main__':
    unittest.main()
