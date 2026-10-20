import hashlib
import json
import pathlib
import tempfile
import time
import unittest
from types import SimpleNamespace

from hybrid_search import PreparedHybridSearch
from membership import MembershipIndex, PAGE_ROWS, RECORD, write_part
from pgvector_navigation import PgvectorNavigation


class HybridTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.directory.name)
        self.keys = [bytes([160]) + bytes([i]) * 31 for i in range(3)]
        # Two structural profiles share one compact vector. Their source
        # memberships are interleaved across pages and must remain distinct.
        self.rows = [(self.keys[0], bytes([i % 2]) * 32, b'c'*32, b'w'*32, i)
                     for i in range(260)]
        self.rows[-1] = (self.keys[0], b'z'*32, b'c'*32, b'w'*32, 259)
        self.rows += [(self.keys[1], b'o'*32, b'c'*32, b'w'*32, 260),
                      (self.keys[2], b'p'*32, b'c'*32, b'w'*32, 261)]
        part = write_part(self.root, 160, iter(self.rows))
        manifest = {'format': 'prepared-membership-pages-v1', 'complete': True,
                    'record_bytes': RECORD.size, 'page_rows': PAGE_ROWS, 'rows': 262,
                    'work_key_format': 'sha256-utf8-work-id-v1', 'parts': [part],
                    'vectors': 3, 'vector_completion_sha256': 'f'*64,
                    **{key: 'a'*64 for key in ['package_sha256', 'mapping_manifest_sha256',
                       'source_membership_manifest_sha256', 'work_manifest_sha256']}}
        raw = json.dumps(manifest).encode()
        (self.root/'manifest.json').write_bytes(raw)
        self.memberships = MembershipIndex(self.root, hashlib.sha256(raw).hexdigest())
        self.vectors = SimpleNamespace(count=3, completion_sha256='f'*64,
                                      input_hashes=lambda ids: [self.keys[i] for i in ids],
                                      assert_unchanged=lambda: None)
        navigation = PgvectorNavigation(lambda: None, lambda *_: None, schema='public', table='vectors',
                                         completion_sha256='f'*64, manifest_sha256='b'*64,
                                         count=3, lists=1, probes=1)
        navigation.assert_unchanged = lambda: None
        self.dense_hits = [{'vector_ordinal': 1, 'score': .9}, {'vector_ordinal': 0, 'score': .8}]
        self.sparse_hits = [{'profile_ordinal': 1, 'vector_ordinal': 0, 'membership_ordinal': 1, 'score': 3}]
        self.dense = SimpleNamespace(vectors=self.vectors, navigation=navigation,
                                     search=lambda *args, **kwargs: self.dense_hits)
        self.sparse = SimpleNamespace(manifest={'profiles_sha256': 'c'*64, 'members': 262, 'profiles': 4},
                                      search=lambda *args, **kwargs: self.sparse_hits,
                                      assert_unchanged=lambda: None)
        self.profiles = SimpleNamespace(manifest_sha256='c'*64,
            manifest={'package_sha256': 'a'*64, 'vector_completion_sha256': 'f'*64, 'members': 262, 'profiles': 4},
            assert_unchanged=lambda: None)

    def tearDown(self):
        self.directory.cleanup()

    def engine(self):
        return PreparedHybridSearch(self.dense, self.sparse, self.profiles, self.memberships)

    def test_fusion_preserves_exact_membership_and_structural_profile(self):
        hits = self.engine().search(None, [], time.monotonic()+5)
        self.assertEqual(len(hits), 50)
        by_id = {hit['membershipOrdinal']: hit for hit in hits}
        self.assertEqual(hits[0]['membershipOrdinal'], 1)
        self.assertEqual(by_id[1]['keywordRank'], 1)
        self.assertEqual(by_id[1]['vectorRank'], 3)
        self.assertAlmostEqual(by_id[1]['fusionScore'], 1/61 + 1/63)
        self.assertEqual(by_id[260]['keywordScore'], 0)
        self.assertEqual(by_id[260]['vectorOrdinal'], 1)
        for hit in hits:
            if hit['keywordScore']:
                self.assertEqual(hit['membershipOrdinal'] % 2, 1)

    def test_sparse_profile_scans_continuations_without_substituting_neighbours(self):
        # Only the final membership has the requested structural identity.
        self.dense_hits = []
        self.sparse_hits = [{'profile_ordinal': 3, 'vector_ordinal': 0, 'membership_ordinal': 259, 'score': 1}]
        self.assertEqual(self.engine().search(None, [], time.monotonic()+5)[0]['membershipOrdinal'], 259)
        self.sparse_hits[0]['membership_ordinal'] = 260
        with self.assertRaisesRegex(ValueError, 'sparse_membership_missing'):
            self.engine().search(None, [], time.monotonic()+5)

    def test_failed_lane_and_deadline_never_return_partial_hits(self):
        def failed(*args, **kwargs):
            raise RuntimeError('sparse unavailable')
        self.sparse.search = failed
        with self.assertRaisesRegex(RuntimeError, 'sparse unavailable'):
            self.engine().search(None, [], time.monotonic()+5)
        with self.assertRaises(TimeoutError):
            self.engine().search(None, [], time.monotonic()-1)

    def test_cross_generation_and_non_pgvector_navigation_rejected(self):
        self.profiles.manifest['package_sha256'] = 'e'*64
        with self.assertRaisesRegex(ValueError, 'generation_mismatch'):
            self.engine()
        self.profiles.manifest['package_sha256'] = 'a'*64
        self.dense.navigation = SimpleNamespace()
        with self.assertRaisesRegex(ValueError, 'generation_mismatch'):
            self.engine()


if __name__ == '__main__':
    unittest.main()
