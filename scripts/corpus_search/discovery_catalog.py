"""Compose pinned vector, membership, chunk and prepared-source discovery.

Returned text and publisher metadata are authenticated discovery observations.
They are not complete legal evidence, temporal eligibility or article identity.
"""
import hashlib
import json
import re
from discovery_json import encode_discovery_json,ProjectedRecordDecoder
from discovery_inputs import hydrate_vector_inputs
from discovery_chunks import hydrate_membership_chunks
from works import work_key,hydrate_records
from discovery_units import unit_ordinal_key,segment_parent,resolve_unit


def project_publisher_fields(record):
    """Keep bulky source-wide text in its pinned prepared source record.

    Search passages and selected source units remain verbatim. This receipt is
    discovery metadata, never complete table evidence or a substitute for the
    official-source reader. Classification, edition, gaps and media quality
    observations remain inline. Large source-wide discovery/link lists have
    receipts here; the complete local source reader retains their original
    contents for authenticated reference resolution. Selected units are not projected.
    """
    if 'discovery_projection' in record or 'publisher_contents' in record:
        raise ValueError('discovery_catalog_projection_field_conflict')
    # Root publisher TOC links are navigation, not validated complete ranges.
    # Preserve this small derivative before bulky relationship lists are omitted.
    contents=[];seen=set()
    relationships=record.get('relationships')
    for link in relationships if isinstance(relationships,list) else []:
        if not isinstance(link,dict) or link.get('kind')!='publisher_link' or link.get('locator')!='':continue
        href=link.get('href');title=link.get('label')
        if not isinstance(href,str) or not re.fullmatch(r'#collapse(-?\d+)',href):continue
        if not isinstance(title,str) or not title.strip():continue
        position=href[len('#collapse'):];key=(position,title)
        if key not in seen:contents.append({'position':position,'title':title});seen.add(key)
    fields={}
    for name in ('tables','pages','original_units','discoveries','relationships'):
        if name not in record:continue
        raw=json.dumps(record[name],ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
        if len(raw)>64*1024:
            fields[name]={'encoding':'json-utf8-v1','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
    if not fields and not contents:return record
    return {**{key:value for key,value in record.items() if key not in fields},
        **({'publisher_contents':contents} if contents else {}),
        **({'discovery_projection':{'policy':'publisher-field-receipts-v1','fields':fields}} if fields else {})}


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
        self.decode_prepared=ProjectedRecordDecoder(project_publisher_fields)

    def read_sources(self,work_ids,max_bytes=32*1024*1024):
        """Reopen whole retained sources, without the discovery projection.

        Integrity does not imply complete extraction or temporal applicability:
        all acquisition metadata and gaps remain available to the evidence reader.
        """
        if (not isinstance(work_ids,(list,tuple)) or not 1<=len(work_ids)<=8
                or any(not isinstance(work,str) for work in work_ids)
                or len(set(work_ids))!=len(work_ids)
                or type(max_bytes) is not int or not 1<=max_bytes<=64*1024*1024):
            raise ValueError('source_catalog_request_bound')
        locations=self.works.lookup([work_key(work) for work in work_ids])
        if any(location is None or location['work']!=work
               for work,location in zip(work_ids,locations)):
            raise ValueError('source_catalog_source_missing')
        inventories=hydrate_records(self.package,'inventory',[row['inventory'] for row in locations],max_total_bytes=max_bytes)
        prepared=iter(hydrate_records(self.package,'prepared',[row['prepared'] for row in locations if row['prepared'] is not None],max_total_bytes=max_bytes))
        sources={}
        for work,inventory,location in zip(work_ids,inventories,locations):
            record=next(prepared) if location['prepared'] is not None else None
            if inventory.get('id')!=work or (record is not None and record.get('work')!=work):
                raise ValueError('source_catalog_identity_mismatch')
            sources[work]={'inventory':inventory,'prepared':record}
        result={'package_sha256':self.package.sha256,'work_index_sha256':self.works.manifest_sha256,'sources':sources}
        if len(encode_discovery_json(result))>max_bytes:raise ValueError('source_catalog_response_bound')
        return result

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

    def read_exact(self,references,max_bytes=32*1024*1024,*,encoded=False):
        """Reopen hybrid-search hits by exact vector and membership ordinals."""
        if (not isinstance(references,(list,tuple)) or len(references)>128
                or any(not isinstance(row,(list,tuple)) or len(row)!=2 for row in references)
                or type(max_bytes) is not int or not 1<=max_bytes<=64*1024*1024):
            raise ValueError('discovery_catalog_request_bound')
        keys=self.vectors.input_hashes([row[0] for row in references])
        members=[]
        for (_,ordinal),key in zip(references,keys):
            member=self.memberships.lookup_exact(key,ordinal)
            if member is None:raise ValueError('discovery_catalog_membership_missing')
            members.append(member)
        # The chunk reconstructs the canonical compact bytes. Matching their
        # SHA to the authenticated vector identity proves the same input without
        # reopening unrelated compact-input partitions.
        packet=self._hydrate(members,None,{},max_bytes,vector_ordinals=[row[0] for row in references],encoded=encoded)
        self.vectors.assert_unchanged()
        return packet

    def _hydrate(self,members,inputs,continuations,max_bytes,*,vector_ordinals=None,encoded=False):
        chunks=hydrate_membership_chunks(self.package,members,inputs,max_bytes=max_bytes)
        work_ids=list(dict.fromkeys(chunk['work'] for chunk in chunks))
        locations=self.works.lookup([work_key(work) for work in work_ids])
        if any(location is None or location['work']!=work or location['prepared'] is None for work,location in zip(work_ids,locations)):
            raise ValueError('discovery_catalog_prepared_source_missing')
        inventories=hydrate_records(self.package,'inventory',[row['inventory'] for row in locations],max_total_bytes=max_bytes)
        selected_parents={chunk.get('snapshotProvisionId') for chunk in chunks}
        selected_parents.update(identity[0] for parent in tuple(selected_parents)
            if isinstance(parent,str) and (identity:=segment_parent(parent)) is not None)
        decoder=self.decode_prepared if getattr(self.package,'source_projection',None) is not None else None
        def select_provisions(record):
            observed=record.get('units')
            if not isinstance(observed,list):raise ValueError('discovery_catalog_units_invalid')
            seen=set();selected=[]
            for unit in observed:
                ordinal=unit_ordinal_key(unit.get('ordinal'))
                if ordinal in seen:
                    raise ValueError('discovery_catalog_units_invalid')
                seen.add(ordinal)
                if f"{record.get('work')}:{ordinal}" in selected_parents:selected.append(unit)
            result={**record,'units':selected}
            return result if decoder is not None else project_publisher_fields(result)
        prepared=hydrate_records(self.package,'prepared',[row['prepared'] for row in locations],
            max_total_bytes=max_bytes,project=select_provisions,decode_record=decoder)
        sources={};units={};source_units={}
        for work,inventory,record in zip(work_ids,inventories,prepared):
            if inventory.get('id')!=work or record.get('work')!=work:raise ValueError('discovery_catalog_source_identity_mismatch')
            observed_units=record.get('units')
            if not isinstance(observed_units,list):raise ValueError('discovery_catalog_units_invalid')
            by_ordinal={}
            for unit in observed_units:
                ordinal=unit_ordinal_key(unit.get('ordinal'))
                if ordinal in by_ordinal:raise ValueError('discovery_catalog_units_invalid')
                by_ordinal[ordinal]=unit
            source_units[work]=by_ordinal
            # Retain all classification scopes, inheritance, gaps, edition and
            # media observations without copying every unselected unit's text.
            sources[work]={'inventory':inventory,'prepared':{key:value for key,value in record.items() if key!='units'}}
        records=[]
        for index,(member,chunk) in enumerate(zip(members,chunks)):
            work=chunk['work'];parent=chunk.get('snapshotProvisionId');prefix=work+':'
            if not isinstance(parent,str) or not parent.startswith(prefix):raise ValueError('discovery_catalog_parent_invalid')
            suffix=parent[len(prefix):]
            if not suffix or len(suffix)>512:
                raise ValueError('discovery_catalog_parent_invalid')
            unit,original_parent=resolve_unit(suffix,source_units[work],chunk,work)
            if unit is None or not isinstance(unit.get('text'),str) or chunk['officialText'] not in unit['text']:
                raise ValueError('discovery_catalog_unit_correspondence_invalid')
            for field in ['locator','method','language','script','hierarchy']:
                if field not in unit:continue
                expected=unit[field]
                inventory=sources[work]['inventory']
                if field=='hierarchy' and inventory.get('kind') in ('asset','member'):
                    # The producer prefixes attached-media chunks with the
                    # acquisition context. Authenticate both retained scopes;
                    # do not rewrite the original unit's local hierarchy.
                    context=inventory.get('context',{})
                    if not isinstance(context,dict):raise ValueError('discovery_catalog_unit_metadata_mismatch')
                    inherited=context.get('hierarchy',[])
                    if (not isinstance(inherited,list) or not isinstance(expected,list)
                            or any(not isinstance(item,str) for item in inherited+expected)):
                        raise ValueError('discovery_catalog_unit_metadata_mismatch')
                    expected=inherited+expected
                if chunk.get(field)!=expected:raise ValueError('discovery_catalog_unit_metadata_mismatch')
            if original_parent is not None:units[original_parent[0]]=original_parent[1]
            units[parent]=unit
            records.append({'compact_input_hash':member[0].hex(),'original_input_hash':member[1].hex(),
              'membership_ordinal':member[4],'work':work,'unit':parent,'chunk':chunk,'status':'discovery_only'})
            # Include exact identities before the single final packet bound;
            # serializing the large source text again adds no validation.
            if vector_ordinals is not None:records[-1]['vector_ordinal']=vector_ordinals[index]
        packet={'package_sha256':self.package.sha256,'membership_sha256':self.memberships.manifest_sha256,
          'work_index_sha256':self.works.manifest_sha256,'vector_completion_sha256':self.vectors.completion_sha256,
          'sources':sources,'units':units,'records':records,'continuations':continuations}
        raw=encode_discovery_json(packet)
        if len(raw)>max_bytes:
            raise ValueError('discovery_catalog_response_bound')
        # HTTP can send the very bytes whose bound was checked, without encoding
        # complete source provisions a second time. Nothing is cached between reads.
        return raw if encoded else packet
