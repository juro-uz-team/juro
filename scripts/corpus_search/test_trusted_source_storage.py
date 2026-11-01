import json
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zstandard
from trusted_source_storage import INDEX, TrustedSourceProjection, TrustedWorkIndex


class TrustedSourceStorageTests(unittest.TestCase):
    def test_declared_frame_size_cannot_bypass_the_decoding_allocation_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            encoded = zstandard.ZstdCompressor().compress(b'x' * 10000)
            (root / 'records.zst').write_bytes(encoded)
            projection = TrustedSourceProjection.__new__(TrustedSourceProjection)
            with patch('trusted_source_storage.MAX_RECORD_BYTES', 1024), self.assertRaisesRegex(ValueError, 'block_bound'):
                list(projection._read(root, [(0, 0, len(encoded), 1, 1, b'0' * 32)]))

    def test_complete_reads_preserve_positions_and_do_not_scan_unrequested_blocks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / 'manifest.json').write_text(json.dumps({'format': 'prepared-source-blocks-v1',
                'package_sha256': 'a' * 64, 'parts': {'inventory': ['stored-identity'], 'prepared': [], 'chunks': []}}))
            part = root / 'inventory-000000'
            part.mkdir()
            raw = b'{"id":"first","text":"Complete artificial provision."}\n{"id":"second"}\n'
            compressed = zstandard.ZstdCompressor().compress(raw)
            (part / 'records.zst').write_bytes(compressed)
            # The second block is unavailable; a read of the first block needs no other block.
            (part / 'rows.idx').write_bytes(INDEX.pack(0, 0, len(compressed), len(raw), 2, b'0' * 32)
                + INDEX.pack(2, len(compressed), 10, 20, 1, b'1' * 32))
            projection = TrustedSourceProjection(root, 'a' * 64)
            self.assertEqual(list(projection.records_at('inventory', 0, [1, 0])),
                [(0, {'id': 'first', 'text': 'Complete artificial provision.'}), (1, {'id': 'second'})])
            with self.assertRaisesRegex(ValueError, 'unavailable'):
                list(projection.records_at('inventory', 0, [3]))
            with self.assertRaisesRegex(ValueError, 'read_unavailable'):
                list(projection.records_at('inventory', 0, [2]))
            with self.assertRaisesRegex(ValueError, 'position_invalid'):
                list(projection.records_at('../private', 0, [0]))

    def test_work_lookup_preserves_missing_entries_and_read_only_storage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / 'manifest.json').write_text(json.dumps({'format': 'prepared-work-locations-v1', 'package_sha256': 'a' * 64}))
            connection = sqlite3.connect(root / 'works.sqlite')
            connection.execute('CREATE TABLE works(key BLOB,work TEXT,inventory_part INTEGER,inventory_row INTEGER,prepared_part INTEGER,prepared_row INTEGER)')
            connection.execute('INSERT INTO works VALUES(?,?,?,?,?,?)', (b'key', 'work', 1, 20, 2, 30))
            connection.commit()
            connection.close()
            reader = TrustedWorkIndex(root, 'b' * 64, 'a' * 64)
            try:
                self.assertEqual(reader.lookup([b'missing', b'key']), [None, {'work': 'work', 'inventory': (1, 20), 'prepared': (2, 30)}])
                with self.assertRaises(sqlite3.OperationalError):
                    reader.connection.execute('DELETE FROM works')
            finally:
                reader.close()


if __name__ == '__main__':
    unittest.main()
