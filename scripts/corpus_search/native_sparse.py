"""Exact scalar BM25 in bounded native calls over authenticated posting blocks.

Metadata is projected once from the admitted read-only SQLite snapshot into an
anonymous temporary file. It cannot be supplied by a caller or reused across
generations. Both the source and every requested posting block remain verified.
The worker owns one request at a time; its score buffer is never shared.
"""
import ctypes
from contextlib import ExitStack
import _ctypes
import math
import sys
import tempfile

import numpy as np

from sparse_postings import MAX_INTEGER

U64 = ctypes.POINTER(ctypes.c_uint64)
F64 = ctypes.POINTER(ctypes.c_double)
WEIGHTS = (2, 1.5, 1.5, 1)


class NativeSparseScorer:
    def __init__(self, index, library_path):
        self.library = self.file = self.metadata = None
        if sys.byteorder != 'little':
            raise ValueError('sparse_kernel_byte_order_unsupported')
        self.count = index.manifest['profiles']
        if not 0 < self.count <= (2 * 1024**3) // 64:
            raise ValueError('sparse_kernel_capacity_exceeded')
        writable = None
        try:
            self.library = ctypes.CDLL(str(library_path))
            self.library.sparse_kernel_version.argtypes = []
            self.library.sparse_kernel_version.restype = ctypes.c_int
            if self.library.sparse_kernel_version() != 1:
                raise ValueError('sparse_kernel_version_mismatch')
            self.library.accumulate.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint64,
                ctypes.c_uint64, U64, ctypes.c_uint64, F64, F64, F64,
                ctypes.POINTER(ctypes.c_int64), ctypes.c_int]
            self.library.accumulate.restype = ctypes.c_int
            self.library.select_best.argtypes = [F64, ctypes.c_uint64, ctypes.c_uint64,
                                                 U64, F64, ctypes.c_size_t, ctypes.c_size_t]
            self.library.select_best.restype = ctypes.c_size_t
            # Explicitly bounded per worker: 1.25 GB metadata for the current corpus,
            # plus 178 MB of private scores during a request. Larger corpora require
            # a new capacity qualification rather than unbounded allocation.
            self.file = tempfile.TemporaryFile()
            self.file.truncate(self.count * 7 * 8)
            writable = np.memmap(self.file, mode='r+', dtype='<u8', shape=(self.count, 7))
            index.assert_unchanged()
            cursor = index.connection.execute('SELECT ordinal,vector,first_membership,members,title,hierarchy,article,text FROM profiles ORDER BY ordinal')
            offset = 0
            while rows := cursor.fetchmany(16384):
                if (offset + len(rows) > self.count
                        or any(len(row) != 8 or row[0] != offset + position
                               or any(type(value) is not int or not 0 <= value <= MAX_INTEGER for value in row)
                               or row[3] < 1 for position, row in enumerate(rows))):
                    raise ValueError('sparse_query_profile_invalid')
                writable[offset:offset + len(rows)] = np.asarray(rows, dtype=np.uint64)[:, 1:]
                offset += len(rows)
            if offset != self.count:
                raise ValueError('sparse_query_profile_invalid')
            index.assert_unchanged()
            writable.flush()
            writable._mmap.close()
            writable = None
            self.metadata = np.memmap(self.file, mode='r', dtype='<u8', shape=(self.count, 7))
        except BaseException:
            try:
                if writable is not None:
                    writable._mmap.close()
            finally:
                self.close()
            raise

    def search(self, index, terms, limit, check):
        check()
        scores = np.full(self.count, -1., dtype=np.float64)
        averages = np.asarray([max(1, value) for value in index.averages], dtype=np.float64)
        metadata_pointer = self.metadata.ctypes.data_as(U64)
        scores_pointer = scores.ctypes.data_as(F64)
        averages_pointer = averages.ctypes.data_as(F64)
        compensated = int(sys.version_info >= (3, 12))
        for term in sorted(set(terms)):
            check()
            df, stream = index.run.term_blocks(term, check)
            if not 0 <= df <= index.manifest['members']:
                raise ValueError('sparse_query_frequency_invalid')
            idf = math.log(1 + (index.manifest['members'] - df + .5) / (df + .5))
            coefficients = np.asarray([weight * idf for weight in WEIGHTS], dtype=np.float64)
            last = ctypes.c_int64(-1)
            coefficients_pointer = coefficients.ctypes.data_as(F64)
            last_pointer = ctypes.byref(last)
            iterator = iter(stream)
            try:
                for raw, rows, frequency in iterator:
                    status = self.library.accumulate(raw, len(raw), rows, frequency,
                        metadata_pointer, self.count, averages_pointer,
                        coefficients_pointer, scores_pointer, last_pointer, compensated)
                    if status:
                        raise ValueError('sparse_native_posting_invalid')
            finally:
                iterator.close()
            if not stream.verified:
                raise ValueError('sparse_query_incomplete')
        ids = np.zeros(limit, dtype=np.uint64)
        best = np.zeros(limit, dtype=np.float64)
        ids_pointer = ids.ctypes.data_as(U64)
        best_pointer = best.ctypes.data_as(F64)
        filled = 0
        # Bound cancellation latency independently of corpus population.
        for start in range(0, self.count, 65536):
            check()
            filled = self.library.select_best(scores_pointer, min(start + 65536, self.count),
                start, ids_pointer, best_pointer, limit, filled)
        check()
        index.assert_unchanged()
        return [{'profile_ordinal': int(ordinal), 'vector_ordinal': int(self.metadata[ordinal, 0]),
                 'membership_ordinal': int(self.metadata[ordinal, 1]), 'score': float(score)}
                for ordinal, score in zip(ids[:filled], best[:filled])]

    def close(self):
        # Detach ownership first: partial construction and repeated cleanup must
        # never close a mapping or unload a library twice. ExitStack still
        # releases the other resources if any individual close raises.
        metadata, file, library = self.metadata, self.file, self.library
        self.metadata = self.file = self.library = None
        with ExitStack() as cleanup:
            if library is not None:
                unload = _ctypes.FreeLibrary if sys.platform == 'win32' else _ctypes.dlclose
                cleanup.callback(unload, library._handle)
            if file is not None:
                cleanup.callback(file.close)
            if metadata is not None:
                cleanup.callback(metadata._mmap.close)
