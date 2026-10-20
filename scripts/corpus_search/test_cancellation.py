import socket
import threading
import time
import unittest
from cancellation import cancel_connection, check_cancelled, disconnect_cancellation


class CancellationTests(unittest.TestCase):
    def test_disconnect_cancels_database_and_cooperative_work(self):
        server, client = socket.socketpair()
        cancelled = threading.Event()

        class Connection:
            def cancel(self):
                cancelled.set()

        try:
            with disconnect_cancellation(server), cancel_connection(Connection()):
                check_cancelled()
                client.close()
                self.assertTrue(cancelled.wait(2))
                with self.assertRaises(InterruptedError):
                    check_cancelled()
            # Cancellation is request scoped, never retained by the next caller.
            check_cancelled()
        finally:
            server.close()
            client.close()

    def test_disconnect_before_query_registration_rejects_new_work(self):
        server, client = socket.socketpair()
        try:
            with disconnect_cancellation(server):
                client.close()
                deadline = time.monotonic() + 2
                while True:
                    try:
                        check_cancelled()
                    except InterruptedError:
                        break
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(.01)
                with self.assertRaises(InterruptedError):
                    with cancel_connection(type('Connection', (), {'cancel': lambda self: None})()):
                        self.fail('cancelled request entered database work')
        finally:
            server.close()
            client.close()

    def test_connected_request_does_not_acquire_a_time_limit(self):
        server, client = socket.socketpair()
        try:
            with disconnect_cancellation(server):
                check_cancelled()
            check_cancelled()
        finally:
            server.close()
            client.close()
