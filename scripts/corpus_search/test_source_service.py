import unittest
import tempfile
import pathlib
from unittest.mock import patch
from works import WorkIndex, build_work_index
from test_discovery_catalog import Fixture
from source_service import PreparedSourceService


class SourceServiceTests(unittest.TestCase):
    def test_stored_inventory_reference_can_load_an_undiscovered_source(self):
        from types import SimpleNamespace
        from source_references import SourceReferences
        from test_source_references import Package, row
        package = Package([row()])
        references = SourceReferences(package)
        works = SimpleNamespace(manifest_sha256='f' * 64,
                                lookup=lambda keys: [{'work': 'a' * 64, 'inventory': {}, 'prepared': {}} for _ in keys])
        artifacts = {key: 'a' * 64 for key in PreparedSourceService.ARTIFACTS}
        artifacts.update(packageSha256=package.sha256, workIndexSha256=works.manifest_sha256)
        service = PreparedSourceService(package, works, artifacts, source_references=references)
        with patch.object(service, 'read_records', side_effect=lambda kind, *_: [row()] if kind == 'inventory'
                          else [{'work': 'a' * 64, 'units': [{'text': 'Complete artificial referenced rule.'}]}]) as reads:
            packet = service.read_sources({'artifacts': artifacts, 'reference': {
                'url': 'https://lex.uz/docs/123', 'scope': {'kind': 'current'}}})
            self.assertEqual(packet['reference_status'], 'unique')
            self.assertEqual(packet['sources']['a' * 64]['prepared']['units'][0]['text'], 'Complete artificial referenced rule.')
            self.assertNotIn('current_capture', packet['sources']['a' * 64])
            self.assertEqual(reads.call_count, 2)
            missing = service.read_sources({'artifacts': artifacts, 'reference': {
                'url': 'https://lex.uz/docs/999', 'scope': {'kind': 'current'}}})
            self.assertEqual(missing['reference_status'], 'missing')
            self.assertEqual(missing['sources'], {})
            self.assertEqual(reads.call_count, 2)
            with self.assertRaisesRegex(ValueError, 'generation'):
                service.read_sources({'artifacts': {}, 'reference': {'url': 'https://lex.uz/docs/123', 'scope': {'kind': 'current'}}})

    def test_source_service_does_not_expose_asset_acquisition(self):
        self.assertIsNone(PreparedSourceService.read_asset)

    def test_complete_source_reads_do_not_require_search_or_vector_readers(self):
        fixture = Fixture()
        fixture.prepared[0]['units'].append({'ordinal': 99, 'text': 'Complete exception outside every indexed passage.'})
        fixture.prepared[0]['tables'] = [{'rows': [['An unindexed table condition.']]}]
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory) / 'works'
            pin = build_work_index(fixture, root)
            with self.open_index(root, pin, fixture.sha256) as works:
                artifacts = {key: 'a' * 64 for key in PreparedSourceService.ARTIFACTS}
                artifacts.update(packageSha256=fixture.sha256, workIndexSha256=pin)
                service = PreparedSourceService(fixture, works, artifacts)
                packet = service.read_sources({'artifacts': artifacts, 'works': ['work:0']})
                self.assertEqual(packet['sources']['work:0']['prepared'], fixture.prepared[0])
                self.assertEqual(packet['sources']['work:0']['inventory']['id'], 'work:0')
                self.assertEqual(packet['package_sha256'], fixture.sha256)
                with self.assertRaisesRegex(ValueError, 'generation'):
                    service.read_sources({'artifacts': {**artifacts, 'packageSha256': 'b' * 64}, 'works': ['work:0']})
                with self.assertRaisesRegex(ValueError, 'request'):
                    service.read_sources({'artifacts': artifacts, 'works': ['work:0'], 'truncate': True})
                with self.assertRaisesRegex(ValueError, 'bound'):
                    service.read_sources({'artifacts': artifacts, 'works': ['work:0'] * 2})
                self.check_http(service, artifacts)

    def check_http(self, service, artifacts):
        import http.client
        import json
        from concurrent.futures import ThreadPoolExecutor
        from numeric_http import create_numeric_http_server
        server = create_numeric_http_server(service, 't' * 32, manifest_sha256='f' * 64)
        def request(token):
            connection = http.client.HTTPConnection(*server.server_address, timeout=3)
            try:
                connection.request('POST', '/read-sources', json.dumps({'artifacts': artifacts, 'works': ['work:0']}),
                    {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
                response = connection.getresponse()
                return response.status, response.getheader('X-Juro-Worker-Sha256'), json.loads(response.read())
            finally:
                connection.close()
        try:
            with ThreadPoolExecutor(max_workers=1) as client:
                for token, status in [('wrong', 401), ('t' * 32, 200)]:
                    pending = client.submit(request, token)
                    server.handle_request()
                    actual, identity, body = pending.result()
                    self.assertEqual(actual, status)
                    self.assertEqual(identity, 'f' * 64)
                    if status == 200:self.assertIn('work:0', body['sources'])
        finally:
            server.server_close()

    @staticmethod
    def open_index(root, pin, package_pin):
        from contextlib import closing
        return closing(WorkIndex(root, pin, package_pin))


if __name__ == '__main__':
    unittest.main()
