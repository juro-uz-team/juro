"""Resident sign-prefix candidates derived from authenticated original vectors.

This index does not replace original coordinates or qualify its own recall.
Publication preserves global ordinals. A separately qualified candidate budget
must be paired with DenseSearch's original-coordinate reranking. The resident
allocation is bounded per reader; worker concurrency needs capacity qualification.
"""
import _ctypes
import ctypes
import hashlib
import json
import os
import pathlib
import shutil
import sys
import tempfile

import numpy as np

from cancellation import check_cancelled
from membership import sync_directory
from package import file_hash
from prepared import canonical
from works import signature

FORMAT = 'prepared-binary-navigation-v1'
PREFIX_BITS = 2048
SUPPORTED_PREFIX_BITS = (2048, 2560, 3072)
CAPACITY = 6 * 1024**3
BLOCK_ROWS = 65536


def publish(vectors, output, *, prefix_bits=PREFIX_BITS, reserve_bytes=8*1024**3):
    """Consume all admitted originals, then atomically publish one new index."""
    if type(prefix_bits) is not int or prefix_bits not in SUPPORTED_PREFIX_BITS:
        raise ValueError('binary_navigation_prefix_invalid')
    width = prefix_bits // 8
    if not vectors.ready or type(vectors.count) is not int or not 0 < vectors.count * width <= CAPACITY:
        raise ValueError('binary_navigation_source_invalid')
    if type(reserve_bytes) is not int or reserve_bytes < 0:
        raise ValueError('binary_navigation_reserve_invalid')
    output = pathlib.Path(output).absolute()
    if output.exists():
        raise ValueError('binary_navigation_output_exists')
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = pathlib.Path(tempfile.mkdtemp(prefix=output.name+'.partial-', dir=output.parent))
    digest = hashlib.sha256()
    vectors.assert_unchanged()
    with (staging / 'vectors.bin').open('xb') as target:
        for start in range(0, vectors.count, 1024):
            check_cancelled()
            count = min(1024, vectors.count-start)
            original = np.asarray(vectors.read(list(range(start, start+count))), dtype=np.float32)
            if original.shape != (count, 3072) or not np.isfinite(original).all():
                raise ValueError('binary_navigation_original_invalid')
            raw = np.packbits(original[:, :prefix_bits] > 0, axis=1, bitorder='big').tobytes()
            if shutil.disk_usage(staging).free < len(raw)+reserve_bytes:
                raise ValueError('binary_navigation_disk_reserve')
            target.write(raw)
            digest.update(raw)
        target.flush()
        os.fsync(target.fileno())
    check_cancelled()
    vectors.assert_unchanged()
    manifest = {'format': FORMAT, 'completion_sha256': vectors.completion_sha256,
                'dimensions': 3072, 'prefix_bits': prefix_bits, 'vectors': vectors.count,
                'metric': 'hamming', 'encoding': 'positive-sign-msb-first',
                'tie_break': 'ascending-global-ordinal', 'bytes': vectors.count*width,
                'sha256': digest.hexdigest()}
    raw = canonical(manifest)
    with (staging / 'manifest.json').open('xb') as target:
        target.write(raw)
        target.flush()
        os.fsync(target.fileno())
    sync_directory(staging)
    os.rename(staging, output)
    sync_directory(output.parent)
    return hashlib.sha256(raw).hexdigest()


class BinaryNavigation:
    def __init__(self, root, manifest_sha256, completion_sha256, kernel_path, kernel_sha256, *, prefix_bits=None):
        self.values = self.library = None
        try:
            self.root = pathlib.Path(root).resolve(strict=True)
            path = self.root / 'manifest.json'
            if path.is_symlink() or path.stat().st_size > 4096:
                raise ValueError('binary_navigation_manifest_invalid')
            before = signature(path)
            raw = path.read_bytes()
            if signature(path) != before or hashlib.sha256(raw).hexdigest() != manifest_sha256:
                raise ValueError('binary_navigation_manifest_mismatch')
            m = json.loads(raw)
            if (not isinstance(m, dict) or type(m.get('prefix_bits')) is not int
                    or m['prefix_bits'] not in SUPPORTED_PREFIX_BITS):
                raise ValueError('binary_navigation_manifest_invalid')
            stored_prefix = m['prefix_bits']
            if prefix_bits is not None and (type(prefix_bits) is not int
                    or prefix_bits not in SUPPORTED_PREFIX_BITS or prefix_bits > stored_prefix):
                raise ValueError('binary_navigation_prefix_invalid')
            self.prefix_bits = stored_prefix if prefix_bits is None else prefix_bits
            self.width = self.prefix_bits // 8
            stored_width = stored_prefix // 8
            expected = {'format': FORMAT, 'completion_sha256': completion_sha256, 'dimensions': 3072,
                        'metric': 'hamming',
                        'encoding': 'positive-sign-msb-first', 'tie_break': 'ascending-global-ordinal'}
            if (not isinstance(m, dict) or any(m.get(key) != value for key, value in expected.items())
                    or type(m.get('vectors')) is not int or not 0 < m['vectors']*self.width <= CAPACITY
                    or type(m.get('bytes')) is not int or m['bytes'] != m['vectors']*stored_width):
                raise ValueError('binary_navigation_manifest_invalid')
            self.count = m['vectors']
            self.dimensions = 3072
            self.completion_sha256 = completion_sha256
            self.manifest_sha256 = manifest_sha256
            path = self.root / 'vectors.bin'
            if path.is_symlink() or path.stat().st_size != m['bytes']:
                raise ValueError('binary_navigation_file_invalid')
            before = signature(path)
            # Hash the bytes actually loaded, not an earlier separate read.
            self.values = np.empty((self.count, self.prefix_bits//64), dtype=np.uint64)
            digest = hashlib.sha256()
            with path.open('rb') as source:
                for start in range(0, self.count, BLOCK_ROWS):
                    check_cancelled()
                    count = min(BLOCK_ROWS, self.count-start)
                    raw = source.read(count*stored_width)
                    if len(raw) != count*stored_width:
                        raise ValueError('binary_navigation_truncated')
                    digest.update(raw)
                    self.values[start:start+count] = np.frombuffer(raw, dtype=np.uint64).reshape(count, stored_prefix//64)[:, :self.prefix_bits//64]
                if source.read(1):
                    raise ValueError('binary_navigation_trailing_bytes')
            if signature(path) != before or digest.hexdigest() != m.get('sha256'):
                raise ValueError('binary_navigation_file_mismatch')
            self.values.flags.writeable = False
            path = pathlib.Path(kernel_path)
            before = signature(path)
            if path.is_symlink() or file_hash(path) != kernel_sha256:
                raise ValueError('binary_navigation_kernel_mismatch')
            self.library = ctypes.CDLL(str(path.resolve(strict=True)))
            self.library.binary_kernel_version.argtypes = []
            self.library.binary_kernel_version.restype = ctypes.c_int
            if self.library.binary_kernel_version() != 2 or signature(path) != before:
                raise ValueError('binary_navigation_kernel_mismatch')
            self.kernel_path, self.kernel_identity = path, before
            self.library.binary_distances.argtypes = [ctypes.c_void_p, ctypes.c_void_p,
                ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]
            self.library.binary_distances.restype = ctypes.c_int
            self.assert_unchanged()
        except BaseException:
            self.close()
            raise

    def assert_unchanged(self):
        # Admitted values are owned, read-only memory; source disk changes cannot
        # change an existing reader's bytes. Closed readers never return results.
        if self.values is None or self.library is None or self.values.flags.writeable:
            raise ValueError('binary_navigation_unavailable')
        if signature(self.kernel_path) != self.kernel_identity:
            raise ValueError('binary_navigation_kernel_changed')

    def search(self, query, count):
        self.assert_unchanged()
        if type(count) is not int or not 1 <= count <= min(self.count, 20000):
            raise ValueError('binary_navigation_request_bound')
        query = np.asarray(query, dtype=np.float32)
        if query.shape != (1, 3072) or not np.isfinite(query).all() or not np.any(query):
            raise ValueError('binary_navigation_query_invalid')
        bits = np.packbits(query[0, :self.prefix_bits] > 0, bitorder='big').view(np.uint64)
        scores = np.empty(self.count, dtype=np.uint16)
        histogram = np.zeros(self.prefix_bits+1, dtype=np.int64)
        for start in range(0, self.count, BLOCK_ROWS):
            check_cancelled()
            size = min(BLOCK_ROWS, self.count-start)
            if self.library.binary_distances(self.values.ctypes.data+start*self.width, bits.ctypes.data,
                    size, self.prefix_bits//64, scores.ctypes.data+start*2):
                raise ValueError('binary_navigation_kernel_failed')
            histogram += np.bincount(scores[start:start+size], minlength=self.prefix_bits+1)
        cutoff = int(np.searchsorted(np.cumsum(histogram), count))
        ids = np.empty(count, dtype=np.uint64)
        filled = 0
        for equal in (False, True):
            for start in range(0, self.count, BLOCK_ROWS):
                check_cancelled()
                block = scores[start:start+BLOCK_ROWS]
                found = np.flatnonzero(block == cutoff if equal else block < cutoff)[:count-filled]
                ids[filled:filled+len(found)] = found+start
                filled += len(found)
                if filled == count:
                    break
        check_cancelled()
        if filled != count:
            raise ValueError('binary_navigation_selection_incomplete')
        # Candidate order is deterministic too, although DenseSearch uses only
        # the set and applies its own original-cosine ordering.
        order = np.lexsort((ids, scores[ids]))
        ids = ids[order]
        self.assert_unchanged()
        return scores[ids].reshape(1, count), ids.reshape(1, count)

    def close(self):
        library, self.library = self.library, None
        self.values = None
        if library is not None:
            unload = _ctypes.FreeLibrary if sys.platform == 'win32' else _ctypes.dlclose
            unload(library._handle)
