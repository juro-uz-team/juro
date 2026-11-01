import hashlib
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from package import VerifiedStream
from prepared import canonical
from works import work_key
from discovery_chunks import chunk_original_input,hydrate_membership_chunks


class Fixture:
    def __init__(self,hierarchy=None):
        self.bad=False;self.handoff={'shards':{'chunks':[{'count':1},{'count':1}]}};self.memberships={'rows':2}
        self.chunks=[];self.members=[];self.inputs={}
        for i in range(2):
            text=f'Exact official text {i}.';work=f'work:{i}'
            fields={'ordinal':0,'policyVersion':'retrieval-chunk-v1','snapshotProvisionId':work+':12','targetTokens':512,
              'officialTextSha256':hashlib.sha256(text.encode()).hexdigest()}
            identity=hashlib.sha256(canonical(fields)).digest()
            chunk={**fields,'id':'retrieval-chunk-v1:'+identity.hex(),'work':work,'officialText':text,
              'articleNumber':'publisher-position-999','articleTitle':None,'sourceDocumentTitle':'Law',
              'documentType':'code','hierarchy':hierarchy or [],'language':'ru','script':'Cyrl','locator':'block:12','method':'publisher_html'}
            compact=bytes([i])*32
            self.chunks.append(chunk);self.members.append((compact,hashlib.sha256(chunk_original_input(chunk)).digest(),identity,work_key(work),i))
            self.inputs[compact]={'documentTitle':'Law','documentType':'code','language':'ru','script':'Cyrl','officialText':text}
            if hierarchy is not None:self.inputs[compact]['hierarchy']=list(hierarchy)
    def records(self,kind,part):
        def stream():
            yield 0,self.chunks[part]
            if self.bad:raise ValueError('trailing_receipt_invalid')
        return VerifiedStream(stream)


class ChunkTests(unittest.TestCase):
    def test_retained_hydration_preserves_source_and_rejects_wrong_record_associations(self):
        fixture=Fixture(['Глава I','Ўзбек 😀'])
        fixture.trust_prepared=True
        fixture.source_projection=SimpleNamespace(records_at=lambda kind,part,rows,**kwargs:
            fixture.records(kind,part))
        with patch('discovery_chunks.hashlib',SimpleNamespace(sha256=lambda *_:
                self.fail('retained content authentication'))):
            self.assertEqual(hydrate_membership_chunks(fixture,fixture.members,None),fixture.chunks)
            self.assertEqual(hydrate_membership_chunks(fixture,fixture.members,fixture.inputs),fixture.chunks)
            member=fixture.members[0]
            for invalid in [(member[0],member[1],b'x'*32,member[3],member[4]),
                            (member[0],member[1],member[2],b'x'*32,member[4])]:
                with self.assertRaisesRegex(ValueError,'identity_mismatch'):
                    hydrate_membership_chunks(fixture,[invalid],None)

    def test_reconstructed_compact_bytes_authenticate_both_codecs(self):
        for hierarchy in (None,['Глава "I"','Ўзбек 😀\nsection']):
            fixture=Fixture(hierarchy)
            members=[]
            for member in fixture.members:
                key=hashlib.sha256(canonical(fixture.inputs[member[0]])+b'\n').digest()
                members.append((key,*member[1:]))
            self.assertEqual(hydrate_membership_chunks(fixture,members,None),fixture.chunks)
            corrupted=[(b'x'*32,*members[0][1:])]
            with self.assertRaisesRegex(ValueError,'compact_input_mismatch'):
                hydrate_membership_chunks(fixture,corrupted,None)

    def test_reordered_shards_use_membership_order_without_changing_identities(self):
        fixture=Fixture()
        fixture.chunks.reverse()
        fixture.chunk_parts=[1,0]
        result=hydrate_membership_chunks(fixture,fixture.members,fixture.inputs)
        self.assertEqual([row['work'] for row in result],['work:0','work:1'])
        fixture.chunk_parts=[0,0]
        with self.assertRaisesRegex(ValueError,'chunk_order'):
            hydrate_membership_chunks(fixture,fixture.members,fixture.inputs)

    def test_exact_chunk_input_work_and_global_ordinal_join_preserves_locators(self):
        fixture=Fixture();result=hydrate_membership_chunks(fixture,[fixture.members[1],fixture.members[0],fixture.members[1]],fixture.inputs)
        self.assertEqual([row['work'] for row in result],['work:1','work:0','work:1'])
        self.assertEqual(result[0]['articleNumber'],'publisher-position-999')
        self.assertEqual(result[0]['method'],'publisher_html')
    def test_locator_does_not_override_identity_and_corrupt_compact_or_trailing_data_fail(self):
        fixture=Fixture();fixture.chunks[0]['articleNumber']='161'
        with self.assertRaisesRegex(ValueError,'original_input'):hydrate_membership_chunks(fixture,[fixture.members[0]],fixture.inputs)
        fixture=Fixture();fixture.inputs[fixture.members[0][0]]['officialText']='Different source'
        with self.assertRaisesRegex(ValueError,'compact_input'):hydrate_membership_chunks(fixture,[fixture.members[0]],fixture.inputs)
        fixture=Fixture();fixture.bad=True
        with self.assertRaisesRegex(ValueError,'trailing'):hydrate_membership_chunks(fixture,[fixture.members[0]],fixture.inputs)


if __name__=='__main__':unittest.main()
