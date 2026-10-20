import hashlib
import unittest
from package import VerifiedStream
from prepared import canonical
from works import work_key
from discovery_chunks import chunk_original_input,hydrate_membership_chunks


class Fixture:
    def __init__(self):
        self.bad=False;self.handoff={'shards':{'chunks':[{'count':1},{'count':1}]}};self.memberships={'rows':2}
        self.chunks=[];self.members=[];self.inputs={}
        for i in range(2):
            text=f'Exact official text {i}.';work=f'work:{i}'
            fields={'ordinal':0,'policyVersion':'retrieval-chunk-v1','snapshotProvisionId':work+':12','targetTokens':512,
              'officialTextSha256':hashlib.sha256(text.encode()).hexdigest()}
            identity=hashlib.sha256(canonical(fields)).digest()
            chunk={**fields,'id':'retrieval-chunk-v1:'+identity.hex(),'work':work,'officialText':text,
              'articleNumber':'publisher-position-999','articleTitle':None,'sourceDocumentTitle':'Law',
              'documentType':'code','hierarchy':[],'language':'ru','script':'Cyrl','locator':'block:12','method':'publisher_html'}
            compact=bytes([i])*32
            self.chunks.append(chunk);self.members.append((compact,hashlib.sha256(chunk_original_input(chunk)).digest(),identity,work_key(work),i))
            self.inputs[compact]={'documentTitle':'Law','documentType':'code','language':'ru','script':'Cyrl','officialText':text}
    def records(self,kind,part):
        def stream():
            yield 0,self.chunks[part]
            if self.bad:raise ValueError('trailing_receipt_invalid')
        return VerifiedStream(stream)


class ChunkTests(unittest.TestCase):
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
