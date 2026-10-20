import copy
import unittest
from types import SimpleNamespace

from numeric_service import PreparedNumericService
import test_hybrid_search


class NumericServiceTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_hybrid_search.HybridTests()
        self.fixture.setUp()
        f = self.fixture
        f.profiles.manifest['vector_identity_sha256'] = '1'*64
        f.sparse.manifest_sha256 = '2'*64
        self.catalog_calls = []
        self.catalog = SimpleNamespace(package=SimpleNamespace(sha256='a'*64), vectors=f.vectors,
            memberships=f.memberships, works=SimpleNamespace(manifest_sha256='3'*64),
            read_exact=lambda references: self.catalog_calls.append(references) or {'records': references})
        self.configuration = {'backend': 'prepared-corpus-v1', 'navigationBackend': 'pgvector',
            'embeddingModel': 'openai/text-embedding-3-large', 'dimensions': 3072,
            'evidenceSemantics': 'discovery-only', 'categoryRanking': {'mode': 'disabled'},
            'artifacts': {'packageSha256': 'a'*64, 'vectorCompletionSha256': 'f'*64,
                'vectorIdentitySha256': '1'*64, 'membershipSha256': f.memberships.manifest_sha256,
                'workIndexSha256': '3'*64, 'navigationSha256': 'b'*64, 'sparseSha256': '2'*64}}
        self.release = {'id': 'prepared', 'environment': 'production', 'capability': 'current',
                        'configuration': self.configuration}
        self.service = PreparedNumericService(self.release, f.engine(), self.catalog)
        self.request = {'version': 'prepared-search-v1', 'releaseId': 'prepared', 'environment': 'production',
            'configuration': copy.deepcopy(self.configuration), 'endpoint': {'kind': 'current'},
            'requestSha256': '4'*64, 'limit': 50, 'embedding': [.1]*3072, 'termHashes': ['5'*64]}

    def tearDown(self):
        self.fixture.tearDown()

    def test_numeric_request_reaches_hybrid_and_retains_exact_discovery_identity(self):
        result = self.service.search(self.request)
        self.assertEqual(result['lanes'], {'dense': 'complete', 'sparse': 'complete'})
        self.assertEqual(result['requestSha256'], self.request['requestSha256'])
        self.assertEqual(result['hits'][0]['membershipOrdinal'], 1)
        self.assertEqual(result['hits'][0]['vectorOrdinal'], 0)
        result['configuration']['artifacts']['packageSha256'] = '0'*64
        self.assertEqual(self.service.search(self.request)['configuration'], self.configuration)
        request = {'artifacts': self.configuration['artifacts'], 'references': [[0, 1]]}
        self.assertEqual(self.service.read_exact(request), {'records': [[0, 1]]})

    def test_mismatch_or_bad_numeric_input_fails_before_any_lane(self):
        def unexpected(*args):
            self.fail('invalid request reached retrieval')
        self.service.hybrid.search = unexpected
        for change in [{'releaseId': 'old'}, {'environment': 'staging'}, {'query': 'private'},
                       {'endpoint': {'kind': 'timestamp', 'instant': '2020-01-01T00:00:00Z'}},
                       {'embedding': [0]*3072}, {'embedding': [float('inf')]*3072},
                       {'embedding': [True]*3072}, {'termHashes': ['5'*64]*2}, {'limit': True}]:
            with self.subTest(change=list(change)):
                with self.assertRaises(ValueError):
                    self.service.search({**self.request, **change})
        with self.assertRaises(ValueError):
            self.service.read_exact({'artifacts': {}, 'references': [[0, 1]]})
        self.assertEqual(self.catalog_calls, [])

    def test_unimplemented_category_policy_and_wrong_artifact_are_not_silently_accepted(self):
        for change in [{'categoryRanking': {'mode': 'qualified', 'policySha256': '6'*64,
                                          'qualificationSha256': '7'*64}},
                       {'artifacts': {**self.configuration['artifacts'], 'sparseSha256': '0'*64}}]:
            with self.assertRaises(ValueError):
                PreparedNumericService({**self.release, 'configuration': {**self.configuration, **change}},
                                       self.fixture.engine(), self.catalog)

    def test_history_discovery_preserves_arbitrary_fractional_precision(self):
        service = PreparedNumericService({**self.release, 'capability': 'history'}, self.fixture.engine(), self.catalog)
        for instant in ['2020-01-01T00:00:00.1234567Z', '2020-01-01T00:00Z', '0000-01-01T00:00:00Z']:
            request = {**self.request, 'endpoint': {'kind': 'timestamp', 'instant': instant}}
            self.assertEqual(service.search(request)['requestSha256'], request['requestSha256'])
            self.assertEqual(request['endpoint']['instant'], instant)
        with self.assertRaises(ValueError):
            service.search({**request, 'endpoint': {'kind': 'timestamp', 'instant': '2020-02-30T00:00:00Z'}})


if __name__ == '__main__':
    unittest.main()
