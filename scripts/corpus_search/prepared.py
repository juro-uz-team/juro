"""Exact chunk-to-extracted-unit correspondence, without legal eligibility claims.

Callers authenticate package parts before publishing this proof. Publisher
observations remain unchanged: an extracted unit is not necessarily an article,
and an edition observation does not establish temporal applicability.
"""
import hashlib
import json


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')


class PreparedCorrespondence:
    """Verify chunks sorted by unit ordinal then chunk ordinal for one work.

    Uses bounded per-unit counters and streaming digests, not a second copy of
    all chunk text. Missing units are explicit in the final coverage proof.
    Publication must bind both this proof and the source part receipts.
    """
    def __init__(self,prepared):
        if not isinstance(prepared,dict) or not isinstance(prepared.get('work'),str) or not prepared['work']:
            raise ValueError('prepared_work_invalid')
        units=prepared.get('units')
        if not isinstance(units,list) or len(units)>100000:
            raise ValueError('prepared_units_bound')
        self.work=prepared['work'];self.prepared_sha256=digest(canonical(prepared))
        self.units={};self.coverage={};self.previous=None;self.finished=False;self.count=0
        for unit in units:
            ordinal=unit.get('ordinal');text=unit.get('text')
            if (type(ordinal) is not int or not 0<=ordinal<2**53 or ordinal in self.units
                    or not isinstance(text,str)):
                raise ValueError('prepared_unit_invalid')
            raw=text.encode('utf-8')
            if len(raw)>128*1024*1024:raise ValueError('prepared_unit_text_bound')
            self.units[ordinal]={'parent':self.work+':'+str(ordinal),'sha256':digest(raw),'bytes':len(raw),
                                 'metadata':{key:unit.get(key) for key in ('language','script','hierarchy','locator','method')}}

    def add(self,chunk):
        if self.finished:raise ValueError('prepared_correspondence_finished')
        if not isinstance(chunk,dict) or chunk.get('work')!=self.work:
            raise ValueError('prepared_chunk_work_mismatch')
        parent=chunk.get('snapshotProvisionId');prefix=self.work+':'
        if not isinstance(parent,str) or not parent.startswith(prefix):
            raise ValueError('prepared_chunk_parent_mismatch')
        suffix=parent[len(prefix):]
        if not suffix.isascii() or not suffix.isdigit() or len(suffix)>16:
            raise ValueError('prepared_chunk_parent_invalid')
        unit_ordinal=int(suffix);unit=self.units.get(unit_ordinal)
        if unit is None or unit['parent']!=parent:raise ValueError('prepared_chunk_parent_mismatch')
        ordinal=chunk.get('ordinal');target=chunk.get('targetTokens');text=chunk.get('officialText')
        if (type(ordinal) is not int or not 0<=ordinal<2**53 or type(target) is not int
                or target not in (512,1024,2048) or not isinstance(text,str) or not text
                or chunk.get('policyVersion')!='retrieval-chunk-v1'):
            raise ValueError('prepared_chunk_invalid')
        position=(unit_ordinal,ordinal)
        if self.previous is not None and position<=self.previous:
            raise ValueError('prepared_chunk_order_invalid')
        raw=text.encode('utf-8');text_sha=digest(raw)
        if text_sha!=chunk.get('officialTextSha256'):
            raise ValueError('prepared_chunk_text_hash_mismatch')
        identity={'ordinal':ordinal,'policyVersion':'retrieval-chunk-v1','snapshotProvisionId':parent,
                  'targetTokens':target,'officialTextSha256':text_sha}
        if chunk.get('id')!='retrieval-chunk-v1:'+digest(canonical(identity)):
            raise ValueError('prepared_chunk_identity_mismatch')
        metadata=unit['metadata']
        for key in ('language','script','hierarchy','locator','method'):
            if key in chunk and metadata[key] is not None and chunk[key]!=metadata[key]:
                raise ValueError('prepared_chunk_metadata_mismatch')
        # This is publisher position correspondence, never an article assertion.
        if chunk.get('articleNumber') is not None and metadata['locator'] is not None and chunk['articleNumber']!=metadata['locator']:
            raise ValueError('prepared_chunk_locator_mismatch')
        coverage=self.coverage.setdefault(unit_ordinal,{'count':0,'bytes':0,'hash':hashlib.sha256()})
        if ordinal!=coverage['count']:raise ValueError('prepared_chunk_sequence_gap')
        coverage['count']+=1;coverage['bytes']+=len(raw);coverage['hash'].update(raw)
        if coverage['bytes']>unit['bytes']:raise ValueError('prepared_chunk_parent_overflow')
        self.count+=1;self.previous=position

    def finish(self):
        if self.finished:raise ValueError('prepared_correspondence_finished')
        self.finished=True;covered=[];unindexed=[]
        for ordinal,unit in sorted(self.units.items()):
            coverage=self.coverage.get(ordinal)
            if coverage is None:
                if unit['bytes']:unindexed.append(ordinal)
                continue
            if coverage['bytes']!=unit['bytes'] or coverage['hash'].hexdigest()!=unit['sha256']:
                raise ValueError('prepared_chunk_parent_text_mismatch')
            covered.append({'ordinal':ordinal,'text_sha256':unit['sha256'],'text_bytes':unit['bytes'],'chunks':coverage['count']})
        return {'format':'prepared-unit-correspondence-v1','work':self.work,
                'work_sha256':digest(self.work.encode('utf-8')),'prepared_row_sha256':self.prepared_sha256,
                'chunks':self.count,'covered_units':covered,'unindexed_nonempty_units':unindexed,
                'scope':'extracted-unit-text-correspondence','legal_completeness':'not_established',
                'temporal_applicability':'not_established'}
