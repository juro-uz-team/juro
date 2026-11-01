import unittest
from source_references import SourceReferences


def row(work='a' * 64, source='123', edition=None, raw='b' * 64):
    return {'id': work, 'kind': 'document', 'state': 'done',
            'url': 'https://lex.uz/docs/' + source + ('?ONDATE=' + edition if edition else ''),
            'context': {'source': source, 'edition': edition}, 'raw_hash': raw,
            'receipt': {'status': 200, 'sha256': raw}}


class Package:
    sha256 = 'c' * 64
    inventory_parts = 1

    def __init__(self, rows):
        self.rows = rows
        self.reads = 0

    def records(self, kind, part):
        self.reads += 1
        yield from enumerate(self.rows)


class SourceReferenceTests(unittest.TestCase):
    def test_explicit_edition_token_disambiguates_only_matching_same_day_captures(self):
        scope = {'kind': 'historical', 'at': '2020-01-01'}
        package = Package([row(edition='01.01.2020'), row('d' * 64, edition='01.01.2020 12')])
        references = SourceReferences(package)
        self.assertEqual(references.resolve('https://lex.uz/docs/123', scope), ('ambiguous', None))
        self.assertEqual(references.resolve('https://lex.uz/docs/123?ONDATE=01.01.2020', scope), ('unique', 'a' * 64))
        self.assertEqual(references.resolve('https://lex.uz/docs/123?ONDATE=01.01.2020%2012', scope), ('unique', 'd' * 64))
        self.assertEqual(references.resolve('https://lex.uz/docs/123?ONDATE=01.01.2020%2013', scope), ('missing', None))
        self.assertEqual(package.reads, 1)
        conflicting = SourceReferences(Package(package.rows + [row('e' * 64, edition='01.01.2020')]))
        self.assertEqual(conflicting.resolve('https://lex.uz/docs/123?ONDATE=01.01.2020', scope), ('ambiguous', None))
        self.assertEqual(conflicting.resolve('https://lex.uz/docs/123?ONDATE=01.01.2020%2012', scope), ('unique', 'd' * 64))

    def test_complete_inventory_is_read_once_and_lookup_preserves_scope(self):
        package = Package([row(), row('d' * 64, edition='01.01.2020')])
        references = SourceReferences(package)
        self.assertEqual(references.resolve('https://lex.uz/docs/123', {'kind': 'current'}), ('unique', 'a' * 64))
        self.assertEqual(references.resolve('https://www.lex.uz/docs/123', {'kind': 'historical', 'at': '2020-01-01'}), ('unique', 'd' * 64))
        self.assertEqual(references.resolve('https://lex.uz/docs/123?ONDATE=01.01.2020', {'kind': 'historical', 'at': '2020-01-01'}), ('unique', 'd' * 64))
        self.assertEqual(references.resolve('https://lex.uz/docs/123', {'kind': 'historical', 'at': '2021-01-01'}), ('missing', None))
        self.assertEqual(package.reads, 1)

    def test_duplicates_are_not_conflicts_but_distinct_captures_or_aliases_are_ambiguous(self):
        for second, expected in [(row(), ('unique', 'a' * 64)),
                                 (row('d' * 64), ('ambiguous', None)),
                                 (row(raw='e' * 64), ('unique', 'a' * 64))]:
            references = SourceReferences(Package([row(), second]))
            self.assertEqual(references.resolve('https://lex.uz/docs/123', {'kind': 'current'}), expected)

    def test_ineligible_rows_and_unknown_sources_do_not_supply_a_capture(self):
        invalid = row()
        invalid['context']['source'] = 'other-document'
        references = SourceReferences(Package([invalid, {**row(), 'state': 'failed'}]))
        self.assertEqual(references.resolve('https://lex.uz/docs/123', {'kind': 'current'}), ('missing', None))
        self.assertEqual(references.resolve('https://lex.uz/docs/999', {'kind': 'current'}), ('missing', None))

    def test_request_cannot_change_publisher_fragment_or_temporal_scope(self):
        references = SourceReferences(Package([row()]))
        for url, scope in [('https://foreign.test/docs/123', {'kind': 'current'}),
                           ('https://lex.uz/docs/123#456', {'kind': 'current'}),
                           ('https://lex.uz/docs/123?ONDATE=01.01.2020', {'kind': 'current'}),
                           ('https://lex.uz/docs/123?ONDATE=01.01.2020', {'kind': 'historical', 'at': '2021-01-01'}),
                           ('https://lex.uz/docs/123?unknown=1', {'kind': 'current'}),
                           ('https://lex.uz/docs/123', {'kind': 'historical', 'at': '2020-02-30'}),
                           ('https://lex.uz/docs/123', {'kind': 'current', 'at': '2020-01-01'})]:
            with self.subTest(url=url, scope=scope), self.assertRaises(ValueError):
                references.resolve(url, scope)

    def test_incomplete_inventory_read_does_not_publish_a_partial_lookup(self):
        class Missing(Package):
            def records(self, kind, part):
                yield 0, row()
                raise OSError('inventory read unavailable')
        with self.assertRaisesRegex(OSError, 'read unavailable'):
            SourceReferences(Missing([]))


if __name__ == '__main__':
    unittest.main()
