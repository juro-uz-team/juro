import hashlib
import pathlib
import sqlite3
import json
import tempfile
import unittest
from vector_identity import publish_vector_identities,VectorIdentityIndex,CompletedVectorIdentities


class Vectors:
    ready=True;completion_sha256='a'*64;count=7
    def __init__(self):self.hashes=[hashlib.sha256(str(i).encode()).digest() for i in range(self.count)]
    def input_hashes(self,ordinals):return [self.hashes[i] for i in ordinals]
    def assert_unchanged(self):pass


class IdentityTests(unittest.TestCase):
    def test_identity_only_source_authenticates_every_receipt_and_does_not_admit_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);(root/'receipts').mkdir();(root/'vectors').mkdir();receipts=[];hashes=[]
            for job,count in [('p000-00000',2),('p001-00000',3)]:
                values=[hashlib.sha256(f'{job}:{i}'.encode()).digest() for i in range(count)];hashes.extend(values)
                raw=b''.join(values);receipt={'job':job,'count':count,'model':'text-embedding-3-large','dimensions':3072,
                    'input_hashes_sha256':hashlib.sha256(raw).hexdigest()}
                receipts.append(receipt);(root/'receipts'/f'{job}.json').write_text(json.dumps(receipt))
                (root/'vectors'/f'{job}.hashes').write_bytes(raw);(root/'vectors'/f'{job}.done').write_bytes(bytes([1])*count)
            raw=json.dumps({'model':'text-embedding-3-large','dimensions':3072,'inputs':5,'shards':receipts}).encode()
            (root/'completion.json').write_bytes(raw)
            source=CompletedVectorIdentities(root,hashlib.sha256(raw).hexdigest())
            with self.assertRaisesRegex(ValueError,'unverified'):source.input_hashes([0])
            source.verify_identities()
            self.assertEqual(source.input_hashes([4,0,2,4]),[hashes[i] for i in [4,0,2,4]])
            self.assertFalse(hasattr(source,'read'))
            self.assertFalse(hasattr(source,'search'))
            pin=publish_vector_identities(source,root/'index')
            index=VectorIdentityIndex(root/'index',pin,source.completion_sha256)
            try:self.assertEqual(index.lookup(hashes),list(range(5)))
            finally:index.close()
            (root/'vectors/p001-00000.done').write_bytes(b'\x00\x01\x01')
            with self.assertRaisesRegex(ValueError,'storage_changed'):source.input_hashes([4])
            with self.assertRaisesRegex(ValueError,'receipt_mismatch'):source.verify_identities()
            self.assertFalse(source.ready)

    def test_inverse_preserves_completion_order_repeated_requests_and_missing_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)/'index';vectors=Vectors();pin=publish_vector_identities(vectors,root)
            index=VectorIdentityIndex(root,pin,vectors.completion_sha256)
            try:
                self.assertEqual(index.lookup([vectors.hashes[6],vectors.hashes[0],vectors.hashes[6],b'x'*32]),[6,0,6,None])
                with self.assertRaisesRegex(ValueError,'lookup_bound'):index.lookup([b'bad'])
                with self.assertRaisesRegex(ValueError,'lookup_bound'):index.lookup([b'x'*32]*2001)
                with self.assertRaisesRegex(ValueError,'manifest_invalid'):VectorIdentityIndex(root,pin,'b'*64)
                with (root/'identities.sqlite').open('ab') as target:target.write(b'changed')
                with self.assertRaisesRegex(ValueError,'storage_changed'):index.lookup([vectors.hashes[0]])
            finally:index.close()

    def test_duplicate_inputs_or_changed_vector_store_never_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);vectors=Vectors();vectors.hashes[6]=vectors.hashes[0]
            with self.assertRaises(sqlite3.IntegrityError):publish_vector_identities(vectors,root/'duplicate')
            self.assertFalse((root/'duplicate/manifest.json').exists())
            vectors=Vectors()
            def changed():raise ValueError('source_changed')
            vectors.assert_unchanged=changed
            with self.assertRaisesRegex(ValueError,'source_changed'):publish_vector_identities(vectors,root/'changed')
            self.assertFalse((root/'changed/manifest.json').exists())


if __name__=='__main__':unittest.main()
