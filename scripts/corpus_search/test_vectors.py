import hashlib
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import numpy as np
from scripts.corpus_search.vectors import VectorPool


def digest(raw):return hashlib.sha256(raw).hexdigest()


class VectorPoolTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temporary.name)
        (self.root/'vectors').mkdir();(self.root/'receipts').mkdir()
        self.values=np.random.default_rng(142).normal(size=(6,3072)).astype('<f4')
        self.identities=[hashlib.sha256(str(i).encode()).digest() for i in range(6)]
        shards=[]
        for part in range(3):
            job=f'p{part:03d}-00000';raw=self.values[part*2:part*2+2].tobytes();ids=b''.join(self.identities[part*2:part*2+2])
            (self.root/'vectors'/f'{job}.f32').write_bytes(raw)
            (self.root/'vectors'/f'{job}.hashes').write_bytes(ids)
            (self.root/'vectors'/f'{job}.done').write_bytes(b'\x01\x01')
            receipt={'job':job,'count':2,'dimensions':3072,'model':'text-embedding-3-large',
                     'dtype':'little-endian-float32','transformation':'none','vectors_sha256':digest(raw),'input_hashes_sha256':digest(ids)}
            (self.root/'receipts'/f'{job}.json').write_text(json.dumps(receipt));shards.append(receipt)
        raw=json.dumps({'model':'text-embedding-3-large','dimensions':3072,'inputs':6,'shards':shards}).encode()
        (self.root/'completion.json').write_bytes(raw);self.pin=digest(raw)

    def tearDown(self):self.temporary.cleanup()

    def test_cross_shard_reads_preserve_order_duplicate_requests_and_exact_bytes(self):
        pool=VectorPool(self.root,self.pin)
        try:
            with self.assertRaisesRegex(ValueError,'not_verified'):pool.read([0])
            pool.verify_all();ids=[5,0,2,2,1]
            self.assertEqual(pool.read(ids).tobytes(),self.values[ids].tobytes())
            self.assertEqual(pool.input_hashes(ids),[self.identities[i] for i in ids])
        finally:pool.close()

    def test_retained_reads_preserve_coordinates_without_rehashing_prepared_shards(self):
        original_read=pathlib.Path.read_bytes
        def metadata_only(path):
            if path.suffix=='.done':raise AssertionError('completion proof replay')
            return original_read(path)
        with patch('scripts.corpus_search.vectors.file_hash',side_effect=AssertionError('no corpus rehash')), \
             patch.object(pathlib.Path,'read_bytes',metadata_only):
            pool=VectorPool(self.root,self.pin,trust_prepared=True)
            try:
                pool.open_retained()
                ids=[5,0,2,2,1]
                self.assertEqual(pool.read(ids).tobytes(),self.values[ids].tobytes())
                self.assertEqual(pool.input_hashes(ids),[self.identities[i] for i in ids])
                with self.assertRaisesRegex(ValueError,'retained'):
                    pool.verify_all()
                path=self.root/'vectors/p000-00000.hashes';path.write_bytes(b'x'*64)
                with self.assertRaisesRegex(ValueError,'storage_changed'):pool.read([0])
            finally:pool.close()

    def test_tampered_coordinates_fail_before_admission(self):
        path=self.root/'vectors/p001-00000.f32'
        path.write_bytes(bytes(path.stat().st_size))
        pool=VectorPool(self.root,self.pin)
        with self.assertRaisesRegex(ValueError,'coordinate_hash_mismatch'):pool.verify_all()
        self.assertFalse(pool.ready);self.assertEqual(pool.opened,{})

    def test_random_read_policy_preserves_exact_coordinates_and_guards(self):
        pool=VectorPool(self.root,self.pin)
        try:
            with self.assertRaisesRegex(ValueError,'not_verified'):pool.prepare_random_reads()
            pool.verify_all()
            pool.prepare_random_reads();pool.prepare_random_reads()
            ids=[5,0,2,2,1]
            self.assertEqual(pool.read(ids).tobytes(),self.values[ids].tobytes())
            path=self.root/'vectors/p000-00000.hashes';path.write_bytes(b'x'*64)
            with self.assertRaisesRegex(ValueError,'storage_changed'):pool.prepare_random_reads()
        finally:pool.close()

    @unittest.skipUnless(importlib.util.find_spec('usearch'), 'requires the pinned serving engine')
    def test_mixed_raw_and_indexed_shards_preserve_original_coordinates(self):
        from scripts.corpus_batch.representation import publish
        publish(self.root,'p001-00000')
        # Delete only this synthetic fixture after publication verifies its bytes.
        (self.root/'vectors/p001-00000.f32').unlink()
        for mode in ['mapped','positioned']:
            with self.subTest(mode=mode):
                pool=VectorPool(self.root,self.pin,raw_read_mode=mode)
                try:
                    pool.verify_all();ids=[5,2,0,3,2,1]
                    self.assertEqual(pool.read(ids).tobytes(),self.values[ids].tobytes())
                    self.assertEqual(pool.input_hashes(ids),[self.identities[i] for i in ids])
                    self.assertEqual([pool.opened[i]['kind'] for i in range(3)],['raw','indexed','raw'])
                finally:pool.close()

    def test_post_admission_mutation_fails_without_backend_fallback(self):
        pool=VectorPool(self.root,self.pin);pool.verify_all()
        try:
            path=self.root/'vectors/p000-00000.hashes';path.write_bytes(b'x'*64)
            with self.assertRaisesRegex(ValueError,'storage_changed'):pool.input_hashes([0])
            with self.assertRaisesRegex(ValueError,'storage_changed'):pool.read([0])
        finally:pool.close()

    def test_bounds_and_completion_pins(self):
        with self.assertRaisesRegex(ValueError,'completion_mismatch'):VectorPool(self.root,'f'*64)
        pool=VectorPool(self.root,self.pin);pool.verify_all()
        try:
            for ids in [[-1],[6],[1.5],[True]]:
                with self.assertRaisesRegex(ValueError,'position_invalid'):pool.read(ids)
            with self.assertRaisesRegex(ValueError,'request_bound'):pool.read([0]*10001)
        finally:pool.close()

    def test_positioned_reads_preserve_concurrent_order_duplicates_and_close_descriptors(self):
        pool=VectorPool(self.root,self.pin,raw_read_mode='positioned')
        pool.verify_all();descriptors=[entry['fd'] for entry in pool.opened.values()]
        try:
            requests=[[5,0,2,2,1],[1,4,3,0],[2,2,5]]*4
            with ThreadPoolExecutor(max_workers=4) as executor:
                for ids,values in zip(requests,executor.map(pool.read,requests)):
                    self.assertEqual(values.tobytes(),self.values[ids].tobytes())
            self.assertEqual(pool.input_hashes([5,0]),[self.identities[5],self.identities[0]])
        finally:pool.close()
        for fd in descriptors:
            with self.assertRaises(OSError):os.fstat(fd)
        pool.close()

    def test_positioned_short_reads_and_changed_storage_fail(self):
        pool=VectorPool(self.root,self.pin,raw_read_mode='positioned');pool.verify_all()
        try:
            with patch('scripts.corpus_search.vectors.os.pread',return_value=b'x'):
                with self.assertRaisesRegex(ValueError,'coordinate_read_truncated'):pool.read([0])
            path=self.root/'vectors/p000-00000.f32';path.write_bytes(bytes(path.stat().st_size))
            with self.assertRaisesRegex(ValueError,'storage_changed'):pool.read([0])
        finally:pool.close()

    @unittest.skipUnless(hasattr(os,'posix_fadvise') and hasattr(os,'pread'),'positioned advice required')
    def test_random_read_policy_applies_to_positioned_descriptors(self):
        pool=VectorPool(self.root,self.pin,raw_read_mode='positioned');pool.verify_all()
        try:
            with patch('scripts.corpus_search.vectors.os.posix_fadvise',wraps=os.posix_fadvise) as advise:
                pool.prepare_random_reads()
                self.assertEqual({call.args for call in advise.call_args_list},
                    {(entry['fd'],0,0,os.POSIX_FADV_RANDOM) for entry in pool.opened.values()})
            self.assertEqual(pool.read([5,0,2]).tobytes(),self.values[[5,0,2]].tobytes())
        finally:pool.close()

    def test_positioned_policy_is_explicit_and_requires_platform_support(self):
        for mode in [None,True,'unknown']:
            with self.assertRaisesRegex(ValueError,'read_mode_invalid'):VectorPool(self.root,self.pin,raw_read_mode=mode)
        with patch('scripts.corpus_search.vectors.os.pread',None):
            with self.assertRaisesRegex(ValueError,'positioned_reads_unavailable'):
                VectorPool(self.root,self.pin,raw_read_mode='positioned')

    def test_positioned_failed_admission_closes_already_opened_descriptors(self):
        pool=VectorPool(self.root,self.pin,raw_read_mode='positioned')
        first=pool._open(0);fd=first['fd']
        path=self.root/'vectors/p001-00000.f32';path.write_bytes(bytes(path.stat().st_size))
        with self.assertRaisesRegex(ValueError,'coordinate_hash_mismatch'):pool.verify_all()
        self.assertFalse(pool.ready);self.assertEqual(pool.opened,{})
        with self.assertRaises(OSError):os.fstat(fd)

    def test_positioned_mutation_during_read_is_rejected(self):
        pool=VectorPool(self.root,self.pin,raw_read_mode='positioned');pool.verify_all()
        original=os.pread
        def changed(fd,width,offset):
            raw=original(fd,width,offset)
            (self.root/'vectors/p000-00000.hashes').write_bytes(b'x'*64)
            return raw
        try:
            with patch('scripts.corpus_search.vectors.os.pread',side_effect=changed):
                with self.assertRaisesRegex(ValueError,'storage_changed'):pool.read([0])
        finally:pool.close()


if __name__=='__main__':unittest.main()
