"""Pinned concurrent pgvector readers preserve the existing corpus identity."""
import copy
import hashlib
import json
import pathlib
import tempfile
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock,patch

from worker import PATHS, read_worker_manifest, open_worker


class PgvectorWorkerPolicyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = pathlib.Path(self.directory.name)
        self.spec = {
            'format': 'prepared-numeric-worker-v3',
            'paths': {key: str(self.root/key) for key in PATHS},
            'release': {'configuration': {'navigationBackend': 'pgvector', 'artifacts': {
                key: 'a'*64 for key in ['packageSha256', 'vectorCompletionSha256', 'vectorIdentitySha256',
                                      'membershipSha256', 'workIndexSha256', 'navigationSha256', 'sparseSha256']}}},
            'profilesSha256': 'b'*64, 'analyzerSha256': 'c'*64, 'probes': 4095, 'candidates': 20000,
            'execution': {'requestWorkers': 4, 'maxPending': 16, 'readWorkers': 4,
                          'sourceProjection': {'path': str(self.root/'projection'), 'sha256': 'd'*64}},
        }

    def read(self, spec):
        path = self.root/'worker.json'
        raw = json.dumps(spec).encode()
        path.write_bytes(raw)
        return read_worker_manifest(path, hashlib.sha256(raw).hexdigest())

    def test_parallel_policy_is_authenticated_without_changing_index_or_population(self):
        actual = self.read(self.spec)
        self.assertEqual(actual, self.spec)
        changed = copy.deepcopy(self.spec)
        changed['execution']['requestWorkers'] = 2
        path = self.root/'worker.json'
        previous_pin = hashlib.sha256(path.read_bytes()).hexdigest()
        path.write_text(json.dumps(changed))
        with self.assertRaisesRegex(ValueError, 'manifest_mismatch'):
            read_worker_manifest(path, previous_pin)

    def test_invalid_concurrency_and_unpinned_projection_fail_before_admission(self):
        for change in [{'requestWorkers': 0}, {'requestWorkers': 5}, {'requestWorkers': True},
                       {'maxPending': 33}, {'readWorkers': 3}, {'extra': True},
                       {'sourceProjection': {'path': 'relative', 'sha256': 'd'*64}},
                       {'sourceProjection': {'path': str(self.root), 'sha256': 'invalid'}}]:
            value = copy.deepcopy(self.spec)
            value['execution'].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.read(value)
        value = copy.deepcopy(self.spec)
        value['release']['configuration']['navigationBackend'] = 'binary-projected'
        with self.assertRaises(ValueError):
            self.read(value)

    def test_cli_cannot_override_pinned_pgvector_execution(self):
        for override in [{'source_projection': str(self.root/'other')}, {'sparse_kernel': 'other.so'},
                         {'raw_read_mode': 'positioned'}, {'membership_page_navigation': True}]:
            with self.subTest(override=override), self.assertRaisesRegex(ValueError, 'execution_override'):
                with open_worker(self.spec, lambda: None, **override):
                    self.fail('An unpinned execution override was admitted')

    def test_optional_sparse_kernel_is_pinned_and_checked_before_artifact_admission(self):
        kernel = self.root/'sparse.so'
        kernel.write_bytes(b'artificial kernel')
        self.spec['execution']['sparseKernel'] = {
            'path': str(kernel), 'sha256': hashlib.sha256(kernel.read_bytes()).hexdigest()}
        self.assertEqual(self.read(self.spec), self.spec)
        kernel.write_bytes(b'changed kernel')
        with self.assertRaisesRegex(ValueError, 'kernel_mismatch'):
            with open_worker(self.spec, lambda: None):
                self.fail('Changed executable admitted')
        self.spec['execution']['sparseKernel']['sha256'] = 'invalid'
        with self.assertRaisesRegex(ValueError, 'execution_invalid'):
            self.read(self.spec)

    def test_membership_page_navigation_is_an_optional_pinned_boolean(self):
        for enabled in [False, True]:
            self.spec['execution']['membershipPageNavigation'] = enabled
            self.assertEqual(self.read(self.spec), self.spec)
        for invalid in [0, 1, 'true', None]:
            self.spec['execution']['membershipPageNavigation'] = invalid
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, 'execution_invalid'):
                self.read(self.spec)

    def test_retained_policy_requires_explicit_boolean_and_concurrent_pgvector(self):
        self.spec['trustPrepared']=True
        self.assertEqual(self.read(self.spec),self.spec)
        for value in [1,'true',None]:
            with self.assertRaisesRegex(ValueError,'trust_policy_invalid'):
                self.read({**self.spec,'trustPrepared':value})
        old={**self.spec,'format':'prepared-numeric-worker-v1'}
        old.pop('execution')
        with self.assertRaisesRegex(ValueError,'trust_policy_invalid'):self.read(old)

    def test_retained_policy_reaches_every_reader_without_vector_recertification(self):
        self.spec['trustPrepared']=True
        navigation=SimpleNamespace(assert_unchanged=Mock())
        generation=SimpleNamespace(manifest={'completion_sha256':'a'*64},navigation=lambda *_:navigation)
        package=SimpleNamespace(handoff={'shards':{'chunks':[]}})
        vectors=Mock(count=3)
        vectors.verify_all.side_effect=AssertionError('corpus recertification')
        replacements={'PgvectorGeneration':generation,'PreparedPackage':package,'VectorPool':vectors,
            'VectorIdentityIndex':Mock(manifest={'rows':3}),'WorkIndex':Mock(),'MembershipIndex':Mock(),
            'SparseProfiles':Mock(manifest={'chunk_parts':[]}),'SparseIndex':Mock()}
        with ExitStack() as stack:
            constructors={name:stack.enter_context(patch('worker.'+name,return_value=value))
                          for name,value in replacements.items()}
            projection=stack.enter_context(patch('source_projection.SourceProjection'))
            projection.return_value.assert_unchanged=Mock()
            for name in ['PreparedDiscoveryCatalog','DenseSearch','PreparedHybridSearch','PreparedNumericService']:
                stack.enter_context(patch('worker.'+name))
            with open_worker(self.read(self.spec),lambda:None):
                vectors.open_retained.assert_called_once_with()
                vectors.verify_all.assert_not_called()
                for constructor in [*constructors.values(),projection]:
                    self.assertIs(constructor.call_args.kwargs['trust_prepared'],True)
            vectors.close.assert_called_once_with()
            projection.return_value.close.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
