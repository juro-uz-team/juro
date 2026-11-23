import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

from .maintenance import DAY, SourceObservations, edition_on_or_after
from .maintenance_package import checked_input, cumulative_works, select_rows, write_package
from .maintenance_vectors import EmbeddingCache, fill
from .store import Store, digest


class MaintenanceTests(unittest.TestCase):
    def test_embedding_reuses_exact_baseline_and_completed_provider_coordinates(self):
        class Identities:
            def lookup(self, keys):
                return [0 if key == b'existing' else None for key in keys]

        class Base:
            def read(self, ordinals):
                self.requested = ordinals
                return [[0.25] * 3072 for _ in ordinals]

        cache = EmbeddingCache(sqlite3.connect(':memory:'))
        requests = []

        def embed(inputs):
            requests.extend(inputs)
            return {'vectors': [[0.75] * 3072 for _ in inputs]}

        rows = [(0, b'existing', 'Already embedded', 2), (1, b'new', 'New law', 2)]
        initial = list(fill(rows, Base(), Identities(), cache, embed, 2))
        resumed = list(fill(rows, Base(), Identities(), cache, embed, 2))
        self.assertEqual(requests, ['New law'])
        self.assertEqual(initial, resumed)
        self.assertNotEqual(initial[0][1], initial[1][1])

    def test_daily_checks_are_oldest_first_and_resume_the_first_catchup(self):
        db = sqlite3.connect(':memory:')
        maintenance = SourceObservations(db)
        for identifier in range(14):
            maintenance.observe_baseline({
                'kind': 'document', 'state': 'done', 'receipt': {'status': 200, 'observed': identifier + 1},
                'url': f'https://lex.uz/docs/{identifier + 1}', 'raw_hash': 'a' * 64, 'id': str(identifier),
            })
        self.assertEqual(maintenance.planned(False), {'https://lex.uz/docs/1', 'https://lex.uz/docs/2'})
        first = maintenance.begin(1795449600)
        self.assertEqual(maintenance.begin(1795449600 + DAY), first)
        self.assertTrue(first[2])
        self.assertTrue(edition_on_or_after('24.11.2026 12', 1795449600))

    def test_selected_edition_round_trips_through_the_production_package_reader(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            day = '2026-11-24'
            with Store(root / day) as store:
                url = 'https://lex.uz/docs/123'
                work = store.enqueue('document', url, {'source': '123'})
                raw = b'<html>test legal text</html>'
                store.commit_raw(work, raw, {'status': 200, 'sha256': digest(raw), 'observed': 1795449600})
                unit = {'ordinal': 0, 'locator': '10', 'language': 'ru', 'script': 'Cyrl', 'hierarchy': [],
                        'method': 'html', 'text': 'Проверенный текст нормы.'}
                source = {'snapshotProvisionId': work + ':0', 'sourceDocumentTitle': 'Кодекс',
                          'documentType': 'Кодекс', 'articleNumber': '10', 'articleTitle': None,
                          'hierarchy': [], 'language': 'ru', 'script': 'Cyrl', 'officialText': unit['text']}
                platform = Path(__file__).resolve().parents[2] / 'apps/platform'
                output = subprocess.run(['node', '--import', 'tsx', 'scripts/lexuz-embedding-inputs.mts'],
                                        input=json.dumps(source), encoding='utf8', capture_output=True,
                                        cwd=platform, check=True)
                entry, = json.loads(output.stdout)['chunks']
                compact, _ = checked_input(entry)
                store.prepared(work, {'source': '123', 'title': 'Кодекс', 'units': [unit], 'gaps': [],
                                      'chunks': [{**entry, 'work': work, 'locator': '10', 'method': 'html'}]}, 'config', 0)
                selected, waiting = select_rows(store, [work, 'unavailable'])
                self.assertEqual(waiting, ['unavailable'])
                pin = write_package(store, selected, waiting, root / 'addon')
            from package import PreparedPackage
            package = PreparedPackage(root / 'addon', pin)
            _, candidate, text, tokens = next(iter(package.input_rows(0)))
            self.assertEqual(candidate, compact)
            self.assertEqual(json.loads(text)['officialText'], unit['text'])
            self.assertGreater(tokens, 0)
            _, chunk, original, member = next(iter(package.membership_rows(0)))
            self.assertEqual(chunk.hex(), entry['chunk']['id'].split(':')[1])
            self.assertEqual(original.hex(), entry['inputHash'])
            self.assertEqual(member, work)
            with Store(root / day) as store:
                attachment = store.enqueue('asset', 'https://lex.uz/pdffile/123', {'source': '123'}, parent=work)
                raw = b'test scanned annex'
                store.commit_raw(attachment, raw, {'status': 200, 'sha256': digest(raw), 'observed': 1795449601})
                store.fail(attachment, 'ocr_runtime_unavailable')
                corpus, waiting = select_rows(store, [work])
                self.assertEqual(waiting, [work])
                self.assertEqual(corpus[work][1]['units'], [unit])
                self.assertEqual(corpus[work][1]['gaps'], [f'attachment:{attachment}:preparation_unavailable'])
                store.retry([attachment], 'OCR runtime restored')
                ocr = {'units': [dict(unit, method='ocr')], 'chunks': [
                    {**entry, 'method': 'ocr', 'locator': unit['locator'],
                     'chunk': {**entry['chunk'], 'snapshotProvisionId': attachment + ':0'}},
                ]}
                store.prepared(attachment, {**ocr, 'gaps': ['page:2:ocr_unavailable']}, 'config', 0)
                self.assertEqual(store.get(attachment)['state'], 'blocked')
                partial, waiting = select_rows(store, [work])
                self.assertEqual(waiting, [work])
                self.assertEqual(partial[work][1]['units'][1]['text'], unit['text'])
                self.assertEqual(partial[work][1]['gaps'], [f'attachment:{attachment}:page:2:ocr_unavailable'])
            journal = sqlite3.connect(':memory:')
            self.addCleanup(journal.close)
            SourceObservations(journal)
            journal.execute('INSERT INTO runs(day,started,catchup,completed) VALUES (?,?,?,?)', (day, 1, 1, 2))
            journal.execute('INSERT INTO changed_works VALUES (?,?)', (day, work))
            unresolved = []
            candidate = dict(cumulative_works(root, journal, unresolved))
            partial_pin = write_package(None, candidate, unresolved, root / 'partial', {'build_id': 'partial'})
            partial_package = PreparedPackage(root / 'partial', partial_pin)
            self.assertEqual(partial_package.handoff['unresolved_works'], [work])
            documents = [record for _, record in partial_package.records('prepared', 0) if record['work'] == work]
            self.assertEqual(documents[0]['units'][1]['text'], unit['text'])
            self.assertEqual(documents[0]['gaps'], partial[work][1]['gaps'])
            self.assertEqual(len(list(partial_package.membership_rows(0))), 2)
            with Store(root / day) as store:
                store.retry([attachment], 'OCR coverage restored')
                store.prepared(attachment, ocr, 'config', 0)
                corpus, waiting = select_rows(store, [work])
                self.assertFalse(waiting)
                projected = corpus[work][1]
                self.assertEqual(projected['units'][1]['attachmentOrigin']['sha256'], digest(raw))
                self.assertEqual(checked_input(projected['chunks'][1])[0], compact)
                self.assertEqual(projected['chunks'][1]['chunk']['snapshotProvisionId'], work + ':1')
                self.assertEqual(corpus[attachment][1]['chunks'], [])
