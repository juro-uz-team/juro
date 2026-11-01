"""Private loopback transport with bounded, thread-owned request readers.

The default serves serially. An explicitly supplied reader factory permits a
bounded pool while retaining SQLite thread ownership. Deployment chooses the
pool size only after concurrency qualification. No request content is logged.
"""
import hmac
import json
import re
import queue
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from cancellation import disconnect_cancellation

MAX_REQUEST_BYTES = 128 * 1024
MAX_RESPONSE_BYTES = 64 * 1024 * 1024


class _CatalogRequestQueue(queue.Queue):
    """Let short evidence reads pass queued searches, with bounded overtaking.

    Queue owns these sockets until dequeue, so a nonblocking peek cannot race
    their HTTP readers. It consumes no bytes and never waits for a slow sender.
    The request line is only a scheduling hint: normal HTTP parsing, bearer
    authentication and all request validation still run on the owning reader.
    After two catalog dispatches, dispatch the oldest request unconditionally.
    """
    def __init__(self,maxsize):
        super().__init__(maxsize);self.catalog_burst=0

    @staticmethod
    def is_catalog(item):
        if item is None:return False
        connection=item[0]
        try:
            timeout=connection.gettimeout()
            try:
                connection.setblocking(False)
                prefix=connection.recv(64,socket.MSG_PEEK)
            finally:connection.settimeout(timeout)
        except (OSError,ValueError):return False
        return prefix.startswith(tuple(b'POST '+path+b' HTTP/'+version+b'\r\n'
                                       for path in (b'/read-exact',b'/read-sources',b'/locate-sources') for version in (b'1.1',b'1.0')))

    def _get(self):
        position=0
        if self.catalog_burst<2:
            for index,item in enumerate(self.queue):
                if item is None:break
                if self.is_catalog(item):position=index;break
        item=self.queue[position];del self.queue[position]
        self.catalog_burst=min(2,self.catalog_burst+1) if self.is_catalog(item) else 0
        return item


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_json_key')
        result[key] = value
    return result


def create_numeric_http_server(service, token, port=0, *, manifest_sha256, service_factory=None, workers=1,
                               max_pending=8):
    if (not isinstance(token, str) or not token.isascii() or not 32 <= len(token) <= 256
            or any(not 33 <= ord(char) <= 126 for char in token)
            or type(port) is not int or not 0 <= port <= 65535
            or not isinstance(manifest_sha256, str) or not re.fullmatch('[a-f0-9]{64}', manifest_sha256)
            or type(workers) is not int or not 1<=workers<=4
            or type(max_pending) is not int or not 1<=max_pending<=32
            or (workers>1 and not callable(service_factory))
            or (service_factory is not None and not callable(service_factory))):
        raise ValueError('numeric_transport_configuration_invalid')

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.started_at=time.monotonic()
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *_):
            pass

        def reply(self, status, body, *, encoded=False):
            if encoded and not isinstance(body,bytes):raise ValueError('numeric_transport_encoded_response_invalid')
            raw = body if encoded else json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()
            if len(raw) > MAX_RESPONSE_BYTES:
                status, raw = ((413, b'{"error":"catalog_page_required"}') if self.path == '/read-exact'
                               else (503, b'{"error":"unavailable"}'))
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Juro-Worker-Sha256', manifest_sha256)
            # Durations only: no query, source identity or authentication data.
            # Service includes parsing/encoding, but excludes socket queueing
            # and response transfer. Neither value changes evidence admission.
            self.send_header('Server-Timing',f'queue;dur={self.server.request_wait_ms():.3f}, '
                             f'service;dur={(time.monotonic()-self.started_at)*1000:.3f}')
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
            owned=self.server.request_service()
            encoded=self.path=='/read-exact' and callable(getattr(owned,'read_exact_encoded',None))
            operation = {'/search': owned.search, '/read-exact': owned.read_exact_encoded if encoded else owned.read_exact,
                         '/read-sources':getattr(owned,'read_sources',None),
                         '/read-asset':getattr(owned,'read_asset',None),
                         '/locate-sources':getattr(owned,'locate_sources',None)}.get(self.path)
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
                    self.reply(200, operation(request),encoded=encoded)
            except Exception as error:
                if (self.path == '/read-exact' and isinstance(error, ValueError)
                        and str(error) in {'prepared_hydration_byte_bound', 'discovery_input_byte_bound',
                                           'discovery_catalog_response_bound'}):
                    self.reply(413, {'error': 'catalog_page_required'})
                    return
                # Reader corruption, invalid generation and deadline failures
                # all withhold the result. Never echo exception/query contents.
                self.reply(503, {'error': 'unavailable'})

    class Server(HTTPServer):
        def request_service(self):return service
        def request_wait_ms(self):return 0.0

        def handle_error(self, *_):
            pass

    if service_factory is None:return Server(('127.0.0.1', port), Handler)

    def reject_overload(request):
        # Consume a bounded ordinary request before closing: clients often send
        # headers and body separately, and an early close can hide the 503 behind
        # a write-side reset. Slow/malformed clients still lose their connection.
        # One absolute deadline bounds the accept-loop pause, including drips.
        deadline = time.monotonic()+.1
        received = bytearray()
        expected = None
        while expected is None or len(received) < expected:
            remaining = deadline-time.monotonic()
            if remaining <= 0:
                return
            request.settimeout(remaining)
            block = request.recv(min(4096, expected-len(received)) if expected is not None else 4096)
            if not block:
                return
            received.extend(block)
            if expected is None:
                boundary = received.find(b'\r\n\r\n')
                if boundary < 0:
                    if len(received) > 65536:
                        return
                    continue
                headers = received[:boundary].split(b'\r\n')[1:]
                lengths = [line.split(b':', 1)[1].strip() for line in headers
                           if line.lower().startswith(b'content-length:')]
                if (boundary > 65536 or len(lengths) != 1 or not lengths[0].isdigit()
                        or len(lengths[0]) > 8 or int(lengths[0]) > MAX_REQUEST_BYTES
                        or any(line.lower().startswith(b'transfer-encoding:') for line in headers)):
                    return
                expected = boundary+4+int(lengths[0])
        request.settimeout(max(.001, deadline-time.monotonic()))
        request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')

    class PoolServer(Server):
        """Bounded persistent owners; each factory opens/closes its own readers."""
        def __init__(self,*args):
            self.pending=_CatalogRequestQueue(max_pending)
            self.local=threading.local();self.threads=[];self.closed=False
            super().__init__(*args)
            ready=queue.Queue()
            def run():
                announced=False
                try:
                    with service_factory() as owned:
                        self.local.service=owned;ready.put(True);announced=True
                        while True:
                            item=self.pending.get()
                            try:
                                if item is None:return
                                request,address,enqueued_at=item
                                self.local.wait_ms=(time.monotonic()-enqueued_at)*1000
                                try:self.finish_request(request,address)
                                except Exception:self.handle_error(request,address)
                                finally:self.shutdown_request(request)
                            finally:self.pending.task_done()
                except BaseException:
                    if not announced:ready.put(False)
            for _ in range(workers):
                thread=threading.Thread(target=run,name='prepared-http-reader')
                thread.start();self.threads.append(thread)
            admitted=[ready.get() for _ in range(workers)]
            if not all(admitted):
                self.server_close()
                raise ValueError('numeric_transport_reader_unavailable')

        def request_service(self):return self.local.service
        def request_wait_ms(self):return self.local.wait_ms

        def process_request(self,request,address):
            try:self.pending.put_nowait((request,address,time.monotonic()))
            except queue.Full:
                # Do not create unbounded request threads or retain query bodies.
                try:
                    reject_overload(request)
                except OSError:pass
                finally:self.shutdown_request(request)

        def server_close(self):
            if self.closed:return
            self.closed=True
            super().server_close()
            for thread in self.threads:
                if thread.is_alive():self.pending.put(None)
            for thread in self.threads:thread.join()

    return PoolServer(('127.0.0.1', port), Handler)
