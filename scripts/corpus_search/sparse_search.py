"""Exact BM25 over authenticated compressed postings, with a caller deadline.

Query hashes must come from the pinned production word analyzer. Search results
are discovery references and do not establish legal evidence eligibility.
"""
import heapq
import itertools
import json
import math
import pathlib
import re
import sqlite3
import time
from sparse_postings import PostingRun,MAX_INTEGER
from works import file_hash,signature
from cancellation import check_cancelled

FIELDS=('title','hierarchy','article','text')
WEIGHTS=(2,1.5,1.5,1)


def score_term(tf,df,documents,length,average,weight):
    if tf<=0:return 0.0
    return weight*math.log(1+(documents-df+.5)/(df+.5))*(tf*2.2)/(tf+1.2*(.25+.75*length/max(1,average)))


class SparseIndex:
    def __init__(self,root,manifest_sha256,profiles_sha256,analyzer_sha256,*,kernel_path=None,trust_prepared=False):
        self.root=pathlib.Path(root).resolve(strict=True);path=self.root/'manifest.json'
        if path.is_symlink() or path.stat().st_size>8192 or (not trust_prepared and file_hash(path)!=manifest_sha256):raise ValueError('sparse_index_manifest_mismatch')
        self.manifest=json.loads(path.read_bytes());m=self.manifest
        if (m.get('format')!='prepared-sparse-index-v1' or m.get('complete') is not True
                or m.get('profiles_sha256')!=profiles_sha256 or m.get('analyzer_sha256')!=analyzer_sha256
                or m.get('analyzer')!='word-v1' or not isinstance(m.get('run'),dict)
                or not isinstance(m['run'].get('path'),str) or not re.fullmatch(r'merge-[0-9]{3}-[0-9]{6}',m['run']['path'])
                or any(type(m.get(key)) is not int or not 0<m[key]<=MAX_INTEGER for key in ['profiles','members'])
                or m['profiles']>m['members'] or set(m.get('weighted_field_lengths',{}))!=set(FIELDS)
                or any(type(v) is not int or not 0<=v<=MAX_INTEGER for v in m['weighted_field_lengths'].values())):
            raise ValueError('sparse_index_manifest_invalid')
        self.path=self.root/'profiles.sqlite'
        if self.path.is_symlink() or self.path.stat().st_size!=m['database_bytes'] or (not trust_prepared and file_hash(self.path)!=m['database_sha256']):
            raise ValueError('sparse_index_metadata_mismatch')
        run_path=self.root/m['run']['path']
        if run_path.is_symlink():raise ValueError('sparse_index_run_path_invalid')
        self.run=PostingRun(run_path,m['run']['sha256'],profiles_sha256,trust_prepared=trust_prepared)
        if self.run.manifest['rows']!=m.get('postings'):
            self.run.close();raise ValueError('sparse_index_posting_population_mismatch')
        self.identity=signature(self.path);self.manifest_sha256=manifest_sha256
        self.connection=sqlite3.connect(self.path.as_uri()+'?mode=ro&immutable=1',uri=True)
        self.connection.execute('PRAGMA query_only=ON');self.connection.execute('PRAGMA cache_size=-8192')
        self.averages=[m['weighted_field_lengths'][field]/m['members'] for field in FIELDS]
        self.native=None
        if kernel_path is not None:
            from native_sparse import NativeSparseScorer
            try:self.native=NativeSparseScorer(self,kernel_path)
            except BaseException:self.close();raise

    def assert_unchanged(self):
        self.run.assert_unchanged()
        if signature(self.path)!=self.identity:raise ValueError('sparse_index_metadata_changed')

    def search(self,term_hashes,deadline,limit=50):
        if (not isinstance(term_hashes,(list,tuple)) or len(term_hashes)>64
                or any(not isinstance(term,bytes) or len(term)!=32 for term in term_hashes)
                or type(limit) is not int or not 1<=limit<=50
                or (deadline is not None and (type(deadline) not in (int,float) or not math.isfinite(deadline)))):
            raise ValueError('sparse_query_invalid')
        def check():
            check_cancelled()
            if deadline is not None and time.monotonic()>=deadline:raise TimeoutError('sparse_query_deadline')
        check();self.assert_unchanged();streams=[];heap=[]
        if getattr(self,'native',None) is not None:
            return self.native.search(self,term_hashes,limit,check)
        averages=[max(1,average) for average in self.averages]
        def scored_rows(stream,df):
            # IDF is constant for a term across every matching profile. Retain
            # the scalar operation order so scores and tie ordering are exact.
            idf=math.log(1+(self.manifest['members']-df+.5)/(df+.5))
            coefficients=tuple(weight*idf for weight in WEIGHTS)
            for ordinal,frequencies,weight in stream:yield ordinal,frequencies,weight,coefficients
        iterators=[]
        try:
            for term in sorted(set(term_hashes)):
                df,stream=self.run.term_rows(term,check)
                if not 0<=df<=self.manifest['members']:raise ValueError('sparse_query_frequency_invalid')
                streams.append(stream);iterators.append(scored_rows(stream,df))
            merged=heapq.merge(*iterators,key=lambda row:row[0])
            groups=itertools.groupby(merged,key=lambda row:row[0])
            while True:
                batch=[]
                for ordinal,group in itertools.islice(groups,512):
                    check();batch.append((ordinal,list(group)))
                if not batch:break
                # Bound memory independently of corpus size and eliminate the
                # per-profile SQLite dispatch without skipping any postings.
                placeholders=','.join('?' for _ in batch)
                records=self.connection.execute(
                    'SELECT ordinal,vector,first_membership,members,title,hierarchy,article,text '
                    f'FROM profiles WHERE ordinal IN ({placeholders})',tuple(row[0] for row in batch))
                metadata_by_ordinal={row[0]:row[1:] for row in records}
                for ordinal,group in batch:
                    check();metadata=metadata_by_ordinal.get(ordinal)
                    if (metadata is None or not 0<=ordinal<self.manifest['profiles']
                            or any(type(value) is not int or not 0<=value<=MAX_INTEGER for value in metadata)
                            or metadata[2]<1):raise ValueError('sparse_query_profile_invalid')
                    score=0.0
                    for _,frequencies,weight,coefficients in group:
                        if weight!=metadata[2] or any(tf>length for tf,length in zip(frequencies,metadata[3:])):
                            raise ValueError('sparse_query_profile_posting_mismatch')
                        score+=sum(coefficient*(tf*2.2)/(tf+1.2*(.25+.75*length/average)) if tf>0 else 0.0
                                   for tf,length,average,coefficient in zip(frequencies,metadata[3:],averages,coefficients))
                    if not math.isfinite(score):raise ValueError('sparse_query_score_invalid')
                    candidate=(score,-ordinal,metadata[0],metadata[1])
                    if len(heap)<limit:heapq.heappush(heap,candidate)
                    elif candidate>heap[0]:heapq.heapreplace(heap,candidate)
            if not all(stream.verified for stream in streams):raise ValueError('sparse_query_incomplete')
            check();self.assert_unchanged()
            return [{'profile_ordinal':-ordinal,'vector_ordinal':vector,'membership_ordinal':member,'score':score}
                    for score,ordinal,vector,member in sorted(heap,reverse=True)]
        finally:
            for iterator in iterators:iterator.close()

    def close(self):
        if getattr(self,'native',None) is not None:self.native.close()
        self.connection.close();self.run.close()
