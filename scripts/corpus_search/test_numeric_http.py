import http.client
import json
import threading
import unittest
from types import SimpleNamespace

from numeric_http import create_numeric_http_server


class NumericHttpTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def search(value):
            self.calls.append(value)
            if value.get('fail'):
                raise ValueError('private formulation')
            return {'hits': value}
        self.server = create_numeric_http_server(SimpleNamespace(search=search, read_exact=search), 't'*32)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, raw, token='t'*32, path='/search'):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request('POST', path, raw, {'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_real_loopback_authentication_and_both_operations(self):
        self.assertEqual(self.server.server_address[0], '127.0.0.1')
        self.assertEqual(self.request('{"id":1}'), (200, {'hits': {'id': 1}}))
        self.assertEqual(self.request('{"id":2}', path='/read-exact'), (200, {'hits': {'id': 2}}))
        self.assertEqual(self.request('', token='wrong')[0], 401)
        self.assertEqual(self.calls, [{'id': 1}, {'id': 2}])

    def test_malformed_requests_and_private_errors_are_not_echoed(self):
        for raw in ['{"id":1,"id":2}', '{"id":NaN}', '{']:
            self.assertEqual(self.request(raw), (400, {'error': 'invalid_request'}))
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request('POST', '/search', b'', {'Authorization': 'Bearer '+'t'*32,
                'Content-Type': 'application/json', 'Content-Length': '131073'})
            response = connection.getresponse()
            self.assertEqual(response.status, 400)
            response.read()
        finally:
            connection.close()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.request('{"fail":true}'), (503, {'error': 'unavailable'}))


if __name__ == '__main__':
    unittest.main()
