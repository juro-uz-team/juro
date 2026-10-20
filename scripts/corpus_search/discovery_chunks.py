"""Resolve membership ordinals to exact chunks, authenticating every join.

The handoff producer emits chunks and memberships together in the same order.
That is a locator optimization only: work, chunk and both input identities are
independently checked before returning text. No article identity is inferred.
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


def hydrate_membership_chunks(package,members,compact_inputs,max_bytes=16*1024*1024):
    if not isinstance(members,(tuple,list)) or len(members)>128:raise ValueError('discovery_chunk_request_bound')
    ends=[];starts=[];total=0
    for receipt in package.handoff['shards']['chunks']:
        count=receipt['count']
        if type(count) is not int or count<=0:raise ValueError('discovery_chunk_partition_invalid')
        starts.append(total);total+=count;ends.append(total)
    if total!=package.memberships['rows']:raise ValueError('discovery_chunk_population_mismatch')
    locations=[]
    for row in members:
        if (len(row)!=5 or any(not isinstance(value,bytes) or len(value)!=32 for value in row[:4])
                or type(row[4]) is not int or not 0<=row[4]<total):raise ValueError('discovery_chunk_member_invalid')
        part=bisect.bisect_right(ends,row[4]);locations.append((part,row[4]-starts[part]))
    chunks=hydrate_records(package,'chunks',locations,max_total_bytes=max_bytes)
    for member,chunk in zip(members,chunks):
        compact,original,identity,work,_=member
        if work_key(chunk.get('work'))!=work or chunk.get('id')!='retrieval-chunk-v1:'+identity.hex():
            raise ValueError('discovery_chunk_identity_mismatch')
        text=chunk.get('officialText')
        if not isinstance(text,str) or hashlib.sha256(text.encode()).hexdigest()!=chunk.get('officialTextSha256'):
            raise ValueError('discovery_chunk_text_mismatch')
        fields={name:chunk[name] for name in ['ordinal','policyVersion','snapshotProvisionId','targetTokens','officialTextSha256']}
        if fields['policyVersion']!='retrieval-chunk-v1' or hashlib.sha256(canonical(fields)).digest()!=identity:
            raise ValueError('discovery_chunk_policy_identity_mismatch')
        if hashlib.sha256(chunk_original_input(chunk)).digest()!=original:
            raise ValueError('discovery_chunk_original_input_mismatch')
        value=compact_inputs.get(compact)
        expected={'documentTitle':chunk['sourceDocumentTitle'],'documentType':chunk['documentType'],
          'language':chunk['language'],'script':chunk['script'],'officialText':text}
        if value!=expected:raise ValueError('discovery_chunk_compact_input_mismatch')
    return chunks
