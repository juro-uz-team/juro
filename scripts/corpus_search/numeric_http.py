"""Private loopback transport; initialize readers on the serving thread.

One process serves one request at a time because its authenticated SQLite
readers belong to that thread. Deployment chooses worker count only after
concurrency qualification. No request content, tokens or errors are logged.
"""
import hmac
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from cancellation import disconnect_cancellation

MAX_REQUEST_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 64 * 1024 * 1024


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_json_key')
        result[key] = value
    return result


def create_numeric_http_server(service, token, port=0, *, manifest_sha256):
    if (not isinstance(token, str) or not token.isascii() or not 32 <= len(token) <= 256
            or any(not 33 <= ord(char) <= 126 for char in token)
            or type(port) is not int or not 0 <= port <= 65535
            or not isinstance(manifest_sha256, str) or not re.fullmatch('[a-f0-9]{64}', manifest_sha256)):
        raise ValueError('numeric_transport_configuration_invalid')

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *_):
            pass

        def reply(self, status, body):
            raw = json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
            if len(raw) > MAX_RESPONSE_BYTES:
                status, raw = 503, b'{"error":"unavailable"}'
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Juro-Worker-Sha256', manifest_sha256)
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            self.close_connection = True
            supplied = self.headers.get_all('Authorization', [])
            if len(supplied) != 1 or not hmac.compare_digest(supplied[0].encode(), ('Bearer '+token).encode()):
                self.reply(401, {'error': 'unauthorized'})
                return
            operation = {'/search': service.search, '/read-exact': service.read_exact}.get(self.path)
            if operation is None:
                self.reply(404, {'error': 'not_found'})
                return
            lengths = self.headers.get_all('Content-Length', [])
            if (len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit()
                    or len(lengths[0]) > 8 or not 0 < int(lengths[0]) <= MAX_REQUEST_BYTES
                    or self.headers.get('Transfer-Encoding') or self.headers.get('Content-Encoding')
                    or self.headers.get('Content-Type') != 'application/json'):
                self.reply(400, {'error': 'invalid_request'})
                return
            try:
                raw = self.rfile.read(int(lengths[0]))
                if len(raw) != int(lengths[0]):
                    raise ValueError('truncated_request')
                def invalid_constant(_):
                    raise ValueError('nonfinite_json')
                request = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object, parse_constant=invalid_constant)
            except (ValueError, UnicodeError, TimeoutError, RecursionError):
                self.reply(400, {'error': 'invalid_request'})
                return
            try:
                with disconnect_cancellation(self.connection):
                    self.reply(200, operation(request))
            except Exception:
                # Reader corruption, invalid generation and deadline failures
                # all withhold the result. Never echo exception/query contents.
                self.reply(503, {'error': 'unavailable'})

    class Server(HTTPServer):
        def handle_error(self, *_):
            pass

    return Server(('127.0.0.1', port), Handler)
