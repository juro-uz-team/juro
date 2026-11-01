"""Navigate compressed vectors, then rerank retained original float32 values.

Float64 cosine matches the independent exact qualification scan. This changes
neither stored embeddings nor their coordinates. Candidate recall and latency
still require qualification for the selected navigation candidate count.
"""
import math
import time
from concurrent.futures import ThreadPoolExecutor, wait
from contextvars import copy_context
import numpy as np
from cancellation import check_cancelled
from vector_validation import vector_read_scope


class DenseSearch:
    def __init__(self,navigation,vectors,candidates,*,read_workers=1):
        if (not vectors.ready or navigation.completion_sha256!=vectors.completion_sha256
                or navigation.count!=vectors.count or navigation.dimensions!=3072
                or type(candidates) is not int or not 1<=candidates<=20000
                or type(read_workers) is not int or read_workers not in (1,2,4,8)):
            raise ValueError('dense_search_configuration_invalid')
        self.navigation=navigation;self.vectors=vectors;self.candidates=min(candidates,vectors.count)
        self.vectors.prepare_random_reads()
        self.read_workers=read_workers
        self.pool=None
        self.closed=False

    def _read(self,positions):
        def read(ids):
            check_cancelled()
            values=self.vectors.read(ids)
            check_cancelled()
            return values
        if self.read_workers==1 or len(positions)<2:return read(positions.tolist())
        if self.pool is None:
            self.pool=ThreadPoolExecutor(max_workers=self.read_workers,thread_name_prefix='original-vector-read')
        groups=[part.tolist() for part in np.array_split(positions,min(self.read_workers,len(positions)))]
        futures=[self.pool.submit(copy_context().run,read,group) for group in groups]
        try:return np.concatenate([future.result() for future in futures])
        finally:
            for future in futures:future.cancel()
            # Cancellation cannot return borrowed mappings to their owner while
            # another reader still copies from them. Each batch is at most 256.
            wait(futures)

    def close(self):
        self.closed=True
        if self.pool is not None:
            self.pool.shutdown(wait=True,cancel_futures=True)
            self.pool=None

    def search(self,query,deadline,limit=50):
        with vector_read_scope(self.vectors):
            return self._search(query,deadline,limit)

    def _search(self,query,deadline,limit):
        if self.closed:raise ValueError('dense_search_closed')
        if (type(limit) is not int or not 1<=limit<=50 or (deadline is not None and (type(deadline) not in (int,float)
                or not math.isfinite(deadline)))):
            raise ValueError('dense_query_invalid')
        values=np.asarray(query,dtype=np.float64)
        if values.shape!=(3072,) or not np.isfinite(values).all():raise ValueError('dense_query_embedding_invalid')
        norm=np.linalg.norm(values)
        if not np.isfinite(norm) or norm<=0:raise ValueError('dense_query_embedding_invalid')
        exact_query=values/norm
        navigation_query=np.asarray(values,dtype=np.float32).reshape(1,3072)
        navigation_norm=np.linalg.norm(navigation_query)
        if not np.isfinite(navigation_norm) or navigation_norm<=0:raise ValueError('dense_query_embedding_invalid')
        navigation_query/=navigation_norm
        def check():
            check_cancelled()
            if deadline is not None and time.monotonic()>=deadline:raise TimeoutError('dense_query_deadline')
        check();self.navigation.assert_unchanged()
        distances,ids=self.navigation.search(navigation_query,self.candidates)
        check();distances=np.asarray(distances);ids=np.asarray(ids)
        if (ids.shape!=(1,self.candidates) or distances.shape!=ids.shape or ids.dtype.kind not in 'iu'
                or not np.isfinite(distances).all() or np.any(ids<0) or np.any(ids>=self.vectors.count)
                or len(set(ids[0].tolist()))!=self.candidates):
            raise ValueError('dense_navigation_candidates_invalid')
        # Read nearby source coordinates together. Navigation order contributes
        # no score after exact reranking, and final ties use the global ordinal.
        ordinals=np.sort(ids[0].astype(np.int64));scores=np.empty(self.candidates,dtype=np.float64)
        for start in range(0,self.candidates,256):
            check();positions=ordinals[start:start+256]
            original=np.asarray(self._read(positions),dtype=np.float64)
            if original.shape!=(len(positions),3072) or not np.isfinite(original).all():raise ValueError('dense_original_vectors_invalid')
            norms=np.linalg.norm(original,axis=1)
            if not np.isfinite(norms).all() or np.any(norms<=0):raise ValueError('dense_original_vectors_invalid')
            scores[start:start+len(positions)]=(original/norms[:,None])@exact_query
        if not np.isfinite(scores).all():raise ValueError('dense_scores_invalid')
        order=np.lexsort((ordinals,-scores))[:limit]
        check();self.navigation.assert_unchanged();check()
        return [{'vector_ordinal':int(ordinals[index]),'score':float(scores[index])} for index in order]
