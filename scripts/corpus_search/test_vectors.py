import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest

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

    def test_tampered_coordinates_fail_before_admission(self):
        path=self.root/'vectors/p001-00000.f32'
        path.write_bytes(bytes(path.stat().st_size))
        pool=VectorPool(self.root,self.pin)
        with self.assertRaisesRegex(ValueError,'coordinate_hash_mismatch'):pool.verify_all()
        self.assertFalse(pool.ready);self.assertEqual(pool.opened,{})

    @unittest.skipUnless(importlib.util.find_spec('usearch'), 'requires the pinned serving engine')
    def test_mixed_raw_and_indexed_shards_preserve_original_coordinates(self):
        from scripts.corpus_batch.representation import publish
        publish(self.root,'p001-00000')
        # Delete only this synthetic fixture after publication verifies its bytes.
        (self.root/'vectors/p001-00000.f32').unlink()
        pool=VectorPool(self.root,self.pin)
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


if __name__=='__main__':unittest.main()
