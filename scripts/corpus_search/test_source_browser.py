import pathlib
import tempfile
import unittest

from package import VerifiedStream, file_hash
from source_browser import SourceBrowser, build_catalog
from test_source_references import row


class Package:
    sha256 = 'a' * 64
    handoff = {'shards': {'inventory': [{}], 'prepared': [{}]}}

    def records(self, kind, part):
        official = row()
        values = [official] if kind == 'inventory' else [{
            'work': official['id'], 'title': 'Трудовой кодекс', 'status': 'prepared',
            'units': [{'text': 'Трудовые отношения', 'language': 'ru'}],
            'assignments': [{'scheme': 'LBC', 'node': '12', 'scope': 'document', 'label': 'Труд'}],
        }]
        return VerifiedStream(lambda: iter(enumerate(values)))


class SourceBrowserTests(unittest.TestCase):
    def test_published_catalog_finds_an_official_edition_by_title_id_and_category(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'corpus.sqlite'
            build_catalog(Package(), path)
            browser = SourceBrowser(path, file_hash(path), Package.sha256)
            with browser.open() as reader:
                result = reader.search('ТРУДОВОЙ 123', 'ru', 'LBC:12', 0)
                self.assertEqual([entry['title'] for entry in result['entries']], ['Трудовой кодекс'])
                self.assertEqual(reader.search('', '', 'LBC:13', 0)['entries'], [])
                self.assertEqual(result['categories'][0]['label'], 'Труд')
            with self.assertRaisesRegex(ValueError, 'catalog_integrity'):
                SourceBrowser(path, 'b' * 64, Package.sha256)

    def test_pdf_wrapper_exposes_its_retained_ocr_without_mixing_editions(self):
        class Scanned(Package):
            def records(self, kind, part):
                official = row()
                attachment = {'id': 'b' * 64, 'url': 'https://lex.uz/pdffile/123', 'kind': 'asset',
                    'context': {'source': '123', 'edition': None}, 'state': 'done'}
                values = [official, attachment] if kind == 'inventory' else [
                    {'work': official['id'], 'title': 'Официальный приказ', 'units': []},
                    {'work': attachment['id'], 'units': [{'text': 'Проверенная строка', 'language': 'ru'}]},
                ]
                return VerifiedStream(lambda: iter(enumerate(values)))

        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'corpus.sqlite'
            build_catalog(Scanned(), path)
            with SourceBrowser(path, file_hash(path), Scanned.sha256).open() as reader:
                self.assertEqual(reader.search('приказ', 'ru', '', 0)['entries'][0]['work'], 'a' * 64)
                self.assertEqual(reader.reading_plan('a' * 64, 0, 24), ([('b' * 64, 0, 1)], 1))
