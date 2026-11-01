"""Resolve membership ordinals to exact chunks under the package trust policy.

Chunk shard order can differ from membership order. The profile publication
authenticates their permutation; runtime locators use that pinned order.
Work and chunk associations are always checked before returning text. Strict
preparation also authenticates text and input digests. No article identity is inferred.
"""
import bisect
import hashlib
from prepared import canonical
from works import hydrate_records,work_key


def chunk_original_input(chunk):
    return canonical({'articleNumber':chunk['articleNumber'],'articleTitle':chunk['articleTitle'],
      'documentTitle':chunk['sourceDocumentTitle'],'documentType':chunk['documentType'],'hierarchy':chunk['hierarchy'],
      'language':chunk['language'],'officialText':chunk['officialText'],'schemaVersion':'legal-embedding-input-v1',
      'script':chunk['script']})+b'\n'


def chunk_part_order(package):
    """Return a complete permutation, never dropping or repeating a shard."""
    count=len(package.handoff['shards']['chunks'])
    parts=getattr(package,'chunk_parts',None)
    if parts is None:return list(range(count))
    if (not isinstance(parts,list) or len(parts)!=count
            or any(type(part) is not int for part in parts)
            or sorted(parts)!=list(range(count))):
        raise ValueError('discovery_chunk_order_invalid')
    return list(parts)


def hydrate_membership_chunks(package,members,compact_inputs,max_bytes=16*1024*1024):
    trusted=getattr(package,'trust_prepared',False)
    if not isinstance(members,(tuple,list)) or len(members)>128:raise ValueError('discovery_chunk_request_bound')
    ends=[];starts=[];total=0
    parts=chunk_part_order(package)
    for part in parts:
        receipt=package.handoff['shards']['chunks'][part]
        count=receipt['count']
        if type(count) is not int or count<=0:raise ValueError('discovery_chunk_partition_invalid')
        starts.append(total);total+=count;ends.append(total)
    if total!=package.memberships['rows']:raise ValueError('discovery_chunk_population_mismatch')
    locations=[]
    for row in members:
        if (len(row)!=5 or any(not isinstance(value,bytes) or len(value)!=32 for value in row[:4])
                or type(row[4]) is not int or not 0<=row[4]<total):raise ValueError('discovery_chunk_member_invalid')
        position=bisect.bisect_right(ends,row[4])
        locations.append((parts[position],row[4]-starts[position]))
    chunks=hydrate_records(package,'chunks',locations,max_total_bytes=max_bytes)
    reconstructed=set();input_bytes=0
    for member,chunk in zip(members,chunks):
        compact,original,identity,work,_=member
        if work_key(chunk.get('work'))!=work or chunk.get('id')!='retrieval-chunk-v1:'+identity.hex():
            raise ValueError('discovery_chunk_identity_mismatch')
        text=chunk.get('officialText')
        if not isinstance(text,str) or (not trusted and hashlib.sha256(text.encode()).hexdigest()!=chunk.get('officialTextSha256')):
            raise ValueError('discovery_chunk_text_mismatch')
        fields={name:chunk[name] for name in ['ordinal','policyVersion','snapshotProvisionId','targetTokens','officialTextSha256']}
        if fields['policyVersion']!='retrieval-chunk-v1' or (not trusted and hashlib.sha256(canonical(fields)).digest()!=identity):
            raise ValueError('discovery_chunk_policy_identity_mismatch')
        if not trusted and hashlib.sha256(chunk_original_input(chunk)).digest()!=original:
            raise ValueError('discovery_chunk_original_input_mismatch')
        expected={'documentTitle':chunk['sourceDocumentTitle'],'documentType':chunk['documentType'],
          'language':chunk['language'],'script':chunk['script'],'officialText':text}
        if compact_inputs is None:
            fields=('documentTitle','documentType','language','script','officialText')
            if (any(not isinstance(expected[key],str) for key in fields) or not text
                    or not isinstance(chunk['hierarchy'],list)
                    or any(not isinstance(item,str) for item in chunk['hierarchy'])):
                raise ValueError('discovery_input_codec_invalid')
            candidates=(expected,{**expected,'hierarchy':chunk['hierarchy']})
            matching=canonical(candidates[-1])+b'\n' if trusted else None
            if not trusted:
                for value in candidates:
                    raw=canonical(value)+b'\n'
                    if hashlib.sha256(raw).digest()==compact:
                        matching=raw;break
            if matching is None:
                raise ValueError('discovery_chunk_compact_input_mismatch')
            if len(matching.decode('utf-8'))>1048576:raise ValueError('discovery_input_codec_invalid')
            if compact not in reconstructed:
                reconstructed.add(compact);input_bytes+=len(matching)
                if input_bytes>16*1024*1024:raise ValueError('discovery_input_byte_bound')
            continue
        value=compact_inputs.get(compact)
        # Both retained compact input formats are valid. When the producer
        # included publisher hierarchy, authenticate it against the chunk too.
        if isinstance(value,dict) and 'hierarchy' in value:expected['hierarchy']=chunk['hierarchy']
        if value!=expected:raise ValueError('discovery_chunk_compact_input_mismatch')
    return chunks
