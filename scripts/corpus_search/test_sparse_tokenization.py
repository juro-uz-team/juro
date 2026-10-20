from contextlib import closing
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import time
import unittest
from test_discovery_catalog import Fixture
from test_sparse_profiles import Identities
from sparse_profiles import publish_sparse_profiles,SparseProfiles
from sparse_tokenization import ProductionTokenizer,tokenize_profiles
from sparse_postings import PostingRun
from publish_sparse_index import publish_sparse_index
from sparse_search import SparseIndex


class SparseTokenizationTests(unittest.TestCase):
    def test_real_production_analyzer_builds_authenticated_runs_from_source_profiles(self):
        platform=pathlib.Path(__file__).resolve().parents[2]/'apps'/'platform'
        loader=platform/'node_modules'/'tsx'/'dist'/'loader.mjs'
        if not shutil.which('node') or not loader.exists():self.skipTest('Node and installed platform tsx required')
        command=['node','--import',loader.as_uri(),str(platform/'scripts'/'tokenize-prepared-sparse.mts')]
        analyzer_pin=hashlib.sha256(b''.join((platform/'lib'/'legal-corpus'/name).read_bytes()
            for name in ['custom-bm25.ts','prepared-sparse-profile.ts','prepared-sparse-stream.ts'])).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture();identities=Identities(fixture)
            pin=publish_sparse_profiles(fixture,identities,root/'source')
            with closing(SparseProfiles(root/'source',pin,fixture.sha256,identities.manifest_sha256)) as profiles,closing(ProductionTokenizer(command)) as tokenizer:
                tokenization_pin=tokenize_profiles(profiles,tokenizer.tokenize,root/'tokenized',analyzer_pin,run_rows=3)
                manifest=json.loads((root/'tokenized'/'manifest.json').read_bytes())
                self.assertFalse(manifest['search_index'])
                self.assertEqual(manifest['analyzer_sha256'],analyzer_pin)
                self.assertEqual((manifest['profiles'],manifest['members'],manifest['postings']),(2,2,10))
                self.assertEqual(manifest['weighted_field_lengths'],{'title':2,'hierarchy':0,'article':0,'text':8})
                rows=[]
                for receipt in manifest['runs']:
                    with closing(PostingRun(root/'tokenized'/receipt['path'],receipt['sha256'],pin)) as run:rows.extend(run.rows())
                term=hashlib.sha256(b'word-v1\0official').digest()
                self.assertEqual(sorted((ordinal,frequencies,weight) for key,ordinal,frequencies,weight in rows if key==term),
                                 [(0,(0,0,0,1),1),(1,(0,0,0,1),1)])
                final_pin=publish_sparse_index(root/'tokenized',tokenization_pin,root/'index',fan_in=2)
                final_raw=(root/'index'/'manifest.json').read_bytes();final=json.loads(final_raw)
                self.assertEqual(hashlib.sha256(final_raw).hexdigest(),final_pin)
                self.assertTrue(final['qualification_required'])
                self.assertEqual(final['weighted_field_lengths'],manifest['weighted_field_lengths'])
                with closing(PostingRun(root/'index'/final['run']['path'],final['run']['sha256'],pin)) as run:
                    self.assertEqual(list(run.rows()),sorted(rows,key=lambda row:row[:2]))
                self.assertEqual((root/'index'/'profiles.sqlite').read_bytes(),(root/'tokenized'/'profiles.sqlite').read_bytes())
                law=hashlib.sha256(b'word-v1\0law').digest()
                module=(platform/'lib'/'legal-corpus'/'custom-bm25.ts').as_uri()
                reference_script='import {scoreCustomBm25Term as score} from '+json.dumps(module)+'; console.log(JSON.stringify(score({termFrequency:1,documentFrequency:2,documentCount:2,fieldLength:1,averageFieldLength:1,field:"title"})+score({termFrequency:1,documentFrequency:2,documentCount:2,fieldLength:4,averageFieldLength:4,field:"text"})));'
                expected_score=json.loads(subprocess.check_output(['node','--import',loader.as_uri(),'--input-type=module','-e',reference_script]))
                with closing(SparseIndex(root/'index',final_pin,pin,analyzer_pin)) as index:
                    hits=index.search([term,law,term],time.monotonic()+5)
                    self.assertEqual([row['profile_ordinal'] for row in hits],[0,1])
                    for hit in hits:self.assertAlmostEqual(hit['score'],expected_score,places=14)
                    self.assertEqual(index.search([b'z'*32],time.monotonic()+5),[])
                    with self.assertRaisesRegex(TimeoutError,'deadline'):index.search([term],time.monotonic()-1)
                    self.assertEqual(len(index.search([term],time.monotonic()+5,limit=1)),1)
                    with (root/'index'/'profiles.sqlite').open('ab') as target:target.write(b'changed')
                    with self.assertRaisesRegex(ValueError,'metadata_changed'):index.search([term],time.monotonic()+5)
                def wrong_identity(row):
                    result=tokenizer.tokenize(row);result['id']='f'*64;return result
                with self.assertRaisesRegex(ValueError,'identity_mismatch'):tokenize_profiles(profiles,wrong_identity,root/'invalid',analyzer_pin)
                self.assertFalse((root/'invalid'/'manifest.json').exists())
                manifest['weighted_field_lengths']['title']+=1
                invalid_raw=json.dumps(manifest).encode();(root/'tokenized'/'manifest.json').write_bytes(invalid_raw)
                with self.assertRaisesRegex(ValueError,'field_population_mismatch'):
                    publish_sparse_index(root/'tokenized',hashlib.sha256(invalid_raw).hexdigest(),root/'bad-index',fan_in=2)
                self.assertFalse((root/'bad-index'/'manifest.json').exists())


if __name__=='__main__':unittest.main()
