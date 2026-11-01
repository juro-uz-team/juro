import hashlib
import json
import pathlib
import tempfile
import unittest
from source_worker import read_manifest
from source_service import PreparedSourceService


class SourceWorkerTests(unittest.TestCase):
    def test_manifest_authenticates_full_corpus_paths_and_bounds_concurrency(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            path = root / 'worker.json'
            spec = {'format': 'prepared-source-worker-v1', 'paths': {'package': str(root), 'works': str(root)},
                    'artifacts': {key: 'a' * 64 for key in PreparedSourceService.ARTIFACTS}, 'workers': 2, 'maxPending': 8}
            raw = json.dumps(spec).encode()
            path.write_bytes(raw)
            self.assertEqual(read_manifest(path, hashlib.sha256(raw).hexdigest()), spec)
            projected = {**spec, 'sourceProjection': {'path': str(root), 'sha256': 'd' * 64}}
            raw = json.dumps(projected).encode(); path.write_bytes(raw)
            self.assertEqual(read_manifest(path, hashlib.sha256(raw).hexdigest()), projected)
            for projection in [{'path': '.', 'sha256': 'd' * 64}, {'path': str(root)},
                               {'path': str(root), 'sha256': 'unpinned'}]:
                raw = json.dumps({**spec, 'sourceProjection': projection}).encode(); path.write_bytes(raw)
                with self.assertRaisesRegex(ValueError, 'projection'):
                    read_manifest(path, hashlib.sha256(raw).hexdigest())
            with self.assertRaisesRegex(ValueError, 'mismatch'):read_manifest(path, 'b' * 64)
            rendered = {**spec, 'officeImage': 'sha256:' + 'c' * 64}
            raw = json.dumps(rendered).encode(); path.write_bytes(raw)
            self.assertEqual(read_manifest(path, hashlib.sha256(raw).hexdigest()), rendered)
            raw = json.dumps({**spec, 'officeImage': 'renderer:latest'}).encode(); path.write_bytes(raw)
            with self.assertRaisesRegex(ValueError, 'invalid'):read_manifest(path, hashlib.sha256(raw).hexdigest())
            for field, value in [('workers', 5), ('maxPending', 0), ('paths', {'package': '.', 'works': str(root)})]:
                invalid = json.dumps({**spec, field: value}).encode()
                path.write_bytes(invalid)
                with self.assertRaisesRegex(ValueError, 'invalid'):read_manifest(path, hashlib.sha256(invalid).hexdigest())


if __name__ == '__main__':
    unittest.main()
