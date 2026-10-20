from contextlib import contextmanager
from types import SimpleNamespace
import unittest

import numpy as np

from pgvector_navigation import PgvectorNavigation


class Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.commands = []

    def execute(self, sql, parameters=None):
        self.commands.append((sql, parameters))

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class Connection:
    autocommit = True

    def __init__(self, cursor):
        self.value = cursor
        self.info = SimpleNamespace(transaction_status=0)

    def cursor(self):
        return self.value


class PgvectorNavigationTests(unittest.TestCase):
    def setUp(self):
        self.cursor = Cursor([(4, 12), (2, 20)])
        self.connection = Connection(self.cursor)
        self.attestations = []
        self.query = np.ones((1, 3072), dtype=np.float32)

    @contextmanager
    def connect(self):
        yield self.connection

    def attest(self, cursor, pin):
        self.attestations.append((cursor, pin))

    def navigation(self, **changes):
        return PgvectorNavigation(self.connect, self.attest, **{
            "schema": "public", "table": "full_bits", "completion_sha256": "a" * 64,
            "manifest_sha256": "b" * 64, "count": 6, "lists": 100, "probes": 64, **changes})

    def test_search_binds_query_and_generation_in_one_read_only_snapshot(self):
        distances, ids = self.navigation().search(self.query, 2)
        self.assertEqual(ids.tolist(), [[4, 2]])
        self.assertEqual(distances.tolist(), [[12, 20]])
        self.assertEqual(self.attestations, [(self.cursor, "b" * 64)] * 2)
        statements = self.cursor.commands
        self.assertIn("REPEATABLE READ READ ONLY", statements[0][0])
        self.assertEqual(statements[1][1], ("10000", "64"))
        self.assertIn("set_config('search_path', 'pg_catalog, public', true)", statements[1][0])
        self.assertIn('FROM "public"."full_bits"', statements[2][0])
        self.assertNotIn("[1.0", statements[2][0])
        self.assertEqual(statements[2][1][1], 2)
        self.assertEqual(statements[-1], ("ROLLBACK", None))

    def test_invalid_generation_rolls_back_without_search(self):
        def reject(cursor, pin):
            raise ValueError("retired_generation")
        navigation = self.navigation()
        navigation.attest = reject
        with self.assertRaisesRegex(ValueError, "retired_generation"):
            navigation.search(self.query, 2)
        self.assertEqual(self.cursor.commands[-1], ("ROLLBACK", None))
        self.assertFalse(any("binary_quantize" in sql for sql, _ in self.cursor.commands))

    def test_partial_duplicate_invalid_and_unordered_candidates_fail_closed(self):
        for rows in [[(4, 12)], [(4, 12), (4, 20)], [(4, 12), (6, 20)],
                     [(4, 20), (2, 12)], [(4, 12), (2, float("nan"))]]:
            self.cursor.rows = rows
            with self.assertRaisesRegex(ValueError, "candidates_invalid"):
                self.navigation().search(self.query, 2)
            self.assertEqual(self.cursor.commands[-1], ("ROLLBACK", None))

    def test_invalid_configuration_query_and_transaction_are_rejected(self):
        for changes in [{"table": 'table"; SELECT 1'}, {"schema": "x.y"},
                        {"probes": 101}, {"count": True}, {"timeout_ms": 10001}]:
            with self.assertRaisesRegex(ValueError, "configuration_invalid"):
                self.navigation(**changes)
        for query in [self.query.astype(np.float64), self.query[:, :2], np.zeros_like(self.query)]:
            with self.assertRaisesRegex(ValueError, "query_invalid"):
                self.navigation().search(query, 2)
        self.connection.autocommit = False
        with self.assertRaisesRegex(ValueError, "autocommit_required"):
            self.navigation().search(self.query, 2)
        self.assertEqual(self.cursor.commands, [])

    def test_autocommit_connection_with_existing_transaction_is_not_touched(self):
        for status in [1, 2, 3, 4, None]:
            self.connection.info.transaction_status = status
            with self.assertRaisesRegex(ValueError, "idle_connection_required"):
                self.navigation().search(self.query, 2)
        self.assertEqual(self.cursor.commands, [])


if __name__ == "__main__":
    unittest.main()
