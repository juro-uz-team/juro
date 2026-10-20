import json
import hashlib
import pathlib
import shutil
import sqlite3
import tempfile
import unittest
import zlib
from contextlib import closing
from package import VerifiedStream
from test_discovery_catalog import Fixture
from sparse_profiles import publish_sparse_profiles,SparseProfiles


class Identities:
    manifest_sha256='e'*64
    def __init__(self,fixture):
        self.manifest={'vector_completion_sha256':fixture.completion_sha256}
        self.values={row[0]:i for i,row in enumerate(fixture.members)}
    def lookup(self,keys):return [self.values.get(key) for key in keys]


class SparseProfileTests(unittest.TestCase):
    def test_resume_copied_committed_batch_matches_full_publication_after_shard_reorder(self):
        fixture=Fixture();identities=Identities(fixture)
        mapping=list(fixture.mapping_rows(0))
        original_chunks=list(fixture.chunks);original_members=list(fixture.members)
        fixture.chunks=[dict(original_chunks[i%2]) for i in range(1026)]
        fixture.members=[original_members[i%2] for i in range(1026)]
        fixture.handoff['shards']['chunks']=[{'count':1} for _ in fixture.chunks]
        fixture.memberships={'rows':1026,'receipts':[{'rows':1} for _ in fixture.chunks]}
        fixture.mapping_rows=lambda part:VerifiedStream(lambda:iter(mapping))
        member_rows=[(i,m[2],m[1],fixture.chunks[i]['work']) for i,m in enumerate(fixture.members)]
        fixture.membership_rows=lambda part:VerifiedStream(lambda:iter([member_rows[part]]))
        def interrupt(status):
            if status=={'phase':'sparse-memberships','rows':1024}:raise RuntimeError('interrupted')
        with tempfile.TemporaryDirectory() as directory:
            base=pathlib.Path(directory);failed=base/'failed'
            with self.assertRaisesRegex(RuntimeError,'interrupted'):
                publish_sparse_profiles(fixture,identities,failed,interrupt)
            partial=failed/'profiles.partial';digest=hashlib.sha256(partial.read_bytes()).hexdigest()
            recovery=base/'recovery';recovery.mkdir();shutil.copyfile(partial,recovery/'profiles.partial')
            receipt={'database_sha256':digest,'members':1024,'profiles':2,'package_sha256':fixture.sha256,
                     'vector_identity_sha256':identities.manifest_sha256,
                     'vector_completion_sha256':fixture.completion_sha256,'chunk_parts':list(range(1026))}
            fixture.chunks[1024],fixture.chunks[1025]=fixture.chunks[1025],fixture.chunks[1024]
            fixture.chunk_parts=list(range(1024))+[1025,1024]
            pin=publish_sparse_profiles(fixture,identities,recovery,resume=receipt)
            full=base/'full';full_pin=publish_sparse_profiles(fixture,identities,full)
            with closing(SparseProfiles(recovery,pin,fixture.sha256,identities.manifest_sha256)) as recovered:
                with closing(SparseProfiles(full,full_pin,fixture.sha256,identities.manifest_sha256)) as fresh:
                    self.assertEqual(list(recovered.rows()),list(fresh.rows()))
            self.assertEqual(hashlib.sha256(partial.read_bytes()).hexdigest(),digest)
            for field,value in [('members',1023),('database_sha256','0'*64),
                                ('package_sha256','0'*64),('chunk_parts',[1,0]+list(range(2,1026)))]:
                rejected=base/field;rejected.mkdir();shutil.copyfile(partial,rejected/'profiles.partial')
                with self.assertRaisesRegex(ValueError,'resume'):
                    publish_sparse_profiles(fixture,identities,rejected,resume={**receipt,field:value})
                self.assertFalse((rejected/'manifest.json').exists())

    def test_reordered_shards_publish_membership_order_for_runtime_hydration(self):
        fixture=Fixture();identities=Identities(fixture)
        members=[list(fixture.membership_rows(part)) for part in range(2)]
        fixture.membership_rows=lambda part:VerifiedStream(lambda:iter(members[part]))
        fixture.chunks.reverse()
        fixture.chunk_parts=[1,0]
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)/'profiles'
            pin=publish_sparse_profiles(fixture,identities,root)
            with closing(SparseProfiles(root,pin,fixture.sha256,identities.manifest_sha256)) as profiles:
                self.assertEqual(profiles.manifest['chunk_parts'],[1,0])
                rows=list(profiles.rows())
                self.assertEqual(sorted(row['first_membership'] for row in rows),[0,1])

    def test_authenticated_profiles_preserve_fields_and_membership_multiplicity(self):
        fixture=Fixture();identities=Identities(fixture)
        # A second legal membership can share the same original embedding input.
        fixture.chunks.append(dict(fixture.chunks[0]));fixture.members.append(fixture.members[0])
        fixture.handoff['shards']['chunks'].append({'count':1})
        fixture.memberships={'rows':3,'receipts':[{}, {}, {}]}
        original_mapping=fixture.mapping_rows
        fixture.mapping_rows=lambda part:VerifiedStream(lambda:iter(list(original_mapping(part))[:2]))
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)/'profiles'
            pin=publish_sparse_profiles(fixture,identities,root)
            manifest=json.loads((root/'manifest.json').read_text())
            self.assertEqual((manifest['members'],manifest['profiles']),(3,2))
            self.assertFalse(manifest['search_index'])
            with closing(sqlite3.connect(root/'profiles.sqlite')) as db:
                rows=db.execute('SELECT vector_ordinal,members,first_membership,fields FROM profiles ORDER BY vector_ordinal').fetchall()
            self.assertEqual([row[:3] for row in rows],[(0,2,0),(1,1,1)])
            fields=json.loads(zlib.decompress(rows[0][3]))
            self.assertEqual(fields,{'title':'Law','hierarchy':'','article':'','text':'Exact official text 0.'})
            self.assertNotIn('publisher-position-999',str(fields))
            with closing(SparseProfiles(root,pin,fixture.sha256,identities.manifest_sha256)) as profiles:
                stream=profiles.rows();actual=list(stream)
                self.assertTrue(stream.verified)
                self.assertEqual(sum(row['members'] for row in actual),3)
                self.assertEqual(sorted(row['vector_ordinal'] for row in actual),[0,1])
                self.assertEqual(actual[0]['fields']['article'],'')
                with (root/'profiles.sqlite').open('ab') as target:target.write(b'changed')
                with self.assertRaisesRegex(ValueError,'storage_changed'):list(profiles.rows())
            with self.assertRaisesRegex(ValueError,'database_mismatch'):
                SparseProfiles(root,pin,fixture.sha256,identities.manifest_sha256)

    def test_invalid_sources_never_publish_a_manifest(self):
        for failure in ['missing_vector','wrong_work','trailing_receipt','population']:
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as directory:
                fixture=Fixture();identities=Identities(fixture)
                if failure=='missing_vector':identities.values.clear()
                elif failure=='wrong_work':
                    membership_rows=fixture.membership_rows
                    fixture.membership_rows=lambda part:VerifiedStream(lambda:iter((ordinal,chunk,original,'wrong') for ordinal,chunk,original,work in membership_rows(part)))
                elif failure=='trailing_receipt':fixture.bad=True
                else:fixture.memberships['rows']=3
                root=pathlib.Path(directory)/'profiles'
                with self.assertRaises(ValueError):publish_sparse_profiles(fixture,identities,root)
                self.assertFalse((root/'manifest.json').exists())


if __name__=='__main__':unittest.main()
