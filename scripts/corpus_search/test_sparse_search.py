import hashlib
import math
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from sparse_postings import PostingRun, write_posting_run
from sparse_search import SparseIndex, WEIGHTS, score_term


class SparseSearchTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.terms = [hashlib.sha256(bytes([i])).digest() for i in range(3)]
        self.records = []
        postings = []
        for ordinal in range(1201):
            lengths = (4, 2, 3, 10 + ordinal % 7)
            weight = 1 + ordinal % 3
            self.records.append((ordinal, ordinal + 17, ordinal * 3, weight, *lengths))
            for i, term in enumerate(self.terms):
                if (ordinal + i) % 5:
                    postings.append((term, ordinal, (1 + ordinal % 3, i % 2, i, ordinal % 7 + 1), weight))
        self.postings = sorted(postings)
        root = pathlib.Path(self.directory.name) / 'postings'
        pin = write_posting_run(self.postings, root, 'a' * 64)
        self.posting_pin=pin
        index = SparseIndex.__new__(SparseIndex)
        index.run = PostingRun(root, pin, 'a' * 64)
        index.connection = sqlite3.connect(':memory:')
        index.connection.execute('CREATE TABLE profiles(ordinal INTEGER PRIMARY KEY, vector, first_membership, members, title, hierarchy, article, text)')
        index.connection.executemany('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?)', self.records)
        members = sum(row[3] for row in self.records)
        index.manifest = {'profiles': len(self.records), 'members': members}
        index.averages = [sum(row[3] * row[4 + field] for row in self.records) / members for field in range(4)]
        index.assert_unchanged = index.run.assert_unchanged
        self.index = index
        self.addCleanup(index.close)

    def test_retained_postings_preserve_sparse_rankings_without_rehashing(self):
        expected=self.index.search(self.terms,None)
        strict=self.index.run
        with patch('sparse_postings.file_hash',side_effect=AssertionError('corpus rehash')), \
             patch('sparse_postings.hashlib.sha256',side_effect=AssertionError('corpus rehash')):
            retained=PostingRun(strict.root,self.posting_pin,'a'*64,trust_prepared=True)
            self.index.run=retained
            try:self.assertEqual(self.index.search(self.terms,None),expected)
            finally:
                retained.close();self.index.run=strict

    def test_bounded_metadata_reads_preserve_complete_exact_ranking(self):
        expected = []
        dfs = {term: sum(weight for key, _, _, weight in self.postings if key == term) for term in self.terms}
        by_profile = {}
        for term, ordinal, frequencies, weight in self.postings:
            by_profile.setdefault(ordinal, []).append((term, frequencies))
        for row in self.records:
            ordinal, vector, member, _, *lengths = row
            score = 0.0
            for term, frequencies in by_profile[ordinal]:
                score += sum(score_term(tf, dfs[term], self.index.manifest['members'], length, average, weight)
                             for tf, length, average, weight in zip(frequencies, lengths, self.index.averages, WEIGHTS))
            expected.append((score, -ordinal, vector, member))
        statements = []
        self.index.connection.set_trace_callback(statements.append)
        actual = self.index.search(self.terms + self.terms, None)
        self.assertEqual(actual, [{'profile_ordinal': -ordinal, 'vector_ordinal': vector,
                                  'membership_ordinal': member, 'score': score}
                                 for score, ordinal, vector, member in sorted(expected, reverse=True)[:50]])
        selects = [sql for sql in statements if sql.startswith('SELECT')]
        self.assertLessEqual(len(selects), math.ceil(len(self.records) / 512))

    def test_missing_or_inconsistent_profile_in_later_batch_is_not_a_partial_result(self):
        self.index.connection.execute('DELETE FROM profiles WHERE ordinal=1025')
        with self.assertRaisesRegex(ValueError, 'sparse_query_profile_invalid'):
            self.index.search(self.terms, None)


if __name__ == '__main__':
    unittest.main()
