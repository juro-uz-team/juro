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
from discovery_catalog import PreparedDiscoveryCatalog,project_publisher_fields
from discovery_json import encode_discovery_json,ProjectedRecordDecoder
from prepared import canonical


class Fixture(ChunkFixture):
    sha256='a'*64;completion_sha256='d'*64;ready=True;count=2;starts=[0];ends=[2];shards=[{'job':'p000-00000'}]
    files={'embedding-inputs/manifest.json':{'sha256':'b'*64},'memberships/manifest.json':{'sha256':'c'*64}}
    def __init__(self,hierarchy=None):
        super().__init__(hierarchy);self.handoff['shards'].update(inventory=[{}],prepared=[{}]);self.memberships['receipts']=[{},{}]
        self.embeddings={'mapping_receipts':[{}]};self.input_values=[];new_inputs={}
        for index,member in enumerate(self.members):
            value=self.inputs[member[0]];raw=(canonical(value)+b'\n').decode();key=hashlib.sha256(raw.encode()).digest()
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
    def test_publisher_contents_survive_large_relationship_projection_without_changing_source(self):
        links=[{'kind':'publisher_link','href':'#collapse123','label':'Chapter one','locator':''},
               {'kind':'publisher_link','href':'#collapse123','label':'Chapter one','locator':''},
               {'kind':'publisher_link','href':'#collapse456','label':'Quoted heading','locator':'123'},
               {'kind':'publisher_link','href':'/docs/other#collapse789','label':'Other source','locator':''},
               {'kind':'publisher_link','href':'#123','label':'Ordinary link','locator':''},
               {'kind':'publisher_link','href':'#collapse-789','label':'Another chapter','locator':''},
               {'kind':'publisher_link','href':'#collapse111','label':'','locator':''},
               {'kind':'other','href':'#collapse222','label':'Not publisher navigation','locator':''}]
        record={'work':'work:one','relationships':links+[{'label':'x'*70000}], 'units':[{'text':'Original law'}]}
        original=json.dumps(record)
        projected=project_publisher_fields(record)
        self.assertEqual(projected['publisher_contents'],[
            {'position':'123','title':'Chapter one'}, {'position':'-789','title':'Another chapter'}])
        self.assertNotIn('relationships',projected)
        self.assertIn('relationships',projected['discovery_projection']['fields'])
        self.assertEqual(json.dumps(record),original)
        self.assertEqual(projected['units'],record['units'])

    def test_small_publisher_contents_and_cached_projection_keep_request_owned_values(self):
        record={'work':'small','relationships':[{'kind':'publisher_link','href':'#collapse1','label':'Chapter','locator':''}]}
        projected=project_publisher_fields(record)
        self.assertEqual(projected['relationships'],record['relationships'])
        self.assertNotIn('discovery_projection',projected)
        self.assertEqual(projected['publisher_contents'],[{'position':'1','title':'Chapter'}])
        record['relationships'].append({'label':'large unrelated link '*10000})
        raw=json.dumps(record).encode()
        decode=ProjectedRecordDecoder(project_publisher_fields)
        first=decode(raw)
        self.assertTrue(decode.entries)
        first['publisher_contents'][0]['title']='Caller mutation'
        self.assertEqual(decode(raw)['publisher_contents'][0]['title'],'Chapter')
        self.assertEqual(record['relationships'][0]['label'],'Chapter')

    def test_source_read_preserves_inventory_without_prepared_text(self):
        class InventoryFixture(Fixture):
            def records(self,kind,part):
                if kind!='inventory':return super().records(kind,part)
                values=[{'id':row['work'],'url':'https://lex.uz/docs/123','state':'done'} for row in self.prepared]
                values.append({'id':'refresh','url':'https://lex.uz/docs/123','state':'excluded',
                               'error':'catalog_position_only_change','receipt':None})
                return VerifiedStream(lambda:iter(enumerate(values)))
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=InventoryFixture()
            pin=build_work_index(fixture,root/'works');works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                member_pin=publish_memberships(fixture,works,fixture,root/'members')
                catalog=PreparedDiscoveryCatalog(fixture,fixture,MembershipIndex(root/'members',member_pin),works)
                result=catalog.read_sources(['refresh','work:0'])
                self.assertIsNone(result['sources']['refresh']['prepared'])
                self.assertEqual(result['sources']['refresh']['inventory']['error'],'catalog_position_only_change')
                self.assertEqual(result['sources']['work:0']['prepared'],fixture.prepared[0])
                self.assertIsNone(catalog.read_sources(['refresh'])['sources']['refresh']['prepared'])
            finally:works.close()

    def test_complete_source_read_preserves_unselected_units_tables_and_extraction_gaps(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture()
            fixture.prepared[0]['units'].append({'ordinal':13,'text':'Complementary provision outside the search hit.'})
            fixture.prepared[0]['tables']=[{'rows':[['Complete table. '*7000]]}]
            fixture.prepared[0]['relationships']=[{'href':'/docs/123','label':'Retained publisher link. '*5000}]
            fixture.prepared[0]['discoveries']=[{'text':'Retained publisher discovery. '*5000}]
            pin=build_work_index(fixture,root/'works');works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                member_pin=publish_memberships(fixture,works,fixture,root/'members')
                catalog=PreparedDiscoveryCatalog(fixture,fixture,MembershipIndex(root/'members',member_pin),works)
                result=catalog.read_sources(['work:0'])
                self.assertEqual(result['package_sha256'],fixture.sha256)
                self.assertEqual(result['work_index_sha256'],pin)
                self.assertEqual(result['sources']['work:0']['prepared'],fixture.prepared[0])
                self.assertEqual(result['sources']['work:0']['inventory']['id'],'work:0')
                with self.assertRaisesRegex(ValueError,'request_bound'):catalog.read_sources(['work:0']*2)
                with self.assertRaisesRegex(ValueError,'missing'):catalog.read_sources(['unknown'])
                with self.assertRaisesRegex(ValueError,'byte_bound|response_bound'):catalog.read_sources(['work:0'],max_bytes=1024)
            finally:works.close()

    def test_large_media_transcriptions_keep_receipts_and_selected_units(self):
        from discovery_catalog import project_publisher_fields
        record={'work':'media:one','pages':[{'text':'Page text. '*10000}],
                'original_units':[{'text':'Original transcript. '*10000}],
                'relationships':[{'href':'/docs/123','label':'Retained publisher link. '*5000}],
                'discoveries':[{'text':'Retained publisher discovery. '*5000}],
                'units':[{'ordinal':1,'text':'Selected complete unit.'}],
                'assignments':[{'scope':'document','node':'classification'}],
                'gaps':[{'kind':'missing_region'}],'warnings':['OCR confidence']}
        before=json.loads(json.dumps(record))
        projected=project_publisher_fields(record)
        self.assertNotIn('pages',projected)
        self.assertNotIn('original_units',projected)
        for field in ['pages','original_units','relationships','discoveries']:
            self.assertNotIn(field,projected)
            raw=json.dumps(record[field],ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
            self.assertEqual(projected['discovery_projection']['fields'][field],
                {'encoding':'json-utf8-v1','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
        for field in ['units','assignments','gaps','warnings']:
            self.assertEqual(projected[field],record[field])
        self.assertEqual(record,before)
        self.assertEqual(project_publisher_fields({'work':'small','pages':[{'text':'Short.'}]}),
                         {'work':'small','pages':[{'text':'Short.'}]})

    def test_large_publisher_tables_have_explicit_receipts_without_losing_selected_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture(['Chapter'])
            tables=[{'locator':'table-one','rows':[['A published value. '*6000]]}]
            fixture.prepared[0]['tables']=tables
            fixture.prepared[1]['tables']=[{'locator':'small','rows':[['Small table.']]}]
            pin=build_work_index(fixture,root/'works');works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                member_pin=publish_memberships(fixture,works,fixture,root/'members')
                catalog=PreparedDiscoveryCatalog(fixture,fixture,MembershipIndex(root/'members',member_pin),works)
                packet=catalog.read_exact([(0,0),(1,1)],max_bytes=16*1024)
                source=packet['sources']['work:0']['prepared']
                self.assertNotIn('tables',source)
                raw=json.dumps(tables,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
                self.assertEqual(source['discovery_projection'],{'policy':'publisher-field-receipts-v1','fields':{
                    'tables':{'encoding':'json-utf8-v1','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}}})
                self.assertEqual(packet['sources']['work:1']['prepared']['tables'],fixture.prepared[1]['tables'])
                self.assertNotIn('discovery_projection',packet['sources']['work:1']['prepared'])
                self.assertEqual(packet['units']['work:0:12']['text'],fixture.chunks[0]['officialText'])
                self.assertEqual(source['assignments'],fixture.prepared[0]['assignments'])
                self.assertEqual({key:value for key,value in source.items() if key!='discovery_projection'},
                    {key:value for key,value in fixture.prepared[0].items() if key not in ('tables','units')})
                self.assertEqual(fixture.prepared[0]['tables'],tables)
                fixture.prepared[0]['discovery_projection']={'policy':'untrusted'}
                with self.assertRaisesRegex(ValueError,'projection_field_conflict'):
                    catalog.read_exact([(0,0)])
            finally:works.close()

    def test_exact_response_byte_limit_includes_vector_identities_and_repeated_references(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture(['Глава I'])
            pin=build_work_index(fixture,root/'works');works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                member_pin=publish_memberships(fixture,works,fixture,root/'members')
                catalog=PreparedDiscoveryCatalog(fixture,fixture,MembershipIndex(root/'members',member_pin),works)
                references=[(1,1),(0,0),(1,1)]
                packet=catalog.read_exact(references)
                size=len(json.dumps(packet,ensure_ascii=False,separators=(',',':')).encode())
                self.assertEqual(catalog.read_exact(references,max_bytes=size),packet)
                from unittest.mock import patch
                expected=json.dumps(packet,ensure_ascii=False,separators=(',',':')).encode()
                with patch('discovery_catalog.encode_discovery_json',wraps=encode_discovery_json) as encode:
                    raw=catalog.read_exact(references,max_bytes=size,encoded=True)
                    self.assertEqual(raw,expected)
                    self.assertEqual(sum(isinstance(call.args[0],dict) and 'records' in call.args[0]
                                         for call in encode.call_args_list),1)
                with self.assertRaisesRegex(ValueError,'discovery_catalog_response_bound'):
                    catalog.read_exact(references,max_bytes=size-1,encoded=True)
                self.assertEqual([row['vector_ordinal'] for row in packet['records']],[1,0,1])
                with self.assertRaisesRegex(ValueError,'discovery_catalog_response_bound'):
                    catalog.read_exact(references,max_bytes=size-1)
            finally:works.close()

    def test_asset_hierarchy_authenticates_the_inventory_context_prefix(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture(['Chapter','Page 1'])
            fixture.prepared[0]['units'][0]['hierarchy']=['Page 1']
            records=fixture.records;prefix=['Chapter']
            def inventory_records(kind,part):
                if kind!='inventory':return records(kind,part)
                return VerifiedStream(lambda:iter((i,{'id':row['work'],'url':'https://lex.uz/files/123.pdf',
                    'kind':'asset','context':{'hierarchy':prefix}}) for i,row in enumerate(fixture.prepared)))
            fixture.records=inventory_records
            pin=build_work_index(fixture,root/'works');works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                member_pin=publish_memberships(fixture,works,fixture,root/'members')
                catalog=PreparedDiscoveryCatalog(fixture,fixture,MembershipIndex(root/'members',member_pin),works)
                packet=catalog.read_exact([(0,0)])
                self.assertEqual(packet['units']['work:0:12']['hierarchy'],['Page 1'])
                self.assertEqual(packet['records'][0]['chunk']['hierarchy'],['Chapter','Page 1'])
                prefix[:]=['Unrelated chapter']
                with self.assertRaisesRegex(ValueError,'unit_metadata_mismatch'):catalog.read_exact([(0,0)])
            finally:works.close()

    def test_exact_read_replays_mixed_script_segment_and_retains_source_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture()
            chunk=fixture.chunks[0];chunk['snapshotProvisionId']=chunk['work']+':12:segment:1'
            fields={key:chunk[key] for key in ['ordinal','policyVersion','snapshotProvisionId','targetTokens','officialTextSha256']}
            identity=hashlib.sha256(canonical(fields)).digest()
            chunk['id']='retrieval-chunk-v1:'+identity.hex()
            member=fixture.members[0];fixture.members[0]=(member[0],member[1],identity,member[3],member[4])
            parent=fixture.prepared[0]['units'][0]
            parent.update(text='Другой текст. '+chunk['officialText'],language='mixed',script='mixed')
            pin=build_work_index(fixture,root/'works');works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                member_pin=publish_memberships(fixture,works,fixture,root/'members')
                catalog=PreparedDiscoveryCatalog(fixture,fixture,MembershipIndex(root/'members',member_pin),works)
                result=catalog.read_exact([(0,0)])
                derived=result['units']['work:0:12:segment:1']
                self.assertEqual(derived['text'],chunk['officialText'])
                self.assertEqual(derived['derivation']['parent'],'work:0:12')
                self.assertEqual(result['units']['work:0:12'],parent)
                parent['text']='Другой текст. Different source text.'
                with self.assertRaisesRegex(ValueError,'unit_correspondence_invalid'):catalog.read_exact([(0,0)])
            finally:works.close()

    def test_source_projection_preserves_entire_packet_without_partition_scans(self):
        from source_projection import publish,SourceProjection
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture(['Глава I'])
            fixture.handoff['shards']['inventory']=[{'count':2}]
            fixture.handoff['shards']['prepared']=[{'count':2}]
            pin=build_work_index(fixture,root/'works');works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                membership_pin=publish_memberships(fixture,works,fixture,root/'members')
                catalog=PreparedDiscoveryCatalog(fixture,fixture,MembershipIndex(root/'members',membership_pin),works)
                references=[(1,1),(0,0),(1,1)]
                expected=catalog.read_exact(references)
                projection_pin=publish(fixture,root/'sources')
                fixture.source_projection=SourceProjection(root/'sources',projection_pin,fixture)
                with patch.object(fixture,'records',side_effect=AssertionError('partition scan')):
                    self.assertEqual(catalog.read_exact(references),expected)
            finally:works.close()

    def test_exact_read_bounds_selected_provisions_not_unselected_document_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture()
            fixture.prepared[0]['units'].append({'ordinal':13,'text':'Unselected text '*1000})
            fixture.prepared[0]['units'].append({'ordinal':'151:chars:0-722','text':'Unselected fragment'})
            pin=build_work_index(fixture,root/'works');works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                member_pin=publish_memberships(fixture,works,fixture,root/'members')
                catalog=PreparedDiscoveryCatalog(fixture,fixture,MembershipIndex(root/'members',member_pin),works)
                from unittest.mock import patch
                with patch.object(fixture,'input_rows',side_effect=AssertionError('unexpected partition scan')):
                    result=catalog.read_exact([(0,0)],max_bytes=4096)
                self.assertEqual(list(result['units']),['work:0:12'])
                self.assertEqual(result['sources']['work:0']['prepared']['assignments'],[fixture.assignment])
                fixture.prepared[0]['units'].append({'ordinal':13,'text':'Duplicate'})
                with self.assertRaisesRegex(ValueError,'units_invalid'):catalog.read_exact([(0,0)],max_bytes=4096)
                fixture.prepared[0]['units'].pop();fixture.bad=True
                with self.assertRaisesRegex(ValueError,'trailing'):catalog.read_exact([(0,0)],max_bytes=4096)
            finally:works.close()

    def test_exact_read_preserves_fragment_identity_and_rejects_suffix_collisions(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture()
            chunk=fixture.chunks[0]
            fragment='151:chars:0-722'
            chunk['snapshotProvisionId']=chunk['work']+':'+fragment
            fields={key:chunk[key] for key in ['ordinal','policyVersion','snapshotProvisionId','targetTokens','officialTextSha256']}
            identity=hashlib.sha256(canonical(fields)).digest()
            chunk['id']='retrieval-chunk-v1:'+identity.hex()
            member=fixture.members[0]
            fixture.members[0]=(member[0],member[1],identity,member[3],member[4])
            fixture.prepared[0]['units'][0]['ordinal']=fragment
            pin=build_work_index(fixture,root/'works');works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                member_pin=publish_memberships(fixture,works,fixture,root/'members')
                catalog=PreparedDiscoveryCatalog(fixture,fixture,MembershipIndex(root/'members',member_pin),works)
                result=catalog.read_exact([(0,0)])
                self.assertEqual(result['records'][0]['unit'],'work:0:'+fragment)
                self.assertEqual(result['units']['work:0:'+fragment]['ordinal'],fragment)
                fixture.prepared[0]['units'] += [{'ordinal':12,'text':'Block'}, {'ordinal':'12','text':'Collision'}]
                with self.assertRaisesRegex(ValueError,'units_invalid'):catalog.read_exact([(0,0)])
            finally:works.close()

    def test_unit_identity_rejects_invalid_scalar_values(self):
        from discovery_catalog import unit_ordinal_key
        for value in [None,True,False,-1,1.5,2**53,'','x'*513,[],{}]:
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError,'units_invalid'):unit_ordinal_key(value)

    def test_exact_read_authenticates_compact_input_hierarchy_against_source_chunk(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);fixture=Fixture(['Chapter I','Employment'])
            pin=build_work_index(fixture,root/'works');works=WorkIndex(root/'works',pin,fixture.sha256)
            try:
                membership_pin=publish_memberships(fixture,works,fixture,root/'members')
                catalog=PreparedDiscoveryCatalog(fixture,fixture,MembershipIndex(root/'members',membership_pin),works)
                result=catalog.read_exact([(1,1),(0,0)])
                self.assertEqual([r['chunk']['hierarchy'] for r in result['records']],[['Chapter I','Employment']]*2)
                # The independent original-input check must still pass when
                # isolating a changed compact identity in this fixture.
                from discovery_chunks import chunk_original_input
                fixture.chunks[0]['hierarchy']=['Different chapter']
                member=catalog.memberships.lookup_exact(fixture.input_values[0][1],0)
                altered=(member[0],hashlib.sha256(chunk_original_input(fixture.chunks[0])).digest(),*member[2:])
                from unittest.mock import patch
                with patch.object(catalog.memberships,'lookup_exact',return_value=altered):
                    with self.assertRaisesRegex(ValueError,'compact_input_mismatch'):catalog.read_exact([(0,0)])
            finally:works.close()

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
