"""Guard the actual retained backend interface, beyond in-memory vector test doubles."""
import unittest
from scripts.corpus_batch.representation import IndexedVectors


class RetainedVectorReaderTests(unittest.TestCase):
    def test_indexed_backend_exposes_worker_random_read_contract(self):
        for name in ['prepare_random_reads', 'read_positions']:
            with self.subTest(method=name):
                self.assertTrue(callable(getattr(IndexedVectors, name, None)),
                                'The numeric worker requires the retained indexed backend method ' + name)
