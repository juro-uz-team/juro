import hashlib
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_vectors
from worker import read_worker_manifest, open_worker, PATHS
from vectors import VectorPool


class WorkerTests(unittest.TestCase):
    def test_manifest_pin_and_strict_configuration_are_checked_before_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            spec = {'format': 'prepared-numeric-worker-v1', 'paths': {key: str(root/key) for key in PATHS},
                'release': {'configuration': {'artifacts': {key: 'a'*64 for key in [
                    'packageSha256', 'vectorCompletionSha256', 'vectorIdentitySha256',
                    'membershipSha256', 'workIndexSha256', 'navigationSha256', 'sparseSha256']}}},
                'profilesSha256': 'b'*64, 'analyzerSha256': 'c'*64, 'probes': 1, 'candidates': 1000}
            path = root/'worker.json'
            def write(value):
                raw = json.dumps(value).encode()
                path.write_bytes(raw)
                return hashlib.sha256(raw).hexdigest()
            pin = write(spec)
            self.assertEqual(read_worker_manifest(path, pin), spec)
            with self.assertRaisesRegex(ValueError, 'manifest_mismatch'):
                read_worker_manifest(path, '0'*64)
            for change in [{'probes': True}, {'candidates': 20001}, {'paths': {**spec['paths'], 'vectors': 'relative'}},
                           {'databasePassword': 'must not be stored here'}]:
                with self.assertRaises(ValueError):
                    read_worker_manifest(path, write({**spec, **change}))

    def test_later_admission_failure_closes_authenticated_original_vector_pool(self):
        fixture = test_vectors.VectorPoolTests()
        fixture.setUp()
        pool = VectorPool(fixture.root, fixture.pin)
        navigation = SimpleNamespace(assert_unchanged=lambda: None)
        generation = SimpleNamespace(manifest={'completion_sha256': fixture.pin}, navigation=lambda *_: navigation)
        pins = {key: 'a'*64 for key in ['navigationSha256', 'packageSha256', 'vectorIdentitySha256']}
        pins['vectorCompletionSha256'] = fixture.pin
        spec = {'paths': {key: str(fixture.root) for key in PATHS}, 'probes': 1,
                'release': {'configuration': {'artifacts': pins}}}
        try:
            with patch('worker.PgvectorGeneration', return_value=generation), patch('worker.PreparedPackage'), \
                 patch('worker.VectorPool', return_value=pool), \
                 patch('worker.VectorIdentityIndex', side_effect=ValueError('identity_corrupt')):
                with self.assertRaisesRegex(ValueError, 'identity_corrupt'):
                    with open_worker(spec, lambda: None):
                        self.fail('worker admitted incomplete reader graph')
                self.assertFalse(pool.ready)
                self.assertEqual(pool.opened, {})
        finally:
            pool.close()
            fixture.tearDown()


if __name__ == '__main__':
    unittest.main()
