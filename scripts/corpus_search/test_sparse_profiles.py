import json
import pathlib
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
