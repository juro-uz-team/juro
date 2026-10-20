import hashlib
import json
import pathlib
import tempfile
import unittest
import weakref
from unittest.mock import patch

import zstandard
from package import PreparedPackage


def digest(raw):return hashlib.sha256(raw).hexdigest()


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.root=pathlib.Path(self.temporary.name)
        self.files=[]

    def tearDown(self):self.temporary.cleanup()

    def put(self,name,raw):
        path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
        receipt={'path':name,'bytes':len(raw),'sha256':digest(raw)}
        self.files.append(receipt)
        return receipt

    def fixture(self,bad_trailer=False):
        lines=b'{"work":"refresh:one","units":[]}\n{"work":"two","gaps":["missing asset"]}\n'
        compressed=zstandard.ZstdCompressor().compress(lines)
        receipt=self.put('corpus/prepared.jsonl.zst',compressed)
        source={**receipt,'path':'prepared.jsonl.zst','compression':'zstd','record_format':'jsonl',
                'count':2,'uncompressed_bytes':len(lines),'uncompressed_sha256':'f'*64 if bad_trailer else digest(lines)}
        handoff=self.put('provenance/handoff-manifest.json',json.dumps({'memberships':0,'shards':{'prepared':[source]}}).encode())
        self.put('memberships/manifest.json',json.dumps({'status':'exact_projection_verified',
            'pin':{'format':'membership-storage-v1','source_manifest_sha256':handoff['sha256']},'rows':0,'receipts':[]}).encode())
        original=self.put('embedding-inputs/source-manifest.json',b'{}')
        self.put('embedding-inputs/manifest.json',json.dumps({'status':'exact_projection_verified',
            'configuration':{'model':'text-embedding-3-large','dimensions':3072,'tokenizer':'cl100k_base','codec_version':'legal-embedding-input-compact-v2'},
            'format':'legal-embedding-storage-v1','pin':{'source_manifest_sha256':original['sha256']},'mapping_receipts':[]}).encode())
        raw=json.dumps({'files':self.files}).encode()
        (self.root/'package-manifest.json').write_bytes(raw)
        return PreparedPackage(self.root,digest(raw))

    def test_complete_iteration_verifies_and_preserves_variable_source_fields(self):
        package=self.fixture()
        stream=package.records('prepared',0)
        self.assertFalse(stream.verified)
        self.assertEqual(list(stream),[(0,{'work':'refresh:one','units':[]}),(1,{'work':'two','gaps':['missing asset']})])
        self.assertTrue(stream.verified)
        with self.assertRaisesRegex(ValueError,'already_consumed'):list(stream)
        self.assertEqual(package.checked('corpus\\prepared.jsonl.zst'),self.root/'corpus/prepared.jsonl.zst')

    def test_partial_iteration_is_not_publication_proof(self):
        stream=self.fixture().records('prepared',0)
        iterator=iter(stream);next(iterator);iterator.close()
        self.assertFalse(stream.verified)

    def test_stream_releases_previous_document_before_decoding_the_next(self):
        package=self.fixture();original=json.loads;previous=[]
        class Document(dict):pass
        def decode(raw):
            self.assertTrue(all(reference() is None for reference in previous))
            document=Document(original(raw));previous.append(weakref.ref(document));return document
        with patch('package.json.loads',decode):
            for _,document in package.records('prepared',0):del document
        self.assertTrue(all(reference() is None for reference in previous))

    def test_bad_trailing_receipt_fails_after_rows_without_marking_verified(self):
        stream=self.fixture(bad_trailer=True).records('prepared',0)
        with self.assertRaisesRegex(ValueError,'reconstruction_mismatch'):list(stream)
        self.assertFalse(stream.verified)

    def test_compressed_corruption_and_record_bounds_fail(self):
        package=self.fixture()
        stream=package.records('prepared',0,max_record_bytes=12)
        with self.assertRaisesRegex(ValueError,'record_bound'):list(stream)
        self.assertFalse(stream.verified)
        path=self.root/'corpus/prepared.jsonl.zst';path.write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError,'file_receipt_mismatch'):list(package.records('prepared',0))


if __name__=='__main__':unittest.main()
