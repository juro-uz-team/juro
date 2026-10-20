"""Hydrate exact compact model input text from completion-order vector hits."""
import bisect
import json
import re


def hydrate_vector_inputs(package,vectors,ordinals,max_bytes=16*1024*1024):
    if (not isinstance(ordinals,(list,tuple)) or len(ordinals)>128 or type(max_bytes) is not int
            or not 1<=max_bytes<=32*1024*1024):raise ValueError('discovery_input_request_bound')
    expected=vectors.input_hashes(ordinals);groups={}
    for position,ordinal in enumerate(ordinals):
        shard=bisect.bisect_right(vectors.ends,ordinal);receipt=vectors.shards[shard]
        # This is the batch producer's pinned job layout. It supplies a locator,
        # never identity proof: the vector's authenticated hash must also match.
        match=re.fullmatch(r'p([0-9]{3,})-([0-9]{5,})',receipt['job'])
        if not match:raise ValueError('discovery_input_job_layout_unsupported')
        part,start=map(int,match.groups());row=start+ordinal-vectors.starts[shard]
        groups.setdefault(part,{}).setdefault(row,[]).append(position)
    result=[None]*len(ordinals);total=0
    for part,requested in groups.items():
        stream=package.input_rows(part)
        for row,key,text,tokens in stream:
            if row not in requested:continue
            total+=len(text.encode('utf-8'))
            if total>max_bytes:raise ValueError('discovery_input_byte_bound')
            value=json.loads(text)
            if (not isinstance(value,dict) or set(value)!={'documentTitle','documentType','language','script','officialText'}
                    or not all(isinstance(item,str) for item in value.values()) or not value['officialText']):
                raise ValueError('discovery_input_codec_invalid')
            for position in requested[row]:
                if key!=expected[position]:raise ValueError('discovery_input_vector_mismatch')
                result[position]={'vector_ordinal':ordinals[position],'input_hash':key.hex(),'input':value,'tokens':tokens,
                                  'package_sha256':package.sha256,'input_part':part,'input_row':row}
        if not stream.verified:raise ValueError('discovery_input_unverified')
    if any(row is None for row in result):raise ValueError('discovery_input_missing')
    vectors.assert_unchanged()
    return result
