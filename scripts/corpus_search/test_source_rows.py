import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from source_rows import SourceRows


class SourceRowsTests(unittest.TestCase):
    def test_independent_reads_can_progress_concurrently(self):
        barrier = threading.Barrier(2)
        class Projection:
            def records_at(self, kind, part, requested):
                barrier.wait(timeout=2)
                yield requested[0], {'id': f'{part}:{requested[0]}'}
        reader = SourceRows(Projection())
        with ThreadPoolExecutor(max_workers=2) as workers:
            reads = [workers.submit(reader.read, 'prepared', [[part, 0]], 1024) for part in [0, 1]]
            self.assertEqual([read.result() for read in reads], [[{'id': '0:0'}], [{'id': '1:0'}]])

    def test_pinned_projection_reads_exact_rows_in_requested_order_without_shard_scans(self):
        calls = []
        class Projection:
            def records_at(self, kind, part, requested):
                calls.append((kind, part, requested))
                for row in sorted(requested):
                    yield row, {'id': f'{part}:{row}', 'text': 'Complete stored text.'}
        reader = SourceRows(Projection())
        result = reader.read('prepared', [[2, 4], [1, 8], [2, 3]], 1024)
        self.assertEqual([row['id'] for row in result], ['2:4', '1:8', '2:3'])
        self.assertEqual(len(calls), 2)
        with self.assertRaisesRegex(ValueError, 'bound'):
            reader.read('prepared', [[2, 4]], 4)

    def test_missing_extra_duplicate_or_interrupted_rows_are_not_complete_reads(self):
        for rows in [[], [(4, {})], [(3, {}), (3, {})]]:
            class Projection:
                def records_at(self, *_):
                    yield from rows
            with self.assertRaisesRegex(ValueError, 'identity'):
                SourceRows(Projection()).read('inventory', [[0, 3]], 100)
        class Interrupted:
            def records_at(self, *_):
                yield 3, {}
                raise OSError('projection_read_interrupted')
        with self.assertRaisesRegex(OSError, 'interrupted'):
            SourceRows(Interrupted()).read('inventory', [[0, 3]], 100)


if __name__ == '__main__':
    unittest.main()
