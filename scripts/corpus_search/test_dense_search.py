import time
import unittest
from unittest.mock import patch
import numpy as np
from dense_search import DenseSearch
import test_vectors
from scripts.corpus_search.vectors import VectorPool


class Navigation:
    dimensions=3072
    def __init__(self,vectors):
        self.count=vectors.count;self.completion_sha256=vectors.completion_sha256;self.bad=False
    def assert_unchanged(self):pass
    def search(self,query,count):
        assert query.shape==(1,3072) and query.dtype==np.float32
        self.last_norm=float(np.linalg.norm(query))
        ids=np.arange(self.count-1,self.count-count-1,-1,dtype=np.int64).reshape(1,count)
        if self.bad:ids[0,1]=ids[0,0]
        return np.zeros((1,count)),ids


class DenseTests(unittest.TestCase):
    def setUp(self):self.fixture=test_vectors.VectorPoolTests();self.fixture.setUp()
    def tearDown(self):self.fixture.tearDown()

    def test_long_search_honors_caller_deadline_without_an_internal_cutoff(self):
        vectors=VectorPool(self.fixture.root,self.fixture.pin);vectors.verify_all()
        try:
            navigation=Navigation(vectors);search=DenseSearch(navigation,vectors,6)
            original=navigation.search
            with patch('dense_search.time.monotonic',return_value=0) as clock:
                def delayed(query,count):
                    clock.return_value=20
                    return original(query,count)
                navigation.search=delayed
                self.assertEqual(len(search.search(self.fixture.values[1],30)),6)
                self.assertEqual(len(search.search(self.fixture.values[1],None)),6)
                with self.assertRaises(TimeoutError):
                    search.search(self.fixture.values[1],19)
        finally:vectors.close()

    def test_original_coordinates_override_navigation_order_and_match_float64_scan(self):
        fixture=self.fixture;vectors=VectorPool(fixture.root,fixture.pin);vectors.verify_all()
        try:
            navigation=Navigation(vectors);search=DenseSearch(navigation,vectors,6)
            query=fixture.values[1].copy();hits=search.search(query,time.monotonic()+5)
            q=query.astype(np.float64);q/=np.linalg.norm(q)
            values=fixture.values.astype(np.float64);scores=(values/np.linalg.norm(values,axis=1)[:,None])@q
            expected=np.lexsort((np.arange(6),-scores))
            self.assertEqual([row['vector_ordinal'] for row in hits],expected.tolist())
            np.testing.assert_allclose([row['score'] for row in hits],scores[expected],rtol=0,atol=1e-15)
            self.assertAlmostEqual(navigation.last_norm,1,places=6)
            self.assertEqual(DenseSearch(navigation,vectors,20000).candidates,6)
            with self.assertRaisesRegex(ValueError,'configuration_invalid'):DenseSearch(navigation,vectors,20001)
            navigation.bad=True
            with self.assertRaisesRegex(ValueError,'candidates_invalid'):search.search(query,time.monotonic()+5)
            with self.assertRaisesRegex(TimeoutError,'deadline'):search.search(query,time.monotonic()-1)
            with self.assertRaisesRegex(ValueError,'embedding_invalid'):search.search(np.zeros(3072),time.monotonic()+5)
            navigation.completion_sha256='f'*64
            with self.assertRaisesRegex(ValueError,'configuration_invalid'):DenseSearch(navigation,vectors,6)
        finally:vectors.close()


if __name__=='__main__':unittest.main()
