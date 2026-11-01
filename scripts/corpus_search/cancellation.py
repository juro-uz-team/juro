"""Propagate private HTTP client disconnects without imposing a time budget."""
from contextlib import contextmanager
from contextvars import ContextVar
import selectors
import socket
import threading

_current = ContextVar('prepared_search_cancellation', default=None)


class Cancellation:
    def __init__(self):
        self.cancelled = threading.Event()
        self.lock = threading.Lock()
        self.callbacks = set()

    def check(self):
        if self.cancelled.is_set():
            raise InterruptedError('prepared_request_cancelled')

    def cancel(self):
        with self.lock:
            self.cancelled.set()
            callbacks = tuple(self.callbacks)
        for callback in callbacks:
            try:
                callback()
            except Exception:
                # A query may already have finished or closed its connection.
                pass


def check_cancelled():
    scope = _current.get()
    if scope is not None:
        scope.check()


@contextmanager
def cancel_connection(connection):
    scope = _current.get()
    callback = connection.cancel if scope is not None else None
    if scope is not None:
        with scope.lock:
            scope.check()
            scope.callbacks.add(callback)
    try:
        yield
    finally:
        if scope is not None:
            with scope.lock:
                scope.callbacks.discard(callback)


@contextmanager
def disconnect_cancellation(connection):
    """The serving thread retains ownership of SQLite and PostgreSQL readers."""
    scope = Cancellation()
    stopped = threading.Event()
    token = _current.set(scope)

    def watch():
        try:
            # Admitted corpus readers may hold more than FD_SETSIZE files.
            # The platform selector supports those sockets without weakening
            # disconnect cancellation or imposing a request time limit.
            with selectors.DefaultSelector() as selector:
                selector.register(connection,selectors.EVENT_READ)
                while not stopped.is_set():
                    if selector.select(.1) and not connection.recv(1,socket.MSG_PEEK):
                        scope.cancel()
                        break
                    stopped.wait(.1)
        except (OSError,ValueError):
            # A closed socket or failed registration cannot leave work orphaned.
            scope.cancel()

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    try:
        yield
    finally:
        stopped.set()
        watcher.join(timeout=1)
        _current.reset(token)
