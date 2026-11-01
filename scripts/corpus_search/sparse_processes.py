"""Bounded sparse readers forked from an admitted, single-threaded owner.

The owner retains its native library and read-only metadata mapping. Children
inherit those pages, open their own SQLite cursors and allocate private scores.
No artifacts, query results or applicability decisions are cached across calls.
"""
import copy
from contextlib import contextmanager
import multiprocessing
import os
import pathlib
import queue
import sqlite3
import time


def _serve(index, scorer, position, pipes, cancelled, parent_pid):
    connection = pipes[position][1]
    for _, (parent, child) in enumerate(pipes):
        parent.close()
        if child is not connection:
            child.close()
    local = copy.copy(index)
    local.run = copy.copy(index.run)
    local.run.connection = sqlite3.connect(
        (local.run.root / 'lexicon.sqlite').as_uri() + '?mode=ro&immutable=1', uri=True)
    local.run.connection.execute('PRAGMA query_only=ON')

    def check():
        if cancelled.is_set() or os.getppid() != parent_pid:
            raise InterruptedError('sparse_process_cancelled')

    try:
        connection.send(('ready', None))
        while os.getppid() == parent_pid:
            if not connection.poll(.1):
                continue
            request = connection.recv()
            if request is None:
                return
            terms, limit = request
            try:
                check()
                local.assert_unchanged()
                result = scorer.search(local, terms, limit, check)
                check()
                connection.send(('result', result))
            except Exception as error:
                # Never send source excerpts, paths or connection details.
                connection.send(('error', type(error).__name__))
    except (EOFError, BrokenPipeError):
        pass
    finally:
        local.run.connection.close()
        connection.close()


class SparseProcessPool:
    def __init__(self, index, workers):
        if type(workers) is not int or not 1 <= workers <= 4 or index.native is None:
            raise ValueError('sparse_process_configuration_invalid')
        if not pathlib.Path('/proc/self/task').is_dir() or len(os.listdir('/proc/self/task')) != 1:
            raise RuntimeError('sparse_process_requires_single_thread')
        index.assert_unchanged()
        context = multiprocessing.get_context('fork')
        self.processes = []
        self.closed = False
        self.available = queue.Queue(maxsize=workers)
        self.pipes = [context.Pipe() for _ in range(workers)]
        self.cancelled = [context.Event() for _ in range(workers)]
        try:
            for position in range(workers):
                process = context.Process(target=_serve,
                    args=(index, index.native, position, self.pipes, self.cancelled[position], os.getpid()),
                    name='prepared-sparse-reader', daemon=True)
                process.start()
                self.processes.append(process)
            for position, (parent, child) in enumerate(self.pipes):
                child.close()
                if not parent.poll(5) or parent.recv() != ('ready', None):
                    raise RuntimeError('sparse_process_unavailable')
                self.available.put_nowait(position)
        except BaseException:
            self.close()
            raise

    def _drain(self, position):
        self.cancelled[position].set()
        connection = self.pipes[position][0]
        process = self.processes[position]
        until = time.monotonic() + 2
        while process.is_alive() and time.monotonic() < until:
            if connection.poll(.05):
                try:
                    connection.recv()
                except (EOFError, OSError):
                    pass
                return
        if process.is_alive():
            process.terminate()
        process.join(timeout=2)

    def search(self, index, terms, limit, check):
        while True:
            check()
            if self.closed:
                raise RuntimeError('sparse_process_unavailable')
            try:
                position = self.available.get(timeout=.05)
                break
            except queue.Empty:
                continue
        pending = False
        try:
            check()
            process = self.processes[position]
            if self.closed or not process.is_alive():
                raise RuntimeError('sparse_process_unavailable')
            connection = self.pipes[position][0]
            self.cancelled[position].clear()
            connection.send((terms, limit))
            pending = True
            while not connection.poll(.05):
                check()
                if not process.is_alive():
                    raise RuntimeError('sparse_process_unavailable')
            kind, result = connection.recv()
            pending = False
            check()
            index.assert_unchanged()
            if kind == 'result':
                return result
            if kind == 'error' and result == 'ValueError':
                raise ValueError('sparse_process_query_invalid')
            raise RuntimeError('sparse_process_unavailable')
        except (EOFError, BrokenPipeError) as error:
            raise RuntimeError('sparse_process_unavailable') from error
        finally:
            if pending:
                self._drain(position)
            self.available.put_nowait(position)

    def close(self):
        if self.closed:
            return
        self.closed = True
        for event in self.cancelled:
            event.set()
        for parent, child in self.pipes:
            try:
                parent.send(None)
            except (OSError, EOFError):
                pass
            child.close()
        for process in self.processes:
            process.join(timeout=2)
            if process.is_alive():
                process.terminate()
                process.join(timeout=2)
        for parent, _ in self.pipes:
            parent.close()


@contextmanager
def isolated_sparse(index, *, workers):
    original = index.native
    pool = SparseProcessPool(index, workers)
    index.native = pool
    try:
        yield pool
    finally:
        index.native = original
        pool.close()
