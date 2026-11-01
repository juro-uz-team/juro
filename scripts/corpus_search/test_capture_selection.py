import unittest
from capture_selection import CaptureSelection


def capture(work, raw='a' * 64, url='https://lex.uz/docs/123'):
    return {'id': work, 'kind': 'document', 'state': 'done', 'url': url, 'raw_hash': raw,
            'context': {'source': '123'}, 'receipt': {'status': 200, 'sha256': raw}}


class Package:
    sha256 = 'b' * 64
    handoff = {'shards': {'inventory': [{}, {}]}}

    def __init__(self, parts):
        self.parts = parts

    def records(self, kind, part):
        assert kind == 'inventory'
        yield from enumerate(self.parts[part])


class CaptureSelectionTests(unittest.TestCase):
    def test_identical_capture_preparations_are_unambiguous_but_different_captures_are_not(self):
        first = capture('first')
        selection = CaptureSelection(Package([[first], [capture('reprepared')]]))
        self.assertEqual(selection.check(first), 'unique')
        selection = CaptureSelection(Package([[first], [capture('changed', 'c' * 64)]]))
        self.assertEqual(selection.check(first), 'conflict')
        self.assertEqual(selection.check(capture('changed', 'c' * 64)), 'conflict')

    def test_historical_and_pdf_captures_do_not_compete_with_current_html(self):
        first = capture('first')
        historical = capture('history', 'c' * 64, 'https://lex.uz/docs/123?ONDATE=01.01.2020')
        pdf = capture('pdf', 'd' * 64, 'https://lex.uz/pdfs/123')
        selection = CaptureSelection(Package([[first], [historical, pdf]]))
        self.assertEqual(selection.check(first), 'unique')
        self.assertEqual(selection.check(historical), 'unavailable')
        self.assertEqual(selection.check(pdf), 'unavailable')
        self.assertEqual(selection.check(capture('unknown', 'e' * 64)), 'unavailable')

    def test_failed_integrity_scan_never_publishes_a_partial_selection(self):
        class Broken(Package):
            def records(self, kind, part):
                yield 0, capture('first')
                raise ValueError('retained shard integrity failure')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            CaptureSelection(Broken([[], []]))


if __name__ == '__main__':
    unittest.main()
