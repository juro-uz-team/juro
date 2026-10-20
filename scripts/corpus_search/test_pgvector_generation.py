import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from pgvector_generation import PgvectorGeneration


class GenerationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.directory.name)/'navigation.json'
        self.snapshot = {'table_owner': 10, 'function_owner': 10, 'table_oid': 100}
        self.manifest = {'format': 'pgvector-sealed-navigation-v1', 'dimensions': 3072,
            'count': 100, 'lists': 1, 'schema': 'public', 'table': 'vectors', 'index': 'vectors_ivf',
            'completion_sha256': 'a'*64, 'import_receipt_sha256': 'b'*64, 'snapshot': self.snapshot}

    def tearDown(self):
        self.directory.cleanup()

    def publish(self):
        raw = json.dumps(self.manifest).encode()
        self.path.write_bytes(raw)
        self.pin = hashlib.sha256(raw).hexdigest()
        return PgvectorGeneration(self.path, self.pin)

    def test_manifest_hash_and_identifiers_are_required(self):
        generation = self.publish()
        navigation = generation.navigation(lambda: None, 1)
        self.assertEqual(navigation.count, 100)
        self.assertEqual(navigation.manifest_sha256, self.pin)
        self.assertEqual(navigation.completion_sha256, 'a'*64)
        with self.assertRaisesRegex(ValueError, 'manifest_mismatch'):
            PgvectorGeneration(self.path, '0'*64)
        for field, value in [('table', 'vectors;DROP TABLE users'), ('count', True),
                             ('lists', 0), ('completion_sha256', None)]:
            previous = self.manifest[field]
            self.manifest[field] = value
            with self.assertRaises(ValueError):
                self.publish()
            self.manifest[field] = previous

    def test_changed_snapshot_or_write_role_cannot_attest(self):
        generation = self.publish()
        class Cursor:
            role = (False, False, False, False, False, False, False, True)
            def execute(self, *args):
                pass
            def fetchone(self):
                return self.role
        cursor = Cursor()
        with patch('pgvector_generation.inspect_generation', return_value=self.snapshot):
            generation(cursor, self.pin)
            for position in range(8):
                changed = list(Cursor.role)
                changed[position] = not changed[position]
                cursor.role = tuple(changed)
                with self.assertRaisesRegex(ValueError, 'read_role_required'):
                    generation(cursor, self.pin)
        with patch('pgvector_generation.inspect_generation', return_value={**self.snapshot, 'table_oid': 101}):
            with self.assertRaisesRegex(ValueError, 'generation_changed'):
                generation(cursor, self.pin)
        with self.assertRaisesRegex(ValueError, 'pin_mismatch'):
            generation(cursor, '0'*64)


if __name__ == '__main__':
    unittest.main()
