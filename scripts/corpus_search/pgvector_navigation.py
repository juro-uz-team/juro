"""Pgvector candidate navigation for the preserved-coordinate dense reader.

The caller supplies autocommit database connections and a generation attestor.
The attestor must authenticate the selected, immutable relation and index against
the release's navigation manifest using the provided cursor. It runs inside the
same read-only snapshot as the search. This adapter does not publish, qualify or
activate a generation. Distances are navigation hints, never evidence scores.
"""
import re

import numpy as np


class PgvectorNavigation:
    dimensions = 3072

    def __init__(self, connect, attest, *, schema, table, completion_sha256,
                 manifest_sha256, count, lists, probes, timeout_ms=10000):
        identifiers = (schema, table)
        hashes = (completion_sha256, manifest_sha256)
        if (not callable(connect) or not callable(attest)
                or any(not isinstance(v, str) or not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", v)
                       for v in identifiers)
                or any(not isinstance(v, str) or not re.fullmatch(r"[a-f0-9]{64}", v) for v in hashes)
                or type(count) is not int or not 0 < count < 2**53
                or type(lists) is not int or not 1 <= lists <= 32768
                or type(probes) is not int or not 1 <= probes <= lists
                or type(timeout_ms) is not int or not 1 <= timeout_ms <= 10000):
            raise ValueError("pgvector_navigation_configuration_invalid")
        self.connect = connect
        self.attest = attest
        self.count = count
        self.completion_sha256 = completion_sha256
        self.manifest_sha256 = manifest_sha256
        self.probes = probes
        self.timeout_ms = timeout_ms
        self.relation = f'"{schema}"."{table}"'

    def _read(self, operation):
        with self.connect() as connection:
            # Explicit transaction ownership prevents settings from leaking into
            # a pool and avoids joining a caller's older or writable transaction.
            if connection.autocommit is not True:
                raise ValueError("pgvector_navigation_autocommit_required")
            # Psycopg's IDLE transaction status is zero. Autocommit connections
            # can still contain an explicitly started transaction; nested BEGIN
            # would only warn and would not establish the requested snapshot.
            if getattr(getattr(connection, "info", None), "transaction_status", None) != 0:
                raise ValueError("pgvector_navigation_idle_connection_required")
            with connection.cursor() as cursor:
                cursor.execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                try:
                    cursor.execute("SELECT set_config('statement_timeout', %s, true), "
                                   "set_config('lock_timeout', '1000', true), "
                                   "set_config('ivfflat.probes', %s, true)",
                                   (str(self.timeout_ms), str(self.probes)))
                    self.attest(cursor, self.manifest_sha256)
                    result = operation(cursor)
                    self.attest(cursor, self.manifest_sha256)
                    return result
                finally:
                    cursor.execute("ROLLBACK")

    def assert_unchanged(self):
        self._read(lambda cursor: None)

    def search(self, query, count):
        if type(count) is not int or not 1 <= count <= min(self.count, 20000):
            raise ValueError("pgvector_navigation_request_bound")
        values = np.asarray(query)
        if (values.shape != (1, self.dimensions) or values.dtype.kind != "f"
                or values.dtype.itemsize != 4 or not np.isfinite(values).all()
                or not np.any(values != 0)):
            raise ValueError("pgvector_navigation_query_invalid")
        literal = "[" + ",".join(str(float(v)) for v in values[0]) + "]"

        def search(cursor):
            cursor.execute(f"SELECT id, v <~> binary_quantize(%s::vector)::bit(3072) AS distance "
                           f"FROM {self.relation} ORDER BY distance LIMIT %s", (literal, count))
            rows = cursor.fetchall()
            if (len(rows) != count
                    or any(len(row) != 2 or type(row[0]) is not int or not 0 <= row[0] < self.count
                           or type(row[1]) not in (int, float) or not np.isfinite(row[1])
                           or not 0 <= row[1] <= self.dimensions for row in rows)
                    or len({row[0] for row in rows}) != count
                    or any(left[1] > right[1] for left, right in zip(rows, rows[1:]))):
                raise ValueError("pgvector_navigation_candidates_invalid")
            return (np.asarray([[row[1] for row in rows]], dtype=np.float32),
                    np.asarray([[row[0] for row in rows]], dtype=np.int64))

        return self._read(search)
