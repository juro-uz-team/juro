"""Compose pinned vector, membership, chunk and prepared-source discovery.

Returned text and publisher metadata are authenticated discovery observations.
They are not complete legal evidence, temporal eligibility or article identity.
"""
import json
from discovery_inputs import hydrate_vector_inputs
from discovery_chunks import hydrate_membership_chunks
from works import work_key,hydrate_records


class PreparedDiscoveryCatalog:
    def __init__(self,package,vectors,memberships,works):
        expected={'package_sha256':package.sha256,'work_manifest_sha256':works.manifest_sha256,
          'vector_completion_sha256':vectors.completion_sha256,
          'mapping_manifest_sha256':package.files['embedding-inputs/manifest.json']['sha256'],
          'source_membership_manifest_sha256':package.files['memberships/manifest.json']['sha256'],
          'rows':package.memberships['rows'],'vectors':vectors.count}
        if any(memberships.manifest.get(key)!=value for key,value in expected.items()):
            raise ValueError('discovery_catalog_generation_mismatch')
        self.package=package;self.vectors=vectors;self.memberships=memberships;self.works=works

    def read(self,ordinals,after=None,per_vector_limit=8,max_bytes=32*1024*1024):
        if (not isinstance(ordinals,(list,tuple)) or len(ordinals)>16 or type(per_vector_limit) is not int
                or not 1<=per_vector_limit<=128 or len(ordinals)*per_vector_limit>128
                or type(max_bytes) is not int or not 1<=max_bytes<=64*1024*1024):
            raise ValueError('discovery_catalog_request_bound')
        after={} if after is None else after
        if not isinstance(after,dict) or len(after)>16:raise ValueError('discovery_catalog_cursor_invalid')
        inputs=hydrate_vector_inputs(self.package,self.vectors,ordinals)
        unique={bytes.fromhex(row['input_hash']):row for row in inputs}
        if any(key not in {value.hex() for value in unique} for key in after):raise ValueError('discovery_catalog_cursor_invalid')
        members=[];continuations={}
        for key in unique:
            rows,cursor=self.memberships.lookup(key,limit=per_vector_limit,after_ordinal=after.get(key.hex()))
            members.extend(rows);continuations[key.hex()]=cursor
        return self._hydrate(members,{key:row['input'] for key,row in unique.items()},continuations,max_bytes)

    def read_exact(self,references,max_bytes=32*1024*1024):
        """Reopen hybrid-search hits by exact vector and membership ordinals."""
        if (not isinstance(references,(list,tuple)) or len(references)>128
                or any(not isinstance(row,(list,tuple)) or len(row)!=2 for row in references)
                or type(max_bytes) is not int or not 1<=max_bytes<=64*1024*1024):
            raise ValueError('discovery_catalog_request_bound')
        inputs=hydrate_vector_inputs(self.package,self.vectors,[row[0] for row in references])
        members=[];values={}
        for (_,ordinal),value in zip(references,inputs):
            key=bytes.fromhex(value['input_hash'])
            member=self.memberships.lookup_exact(key,ordinal)
            if member is None:raise ValueError('discovery_catalog_membership_missing')
            members.append(member);values[key]=value['input']
        packet=self._hydrate(members,values,{},max_bytes)
        for record,(vector,_) in zip(packet['records'],references):record['vector_ordinal']=vector
        if len(json.dumps(packet,ensure_ascii=False,separators=(',',':')).encode())>max_bytes:
            raise ValueError('discovery_catalog_response_bound')
        return packet

    def _hydrate(self,members,inputs,continuations,max_bytes):
        chunks=hydrate_membership_chunks(self.package,members,inputs,max_bytes=max_bytes)
        work_ids=list(dict.fromkeys(chunk['work'] for chunk in chunks))
        locations=self.works.lookup([work_key(work) for work in work_ids])
        if any(location is None or location['work']!=work or location['prepared'] is None for work,location in zip(work_ids,locations)):
            raise ValueError('discovery_catalog_prepared_source_missing')
        inventories=hydrate_records(self.package,'inventory',[row['inventory'] for row in locations],max_total_bytes=max_bytes)
        selected_parents={chunk.get('snapshotProvisionId') for chunk in chunks}
        def select_provisions(record):
            observed=record.get('units')
            if not isinstance(observed,list):raise ValueError('discovery_catalog_units_invalid')
            seen=set();selected=[]
            for unit in observed:
                ordinal=unit.get('ordinal')
                if type(ordinal) is not int or ordinal<0 or ordinal in seen:
                    raise ValueError('discovery_catalog_units_invalid')
                seen.add(ordinal)
                if f"{record.get('work')}:{ordinal}" in selected_parents:selected.append(unit)
            return {**record,'units':selected}
        prepared=hydrate_records(self.package,'prepared',[row['prepared'] for row in locations],
            max_total_bytes=max_bytes,project=select_provisions)
        sources={};units={};source_units={}
        for work,inventory,record in zip(work_ids,inventories,prepared):
            if inventory.get('id')!=work or record.get('work')!=work:raise ValueError('discovery_catalog_source_identity_mismatch')
            observed_units=record.get('units')
            if not isinstance(observed_units,list):raise ValueError('discovery_catalog_units_invalid')
            by_ordinal={}
            for unit in observed_units:
                ordinal=unit.get('ordinal')
                if type(ordinal) is not int or ordinal<0 or ordinal in by_ordinal:raise ValueError('discovery_catalog_units_invalid')
                by_ordinal[ordinal]=unit
            source_units[work]=by_ordinal
            # Retain all classification scopes, inheritance, gaps, edition and
            # media observations without copying every unselected unit's text.
            sources[work]={'inventory':inventory,'prepared':{key:value for key,value in record.items() if key!='units'}}
        records=[]
        for member,chunk in zip(members,chunks):
            work=chunk['work'];parent=chunk.get('snapshotProvisionId');prefix=work+':'
            if not isinstance(parent,str) or not parent.startswith(prefix):raise ValueError('discovery_catalog_parent_invalid')
            suffix=parent[len(prefix):]
            if not suffix.isascii() or not suffix.isdigit() or len(suffix)>16 or str(int(suffix))!=suffix:
                raise ValueError('discovery_catalog_parent_invalid')
            unit=source_units[work].get(int(suffix))
            if unit is None or not isinstance(unit.get('text'),str) or chunk['officialText'] not in unit['text']:
                raise ValueError('discovery_catalog_unit_correspondence_invalid')
            for field in ['locator','method','language','script','hierarchy']:
                if field in unit and chunk.get(field)!=unit[field]:raise ValueError('discovery_catalog_unit_metadata_mismatch')
            units[parent]=unit
            records.append({'compact_input_hash':member[0].hex(),'original_input_hash':member[1].hex(),
              'membership_ordinal':member[4],'work':work,'unit':parent,'chunk':chunk,'status':'discovery_only'})
        packet={'package_sha256':self.package.sha256,'membership_sha256':self.memberships.manifest_sha256,
          'work_index_sha256':self.works.manifest_sha256,'vector_completion_sha256':self.vectors.completion_sha256,
          'sources':sources,'units':units,'records':records,'continuations':continuations}
        if len(json.dumps(packet,ensure_ascii=False,separators=(',',':')).encode())>max_bytes:
            raise ValueError('discovery_catalog_response_bound')
        return packet
