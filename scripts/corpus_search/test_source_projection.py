import hashlib
import json
import pathlib
import tempfile
import unittest
import zstandard
from unittest.mock import patch

import cancellation
from package import VerifiedStream
from prepared import canonical
from source_projection import (SourceProjection,SourcePart,publish,publish_part,
    read_checkpoint,INDEX,part_name)


class Fixture:
    sha256='a'*64
    def __init__(self):
        self.values={'chunks':[{'text':f'Статья {i} 😀\nline','ordinal':i} for i in range(2200)],
                     'inventory':[{'id':'law:1'}],
                     'prepared':[{'units':[{'text':'first\nsecond\u2028third'}]},{'text':'x'*(8*1024*1024+1)}]}
        self.handoff={'shards':{kind:[{'count':len(rows),'sha256':'b'*64}] for kind,rows in self.values.items()}}
        self.bad=False
    def records(self,kind,part):
        def rows():
            yield from enumerate(self.values[kind])
            if self.bad:raise ValueError('trailing_source_mismatch')
        return VerifiedStream(rows)


class ProjectionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name)/'projection';self.package=Fixture()

    def build(self):
        pin=publish(self.package,self.root)
        return SourceProjection(self.root,pin,self.package)

    def test_exact_selected_rows_large_record_and_unicode_without_source_scans(self):
        reader=self.build()
        with patch.object(self.package,'records',side_effect=AssertionError('source scan')):
            for kind,rows in self.package.values.items():
                selected=[len(rows)-1,0,len(rows)-1]
                stream=reader.records_at(kind,0,selected)
                self.assertEqual(list(stream),[(i,rows[i]) for i in sorted(set(selected))])
                self.assertTrue(stream.verified)
        self.assertEqual(len(reader.parts['chunks',0].starts),3)
        self.assertEqual(len(reader.parts['prepared',0].starts),2)

    def test_trailing_source_error_never_publishes(self):
        self.package.bad=True
        with self.assertRaisesRegex(ValueError,'trailing_source'):
            publish(self.package,self.root)
        self.assertFalse((self.root/'manifest.json').exists())
        self.assertFalse((self.root/part_name('chunks',0)).exists())

    def test_retained_projection_preserves_selected_source_bytes_without_rehashing(self):
        pin=publish(self.package,self.root)
        receipts={canonical(receipt):hashlib.sha256(canonical(receipt)).hexdigest()
                  for parts in self.package.handoff['shards'].values() for receipt in parts}
        with patch('source_projection.file_hash',side_effect=AssertionError('corpus rehash')), \
             patch('source_projection.digest',side_effect=lambda raw:receipts[raw]), \
             patch('source_projection.hashlib.sha256',side_effect=AssertionError('corpus rehash')):
            reader=SourceProjection(self.root,pin,self.package,trust_prepared=True)
            try:
                for kind,rows in self.package.values.items():
                    selected=sorted({0,len(rows)-1})
                    self.assertEqual(list(reader.records_at(kind,0,selected)),[(i,rows[i]) for i in selected])
                path=reader.parts['chunks',0].paths[1]
                with path.open('ab') as output:output.write(b'changed')
                with self.assertRaisesRegex(ValueError,'changed'):
                    list(reader.records_at('chunks',0,[0]))
            finally:reader.close()

    def test_cached_projection_never_bypasses_physical_block_authentication(self):
        from discovery_json import ProjectedRecordDecoder
        from discovery_catalog import project_publisher_fields
        self.package.values['prepared'][0]['pages']=['Large source text. '*10000]
        reader=self.build();decoder=ProjectedRecordDecoder(project_publisher_fields)
        first=list(reader.records_at('prepared',0,[0],decode_record=decoder))
        self.assertEqual(list(reader.records_at('prepared',0,[0],decode_record=decoder)),first)
        part=reader.parts['prepared',0];path=part.paths[1]
        raw=path.read_bytes();path.write_bytes(bytes([raw[0]^1])+raw[1:])
        # Even if a caller's metadata fence missed this change, every cache
        # access must still follow authentication of actual compressed bytes.
        with patch.object(part,'assert_unchanged',return_value=None):
            stream=reader.records_at('prepared',0,[0],decode_record=decoder)
            with self.assertRaisesRegex(ValueError,'block_mismatch'):list(stream)
            self.assertFalse(stream.verified)

    def test_selected_rows_still_require_the_complete_block_row_count(self):
        reader=self.build()
        decompressor=zstandard.ZstdDecompressor()
        def changed(encoded,**kwargs):
            return decompressor.decompress(encoded,**kwargs).replace(b'\n',b' ',1)
        with patch('source_projection.zstandard.ZstdDecompressor') as factory:
            factory.return_value.decompress.side_effect=changed
            stream=reader.records_at('chunks',0,[0])
            with self.assertRaisesRegex(ValueError,'block_rows'):list(stream)
            self.assertFalse(stream.verified)

    def test_resume_requires_external_checkpoint_pin_and_rechecks_artifacts(self):
        checkpoints=[]
        def stop(kind,part,pin):
            checkpoints.append(pin);raise InterruptedError()
        with self.assertRaises(InterruptedError):publish(self.package,self.root,stop)
        with self.assertRaisesRegex(ValueError,'resume_pin_required'):publish(self.package,self.root)
        pin=checkpoints[-1];path=self.root/'checkpoint.json'
        with self.assertRaisesRegex(ValueError,'checkpoint_mismatch'):read_checkpoint(path,'0'*64,self.package)
        resume=read_checkpoint(path,pin,self.package)
        final=publish(self.package,self.root,resume=resume)
        reader=SourceProjection(self.root,final,self.package)
        self.assertEqual(list(reader.records_at('inventory',0,[0])),[(0,{'id':'law:1'})])

    def test_changed_bytes_and_wrong_package_fail_admission(self):
        pin=publish(self.package,self.root)
        path=self.root/part_name('chunks',0)/'records.zst'
        raw=path.read_bytes();path.write_bytes(b'x'+raw[1:])
        with self.assertRaisesRegex(ValueError,'file_mismatch'):SourceProjection(self.root,pin,self.package)
        self.package.sha256='f'*64
        with self.assertRaisesRegex(ValueError,'lineage_mismatch'):SourceProjection(self.root,pin,self.package)

    def test_post_admission_mutation_and_cancellation_never_verify_stream(self):
        reader=self.build();stream=reader.records_at('chunks',0,[0,1024])
        iterator=iter(stream);self.assertEqual(next(iterator)[0],0)
        path=self.root/part_name('chunks',0)/'records.zst'
        with path.open('ab') as output:output.write(b'x')
        with self.assertRaisesRegex(ValueError,'storage_changed'):next(iterator)
        self.assertFalse(stream.verified)
        scope=cancellation.Cancellation();token=cancellation._current.set(scope)
        try:
            stream=reader.records_at('inventory',0,[0]);iterator=iter(stream)
            next(iterator);scope.cancel()
            with self.assertRaises(InterruptedError):next(iterator)
            self.assertFalse(stream.verified)
        finally:cancellation._current.reset(token)

    def test_index_gap_rejected_even_when_rehashed(self):
        pin=publish_part(self.package,self.root,'chunks',0)
        root=self.root/part_name('chunks',0);path=root/'rows.idx'
        raw=bytearray(path.read_bytes());entry=list(INDEX.unpack_from(raw));entry[0]=1
        INDEX.pack_into(raw,0,*entry);path.write_bytes(raw)
        manifest=json.loads((root/'manifest.json').read_bytes())
        manifest['files']['rows.idx']['sha256']=hashlib.sha256(raw).hexdigest()
        encoded=canonical(manifest);(root/'manifest.json').write_bytes(encoded)
        with self.assertRaisesRegex(ValueError,'index_invalid'):
            SourcePart(root,hashlib.sha256(encoded).hexdigest(),self.package,'chunks',0)

    def test_request_bounds_and_empty_selection(self):
        reader=self.build()
        for requested in ([True],[-1],[2200],[0]*2001):
            with self.assertRaisesRegex(ValueError,'selection_invalid'):reader.records_at('chunks',0,requested)
        stream=reader.records_at('chunks',0,[])
        self.assertEqual(list(stream),[]);self.assertTrue(stream.verified)

    def test_interrupted_partition_can_resume_from_prior_pinned_checkpoint(self):
        original=self.package.records
        def interrupted(kind,part):
            if kind!='inventory':return original(kind,part)
            def rows():
                yield 0,self.package.values[kind][0]
                raise InterruptedError('build interrupted')
            return VerifiedStream(rows)
        with patch.object(self.package,'records',interrupted):
            with self.assertRaises(InterruptedError):publish(self.package,self.root)
        path=self.root/'checkpoint.json';pin=hashlib.sha256(path.read_bytes()).hexdigest()
        resume=read_checkpoint(path,pin,self.package)
        final=publish(self.package,self.root,resume=resume)
        self.assertEqual(len(list(SourceProjection(self.root,final,self.package).records_at('inventory',0,[0]))),1)
        self.assertLessEqual(len(list(self.root.glob('checkpoint*.json'))),2)

    def test_repeated_resume_keeps_trusted_pins_for_parts_not_yet_revisited(self):
        publish(self.package,self.root)
        path=self.root/'checkpoint.json';pin=hashlib.sha256(path.read_bytes()).hexdigest()
        resume=read_checkpoint(path,pin,self.package)
        def stop(kind,part,pin):
            if kind=='inventory':raise InterruptedError()
        with self.assertRaises(InterruptedError):publish(self.package,self.root,stop,resume=resume)
        pin=hashlib.sha256(path.read_bytes()).hexdigest()
        next_resume=read_checkpoint(path,pin,self.package)
        self.assertEqual(next_resume,resume)
        publish(self.package,self.root,resume=next_resume)

    def test_admission_index_budget_and_build_disk_reserve(self):
        pin=publish(self.package,self.root)
        with patch('source_projection.INDEX_CAPACITY',1):
            with self.assertRaisesRegex(ValueError,'index_capacity'):SourceProjection(self.root,pin,self.package)
        from types import SimpleNamespace
        with patch('source_projection.shutil.disk_usage',return_value=SimpleNamespace(free=0)):
            with self.assertRaisesRegex(ValueError,'disk_reserve'):
                publish_part(self.package,self.root/'insufficient','inventory',0)
        self.assertFalse((self.root/'insufficient'/part_name('inventory',0)).exists())

    def test_frame_declared_size_and_extra_frames_are_rejected(self):
        for extra in (False,True):
            root=self.root/str(extra)
            publish_part(self.package,root,'inventory',0)
            root=root/part_name('inventory',0)
            data=(root/'records.zst').read_bytes()
            entry=list(INDEX.unpack((root/'rows.idx').read_bytes()))
            if extra:data+=zstandard.ZstdCompressor().compress(b'{}\n')
            else:entry[3]+=1
            entry[2]=len(data);entry[5]=hashlib.sha256(data).digest()
            (root/'records.zst').write_bytes(data);(root/'rows.idx').write_bytes(INDEX.pack(*entry))
            manifest=json.loads((root/'manifest.json').read_bytes())
            for name in ('records.zst','rows.idx'):
                raw=(root/name).read_bytes();manifest['files'][name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
            raw=canonical(manifest);(root/'manifest.json').write_bytes(raw)
            reader=SourcePart(root,hashlib.sha256(raw).hexdigest(),self.package,'inventory',0)
            stream=reader.records_at([0])
            with self.assertRaises((ValueError,zstandard.ZstdError)):list(stream)
            self.assertFalse(stream.verified)


if __name__=='__main__':unittest.main()
