import copy
import unittest
from prepared import PreparedCorrespondence,canonical,digest


class PreparedCorrespondenceTests(unittest.TestCase):
    def setUp(self):
        self.row={'work':'refresh:уз:1','units':[{'ordinal':4,'text':'Привет мир','locator':'block:9','method':'publisher_html'},
                                             {'ordinal':7,'text':'Not indexed','locator':'page:1'}],
                  'assignments':[{'scheme':'LBC','scope':'document','historical_validity':'not_established'}]}
        self.chunks=[self.chunk(0,'Привет '),self.chunk(1,'мир')]

    def chunk(self,ordinal,text):
        identity={'ordinal':ordinal,'policyVersion':'retrieval-chunk-v1','snapshotProvisionId':self.row['work']+':4',
                  'targetTokens':1024,'officialTextSha256':digest(text.encode())}
        return {**identity,'work':self.row['work'],'id':'retrieval-chunk-v1:'+digest(canonical(identity)),
                'officialText':text,'articleNumber':'block:9','locator':'block:9','method':'publisher_html'}

    def test_exact_coverage_preserves_observations_without_legal_claims(self):
        original=copy.deepcopy(self.row);check=PreparedCorrespondence(self.row)
        for chunk in self.chunks:check.add(chunk)
        proof=check.finish()
        self.assertEqual(self.row,original)
        self.assertEqual(proof['covered_units'][0]['text_sha256'],digest('Привет мир'.encode()))
        self.assertEqual(proof['unindexed_nonempty_units'],[7])
        self.assertEqual(proof['legal_completeness'],'not_established')
        self.assertEqual(proof['temporal_applicability'],'not_established')

    def test_valid_chunk_hashes_cannot_hide_missing_or_repeated_parent_text(self):
        for chunks in [[self.chunks[0]],[self.chunk(0,'Привет '),self.chunk(1,'Привет ')]]:
            with self.assertRaisesRegex(ValueError,'parent_(text_mismatch|overflow)'):
                check=PreparedCorrespondence(self.row)
                for chunk in chunks:check.add(chunk)
                check.finish()

    def test_identity_work_order_and_locator_mismatches_fail(self):
        cases=[({'work':'another'},'work_mismatch'),({'id':'retrieval-chunk-v1:'+'0'*64},'identity_mismatch'),
               ({'articleNumber':'9'},'locator_mismatch'),({'officialText':'other'},'text_hash_mismatch')]
        for change,message in cases:
            with self.assertRaisesRegex(ValueError,message):PreparedCorrespondence(self.row).add({**self.chunks[0],**change})
        with self.assertRaisesRegex(ValueError,'sequence_gap'):PreparedCorrespondence(self.row).add(self.chunks[1])
        check=PreparedCorrespondence(self.row);check.add(self.chunks[0])
        with self.assertRaisesRegex(ValueError,'order_invalid'):check.add(self.chunks[0])

    def test_duplicate_units_fail_and_empty_exclusion_is_explicit(self):
        with self.assertRaisesRegex(ValueError,'unit_invalid'):
            PreparedCorrespondence({**self.row,'units':[self.row['units'][0]]*2})
        proof=PreparedCorrespondence({'work':'excluded','units':[],'scope_exclusion':{'reason':'navigation'}}).finish()
        self.assertEqual(proof['chunks'],0);self.assertEqual(proof['covered_units'],[])


if __name__=='__main__':unittest.main()
