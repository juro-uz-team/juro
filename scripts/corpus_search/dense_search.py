"""Navigate compressed vectors, then rerank retained original float32 values.

Float64 cosine matches the independent exact qualification scan. This changes
neither stored embeddings nor their coordinates. Candidate recall and latency
still require qualification for the selected navigation candidate count.
"""
import math
import time
import numpy as np


class DenseSearch:
    def __init__(self,navigation,vectors,candidates):
        if (not vectors.ready or navigation.completion_sha256!=vectors.completion_sha256
                or navigation.count!=vectors.count or navigation.dimensions!=3072
                or type(candidates) is not int or not 1<=candidates<=20000):
            raise ValueError('dense_search_configuration_invalid')
        self.navigation=navigation;self.vectors=vectors;self.candidates=min(candidates,vectors.count)
        self.vectors.prepare_random_reads()

    def search(self,query,deadline,limit=50):
        if (type(limit) is not int or not 1<=limit<=50 or type(deadline) not in (int,float)
                or not math.isfinite(deadline)):
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
        deadline=min(deadline,time.monotonic()+10)
        def check():
            if time.monotonic()>=deadline:raise TimeoutError('dense_query_deadline')
        check();self.navigation.assert_unchanged();self.vectors.assert_unchanged()
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
            original=np.asarray(self.vectors.read(positions.tolist()),dtype=np.float64)
            if original.shape!=(len(positions),3072) or not np.isfinite(original).all():raise ValueError('dense_original_vectors_invalid')
            norms=np.linalg.norm(original,axis=1)
            if not np.isfinite(norms).all() or np.any(norms<=0):raise ValueError('dense_original_vectors_invalid')
            scores[start:start+len(positions)]=(original/norms[:,None])@exact_query
        if not np.isfinite(scores).all():raise ValueError('dense_scores_invalid')
        order=np.lexsort((ordinals,-scores))[:limit]
        check();self.navigation.assert_unchanged();self.vectors.assert_unchanged();check()
        return [{'vector_ordinal':int(ordinals[index]),'score':float(scores[index])} for index in order]
