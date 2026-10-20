import hashlib
import json
import pathlib
import tempfile
import unittest
from package import VerifiedStream
from test_discovery_chunks import Fixture as ChunkFixture
from works import WorkIndex,build_work_index
from publish_membership import publish_memberships
from membership import MembershipIndex
from discovery_catalog import PreparedDiscoveryCatalog


class Fixture(ChunkFixture):
    sha256='a'*64;completion_sha256='d'*64;ready=True;count=2;starts=[0];ends=[2];shards=[{'job':'p000-00000'}]
    files={'embedding-inputs/manifest.json':{'sha256':'b'*64},'memberships/manifest.json':{'sha256':'c'*64}}
    def __init__(self):
        super().__init__();self.handoff['shards'].update(inventory=[{}],prepared=[{}]);self.memberships['receipts']=[{},{}]
        self.embeddings={'mapping_receipts':[{}]};self.input_values=[];new_inputs={}
        for index,member in enumerate(self.members):
            value=self.inputs[member[0]];raw=json.dumps(value,separators=(',',':'));key=hashlib.sha256(raw.encode()).digest()
            self.input_values.append((index,key,raw,12));new_inputs[key]=value
            self.members[index]=(key,*member[1:])
        self.inputs=new_inputs
        self.assignment={'scheme':'LBC','node':'12','scope':'document','inherited':True,'historical_validity':'not_established'}
        self.prepared=[{'work':chunk['work'],'assignments':[self.assignment],
          'gaps':[{'kind':'missing_region'}],'selected_edition':['2020-01-01'],
          'units':[{'ordinal':12,'text':chunk['officialText'],**{field:chunk[field] for field in ['locator','method','language','script','hierarchy']}}]} for chunk in self.chunks]
    def records(self,kind,part):
        if kind=='chunks':return super().records(kind,part)
        values=self.prepared if kind=='prepared' else [{'id':row['work'],'url':'https://lex.uz/docs/123','state':'done'} for row in self.prepared]
        return VerifiedStream(lambda:iter(enumerate(values)))
    def input_rows(self,part):return VerifiedStream(lambda:iter(self.input_values))
    def input_hashes(self,ids):return [self.input_values[i][1] for i in ids]
    def assert_unchanged(self):pass
    def mapping_rows(self,part):return VerifiedStream(lambda:iter((row[1],row[0],'block:12') for row in self.members))
    def membership_rows(self,part):
        row=self.members[part];return VerifiedStream(lambda:iter([(part,row[2],row[1],self.chunks[part]['work'])]))


class CatalogTests(unittest.TestCase):
    def test_published_join_returns_source_units_and_all_classification_provenance_without_eligibility_claims(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture();pin=build_work_index(fixture,root/'works')
            works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                membership_pin=publish_memberships(fixture,works,fixture,root/'members')
                members=MembershipIndex(root/'members',membership_pin)
                catalog=PreparedDiscoveryCatalog(fixture,fixture,members,works)
                result=catalog.read([1,0])
                self.assertEqual([row['work'] for row in result['records']],['work:1','work:0'])
                self.assertTrue(all(row['status']=='discovery_only' for row in result['records']))
                self.assertEqual(result['sources']['work:0']['prepared']['assignments'],[fixture.assignment])
                self.assertEqual(result['sources']['work:0']['prepared']['gaps'],[{'kind':'missing_region'}])
                self.assertEqual(result['records'][0]['chunk']['articleNumber'],'publisher-position-999')
                self.assertNotIn('units',result['sources']['work:0']['prepared'])
                self.assertEqual(len(result['units']),2)
                exact=catalog.read_exact([(1,1),(0,0)])
                self.assertEqual(exact,{**result,'continuations':{},'records':[
                    {**record,'vector_ordinal':vector} for record,vector in zip(result['records'],[1,0])]})
                with self.assertRaisesRegex(ValueError,'membership_missing'):catalog.read_exact([(1,0)])
                with self.assertRaisesRegex(ValueError,'membership_missing'):catalog.read_exact([(0,2)])
                with self.assertRaisesRegex(ValueError,'lookup_invalid'):catalog.read_exact([(0,-1)])
                with self.assertRaisesRegex(ValueError,'request_bound'):catalog.read([0]*17)
                with self.assertRaisesRegex(ValueError,'cursor_invalid'):catalog.read([0],after={'wrong':0})
                fixture.prepared[0]['units'][0]['method']='unsupported'
                with self.assertRaisesRegex(ValueError,'metadata_mismatch'):catalog.read([0])
                members.manifest['work_manifest_sha256']='f'*64
                with self.assertRaisesRegex(ValueError,'generation_mismatch'):PreparedDiscoveryCatalog(fixture,fixture,members,works)
            finally:works.close()


if __name__=='__main__':unittest.main()
