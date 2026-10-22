import hashlib
import json
import unittest
from package import VerifiedStream
from discovery_inputs import hydrate_vector_inputs


class Fixture:
    sha256='a'*64;ends=[2,3];starts=[0,2];shards=[{'job':'p000-00000'},{'job':'p000-00002'}]
    def __init__(self):
        self.rows=[];self.bad=False;self.mismatch=False
        for i in range(3):
            text=json.dumps({'documentTitle':'Law','documentType':'code','language':'ru','script':'Cyrl','officialText':f'Exact source text {i}.'})
            self.rows.append((i,hashlib.sha256(text.encode()).digest(),text,12))
    def input_hashes(self,ids):return [b'x'*32 if self.mismatch else self.rows[i][1] for i in ids]
    def assert_unchanged(self):pass
    def input_rows(self,part):
        if part!=0:raise ValueError('partition_invalid')
        def stream():
            yield from self.rows
            if self.bad:raise ValueError('trailing_receipt_invalid')
        return VerifiedStream(stream)


class DiscoveryInputTests(unittest.TestCase):
    def test_compact_input_retains_optional_publisher_hierarchy(self):
        fixture=Fixture()
        value=json.loads(fixture.rows[0][2]);value['hierarchy']=['Chapter I','Employment']
        raw=json.dumps(value);fixture.rows[0]=(0,hashlib.sha256(raw.encode()).digest(),raw,12)
        self.assertEqual(hydrate_vector_inputs(fixture,fixture,[0])[0]['input'],value)
        for hierarchy in ['Chapter I',[None],[1],{}]:
            value['hierarchy']=hierarchy;raw=json.dumps(value)
            fixture.rows[0]=(0,hashlib.sha256(raw.encode()).digest(),raw,12)
            with self.assertRaisesRegex(ValueError,'codec_invalid'):
                hydrate_vector_inputs(fixture,fixture,[0])

    def test_split_job_offsets_and_repeated_hits_keep_exact_input_identity(self):
        fixture=Fixture();rows=hydrate_vector_inputs(fixture,fixture,[2,0,2])
        self.assertEqual([row['input_row'] for row in rows],[2,0,2])
        self.assertEqual([row['input']['officialText'] for row in rows],['Exact source text 2.','Exact source text 0.','Exact source text 2.'])
    def test_hash_mismatch_trailing_failure_and_bounds_cannot_return_text(self):
        fixture=Fixture();fixture.mismatch=True
        with self.assertRaisesRegex(ValueError,'vector_mismatch'):hydrate_vector_inputs(fixture,fixture,[0])
        fixture.mismatch=False;fixture.bad=True
        with self.assertRaisesRegex(ValueError,'trailing'):hydrate_vector_inputs(fixture,fixture,[0])
        fixture.bad=False
        with self.assertRaisesRegex(ValueError,'byte_bound'):hydrate_vector_inputs(fixture,fixture,[0],max_bytes=1)
        with self.assertRaisesRegex(ValueError,'request_bound'):hydrate_vector_inputs(fixture,fixture,[0]*129)


if __name__=='__main__':unittest.main()
