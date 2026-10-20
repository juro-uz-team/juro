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

FIELDS=('title','hierarchy','article','text')
WEIGHTS=(2,1.5,1.5,1)


def score_term(tf,df,documents,length,average,weight):
    if tf<=0:return 0.0
    return weight*math.log(1+(documents-df+.5)/(df+.5))*(tf*2.2)/(tf+1.2*(.25+.75*length/max(1,average)))


class SparseIndex:
    def __init__(self,root,manifest_sha256,profiles_sha256,analyzer_sha256):
        self.root=pathlib.Path(root).resolve(strict=True);path=self.root/'manifest.json'
        if path.is_symlink() or path.stat().st_size>8192 or file_hash(path)!=manifest_sha256:raise ValueError('sparse_index_manifest_mismatch')
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
        if self.path.is_symlink() or self.path.stat().st_size!=m['database_bytes'] or file_hash(self.path)!=m['database_sha256']:
            raise ValueError('sparse_index_metadata_mismatch')
        run_path=self.root/m['run']['path']
        if run_path.is_symlink():raise ValueError('sparse_index_run_path_invalid')
        self.run=PostingRun(run_path,m['run']['sha256'],profiles_sha256)
        if self.run.manifest['rows']!=m.get('postings'):
            self.run.close();raise ValueError('sparse_index_posting_population_mismatch')
        self.identity=signature(self.path);self.manifest_sha256=manifest_sha256
        self.connection=sqlite3.connect(self.path.as_uri()+'?mode=ro&immutable=1',uri=True)
        self.connection.execute('PRAGMA query_only=ON');self.connection.execute('PRAGMA cache_size=-8192')
        self.averages=[m['weighted_field_lengths'][field]/m['members'] for field in FIELDS]

    def assert_unchanged(self):
        self.run.assert_unchanged()
        if signature(self.path)!=self.identity:raise ValueError('sparse_index_metadata_changed')

    def search(self,term_hashes,deadline,limit=50):
        if (not isinstance(term_hashes,(list,tuple)) or len(term_hashes)>64
                or any(not isinstance(term,bytes) or len(term)!=32 for term in term_hashes)
                or type(limit) is not int or not 1<=limit<=50
                or type(deadline) not in (int,float) or not math.isfinite(deadline)):
            raise ValueError('sparse_query_invalid')
        deadline=min(deadline,time.monotonic()+10)
        def check():
            if time.monotonic()>=deadline:raise TimeoutError('sparse_query_deadline')
        check();self.assert_unchanged();streams=[];heap=[]
        def scored_rows(stream,df):
            for ordinal,frequencies,weight in stream:yield ordinal,frequencies,weight,df
        iterators=[]
        try:
            for term in sorted(set(term_hashes)):
                df,stream=self.run.term_rows(term,check)
                if not 0<=df<=self.manifest['members']:raise ValueError('sparse_query_frequency_invalid')
                streams.append(stream);iterators.append(scored_rows(stream,df))
            merged=heapq.merge(*iterators,key=lambda row:row[0])
            for ordinal,group in itertools.groupby(merged,key=lambda row:row[0]):
                check()
                metadata=self.connection.execute('SELECT vector,first_membership,members,title,hierarchy,article,text FROM profiles WHERE ordinal=?',(ordinal,)).fetchone()
                if (metadata is None or not 0<=ordinal<self.manifest['profiles']
                        or any(type(value) is not int or not 0<=value<=MAX_INTEGER for value in metadata)
                        or metadata[2]<1):raise ValueError('sparse_query_profile_invalid')
                score=0.0
                for _,frequencies,weight,df in group:
                    if weight!=metadata[2] or any(tf>length for tf,length in zip(frequencies,metadata[3:])):
                        raise ValueError('sparse_query_profile_posting_mismatch')
                    score+=sum(score_term(tf,df,self.manifest['members'],length,average,field_weight)
                               for tf,length,average,field_weight in zip(frequencies,metadata[3:],self.averages,WEIGHTS))
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

    def close(self):self.connection.close();self.run.close()
