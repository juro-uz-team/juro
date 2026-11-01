"""Refine navigation candidates with a pinned projection before exact reranking.

The projection is only a disposable candidate index. DenseSearch still scores
retained candidates with all original coordinates. Recall must be qualified for
the combined upstream and projection policy before a release can use it.
"""
import hashlib
import json
import mmap
import os
import pathlib
import re
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor, wait
from contextvars import copy_context

import numpy as np

from cancellation import check_cancelled
from membership import sync_directory
from prepared import canonical
from works import signature

FORMAT = 'prepared-projected-navigation-v1'
COMPACT_FORMAT = 'prepared-projected-navigation-v2'
COMPACT_ENCODING = 'int8-per-row-maxabs-127-from-float16-round-even'
DIMENSIONS = 512
ROW_BYTES = DIMENSIONS * 2
MAX_BYTES = 32 * 1024**3
BLOCK_ROWS = 1024


def publish(vectors, output, *, reserve_bytes=12*1024**3):
    if (not vectors.ready or type(vectors.count) is not int
            or not 0 < vectors.count*ROW_BYTES <= MAX_BYTES):
        raise ValueError('projected_navigation_source_invalid')
    if type(reserve_bytes) is not int or reserve_bytes < 0:
        raise ValueError('projected_navigation_reserve_invalid')
    output = pathlib.Path(output).absolute()
    if output.exists():
        raise ValueError('projected_navigation_output_exists')
    output.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output.parent).free < vectors.count*ROW_BYTES+reserve_bytes:
        raise ValueError('projected_navigation_disk_reserve')
    staging = pathlib.Path(tempfile.mkdtemp(prefix=output.name+'.partial-', dir=output.parent))
    digest = hashlib.sha256()
    vectors.assert_unchanged()
    with (staging/'vectors.f16').open('xb') as target:
        for start in range(0, vectors.count, BLOCK_ROWS):
            check_cancelled()
            count = min(BLOCK_ROWS, vectors.count-start)
            original = np.asarray(vectors.read(list(range(start, start+count))), dtype=np.float32)
            if original.shape != (count, 3072) or not np.isfinite(original).all():
                raise ValueError('projected_navigation_original_invalid')
            with np.errstate(over='ignore', invalid='ignore'):
                projected = original[:, :DIMENSIONS].astype('<f2')
            if not np.isfinite(projected).all():
                raise ValueError('projected_navigation_projection_invalid')
            raw = projected.tobytes()
            if shutil.disk_usage(staging).free < len(raw)+reserve_bytes:
                raise ValueError('projected_navigation_disk_reserve')
            target.write(raw)
            digest.update(raw)
        target.flush()
        os.fsync(target.fileno())
    check_cancelled()
    vectors.assert_unchanged()
    manifest = {'format': FORMAT, 'completion_sha256': vectors.completion_sha256,
                'dimensions': 3072, 'prefix_dimensions': DIMENSIONS,
                'encoding': 'float16-little-endian', 'vectors': vectors.count,
                'metric': 'cosine-float64', 'zero_prefix_score': 0,
                'tie_break': 'ascending-global-ordinal',
                'bytes': vectors.count*ROW_BYTES, 'sha256': digest.hexdigest()}
    raw = canonical(manifest)
    with (staging/'manifest.json').open('xb') as target:
        target.write(raw)
        target.flush()
        os.fsync(target.fileno())
    sync_directory(staging)
    os.rename(staging, output)
    sync_directory(output.parent)
    return hashlib.sha256(raw).hexdigest()


def publish_compact(source, output, *, reserve_bytes=12*1024**3):
    """Derive bounded int8 rows from an authenticated f16 candidate index.

    A positive per-row scale cancels in cosine scoring. Zero prefixes remain
    zero; final reranking still uses the untouched original float32 vectors.
    Publication does not qualify this different candidate policy's recall.
    """
    if not isinstance(source,ProjectedNavigation) or source.encoding!='float16-little-endian':
        raise ValueError('projected_navigation_compaction_source_invalid')
    source.assert_unchanged()
    if type(reserve_bytes) is not int or reserve_bytes<0:
        raise ValueError('projected_navigation_reserve_invalid')
    output=pathlib.Path(output).absolute()
    if output.exists():raise ValueError('projected_navigation_output_exists')
    output.parent.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(output.parent).free<source.count*DIMENSIONS+reserve_bytes:
        raise ValueError('projected_navigation_disk_reserve')
    staging=pathlib.Path(tempfile.mkdtemp(prefix=output.name+'.partial-',dir=output.parent))
    digest=hashlib.sha256();source_digest=hashlib.sha256()
    with source.path.open('rb') as original,(staging/'vectors.i8').open('xb') as target:
        for start in range(0,source.count,BLOCK_ROWS):
            check_cancelled();source.assert_unchanged()
            count=min(BLOCK_ROWS,source.count-start)
            raw=original.read(count*ROW_BYTES)
            if len(raw)!=count*ROW_BYTES:raise ValueError('projected_navigation_truncated')
            source_digest.update(raw)
            values=np.frombuffer(raw,dtype='<f2').reshape(count,DIMENSIONS).astype(np.float64)
            if not np.isfinite(values).all():raise ValueError('projected_navigation_projection_invalid')
            scales=np.max(np.abs(values),axis=1);scales[scales==0]=1
            raw=np.rint(values/scales[:,None]*127).astype(np.int8).tobytes()
            if shutil.disk_usage(staging).free<len(raw)+reserve_bytes:
                raise ValueError('projected_navigation_disk_reserve')
            target.write(raw);digest.update(raw)
        if original.read(1) or source_digest.hexdigest()!=source.file_sha256:
            raise ValueError('projected_navigation_file_mismatch')
        target.flush();os.fsync(target.fileno())
    check_cancelled();source.assert_unchanged()
    manifest={'format':COMPACT_FORMAT,'completion_sha256':source.completion_sha256,
        'dimensions':3072,'prefix_dimensions':DIMENSIONS,'encoding':COMPACT_ENCODING,
        'vectors':source.count,'metric':'cosine-float64','zero_prefix_score':0,
        'tie_break':'ascending-global-ordinal','parent_manifest_sha256':source.manifest_sha256,
        'bytes':source.count*DIMENSIONS,'sha256':digest.hexdigest()}
    raw=canonical(manifest)
    with (staging/'manifest.json').open('xb') as target:
        target.write(raw);target.flush();os.fsync(target.fileno())
    sync_directory(staging);os.rename(staging,output);sync_directory(output.parent)
    return hashlib.sha256(raw).hexdigest()


class ProjectedNavigation:
    """Borrow upstream navigation; own only this read-only mapped projection."""

    def __init__(self, upstream, root, manifest_sha256, *, upstream_candidates=10000, read_workers=1,
                 positioned_read=None):
        self.values = None
        self.read_pool = None
        self.read_fd = None
        self.upstream = upstream
        # Borrowed from the authenticated upstream kernel; the composition
        # closes this reader and drains its pool before unloading that kernel.
        self.positioned_read = positioned_read
        try:
            if type(read_workers) is not int or read_workers not in (1, 2, 4, 8, 16, 32):
                raise ValueError('projected_navigation_read_workers_invalid')
            if read_workers > 1 and not hasattr(os, 'pread'):
                raise ValueError('projected_navigation_positioned_reads_unavailable')
            self.read_workers = read_workers
            if (type(upstream_candidates) is not int
                    or not 1 <= upstream_candidates <= 20000):
                raise ValueError('projected_navigation_policy_invalid')
            self.upstream_candidates = min(upstream_candidates, upstream.count)
            self.root = pathlib.Path(root).resolve(strict=True)
            path = self.root/'manifest.json'
            if path.is_symlink() or path.stat().st_size > 4096:
                raise ValueError('projected_navigation_manifest_invalid')
            before = signature(path)
            raw = path.read_bytes()
            if signature(path) != before or hashlib.sha256(raw).hexdigest() != manifest_sha256:
                raise ValueError('projected_navigation_manifest_mismatch')
            m = json.loads(raw)
            compact=isinstance(m,dict) and m.get('format')==COMPACT_FORMAT
            self.encoding=COMPACT_ENCODING if compact else 'float16-little-endian'
            self.dtype=np.dtype('i1' if compact else '<f2')
            self.row_bytes=DIMENSIONS*self.dtype.itemsize
            if compact and (not isinstance(m.get('parent_manifest_sha256'),str)
                    or re.fullmatch('[a-f0-9]{64}',m['parent_manifest_sha256']) is None):
                raise ValueError('projected_navigation_manifest_invalid')
            expected = {'format': COMPACT_FORMAT if compact else FORMAT, 'completion_sha256': upstream.completion_sha256,
                        'dimensions': 3072, 'prefix_dimensions': DIMENSIONS,
                        'encoding': self.encoding, 'metric': 'cosine-float64',
                        'zero_prefix_score': 0, 'tie_break': 'ascending-global-ordinal'}
            if (not isinstance(m, dict) or any(m.get(key) != value for key, value in expected.items())
                    or type(m.get('vectors')) is not int or m['vectors'] != upstream.count
                    or not 0 < m['vectors']*self.row_bytes <= MAX_BYTES
                    or type(m.get('bytes')) is not int or m['bytes'] != m['vectors']*self.row_bytes
                    or upstream.dimensions != 3072):
                raise ValueError('projected_navigation_manifest_invalid')
            self.count = m['vectors']
            self.dimensions = 3072
            self.completion_sha256 = upstream.completion_sha256
            self.manifest_sha256 = manifest_sha256
            self.path = self.root/('vectors.i8' if compact else 'vectors.f16')
            if self.path.is_symlink() or self.path.stat().st_size != m['bytes']:
                raise ValueError('projected_navigation_file_invalid')
            self.identity = signature(self.path)
            digest = hashlib.sha256()
            with self.path.open('rb') as source:
                while block := source.read(4*1024**2):
                    check_cancelled()
                    digest.update(block)
            if signature(self.path) != self.identity or digest.hexdigest() != m.get('sha256'):
                raise ValueError('projected_navigation_file_mismatch')
            self.file_sha256=digest.hexdigest()
            self.values = np.memmap(self.path, dtype=self.dtype, mode='r', shape=(self.count, DIMENSIONS))
            if hasattr(self.values._mmap, 'madvise'):
                self.values._mmap.madvise(mmap.MADV_RANDOM)
            if read_workers > 1:
                self.read_fd = os.open(self.path, os.O_RDONLY)
                opened = os.fstat(self.read_fd)
                if (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != self.identity:
                    raise ValueError('projected_navigation_file_changed')
                # pread uses this descriptor, independently of the mmap policy.
                if hasattr(os,'posix_fadvise') and hasattr(os,'POSIX_FADV_RANDOM'):
                    os.posix_fadvise(self.read_fd,0,0,os.POSIX_FADV_RANDOM)
                # One bounded pool belongs to the navigation owner and is
                # shared by request readers. Positioned reads do not share a
                # mutable file offset or alter coordinates/candidate policy.
                self.read_pool = ThreadPoolExecutor(max_workers=read_workers, thread_name_prefix='projection-read')
            self.assert_unchanged()
        except BaseException:
            self.close()
            raise

    def assert_unchanged(self):
        if self.values is None or self.values.flags.writeable:
            raise ValueError('projected_navigation_unavailable')
        if signature(self.path) != self.identity:
            raise ValueError('projected_navigation_file_changed')
        self.upstream.assert_unchanged()

    def _read_rows(self, ids):
        if self.read_pool is None:
            return self.values[ids]
        def read(positions):
            if self.positioned_read is not None:
                positions = np.ascontiguousarray(positions, dtype=np.uint64)
                rows = np.empty((len(positions), DIMENSIONS), dtype=self.dtype)
                for start in range(0, len(positions), 32):
                    check_cancelled()
                    count = min(32, len(positions)-start)
                    if self.positioned_read(self.read_fd, positions.ctypes.data+start*8,
                            count, self.row_bytes, rows.ctypes.data+start*self.row_bytes) != 0:
                        raise ValueError('projected_navigation_read_incomplete')
                check_cancelled()
                return rows
            chunks = []
            for ordinal in positions:
                check_cancelled()
                raw = os.pread(self.read_fd, self.row_bytes, int(ordinal)*self.row_bytes)
                if len(raw) != self.row_bytes:
                    raise ValueError('projected_navigation_read_incomplete')
                chunks.append(raw)
            check_cancelled()
            return np.frombuffer(b''.join(chunks), dtype=self.dtype).reshape(len(positions), DIMENSIONS)
        groups = np.array_split(ids, min(self.read_workers, len(ids)))
        futures = [self.read_pool.submit(copy_context().run, read, group) for group in groups]
        try:
            return np.concatenate([future.result() for future in futures])
        finally:
            for future in futures:
                future.cancel()
            # A failed/cancelled request must drain its copies before returning
            # the borrowed reader; other requests may still use the owner.
            wait(futures)

    def search(self, query, count):
        self.assert_unchanged()
        if type(count) is not int or not 1 <= count <= self.upstream_candidates:
            raise ValueError('projected_navigation_request_bound')
        query = np.asarray(query, dtype=np.float64)
        if query.shape != (1, 3072) or not np.isfinite(query).all() or not np.any(query):
            raise ValueError('projected_navigation_query_invalid')
        check_cancelled()
        _, ids = self.upstream.search(query, self.upstream_candidates)
        ids = np.asarray(ids)
        if (ids.shape != (1, self.upstream_candidates) or ids.dtype.kind not in 'iu'
                or np.any(ids < 0) or np.any(ids >= self.count)
                or len(set(ids[0].tolist())) != self.upstream_candidates):
            raise ValueError('projected_navigation_candidates_invalid')
        ids = np.sort(ids[0].astype(np.int64))
        prefix = query[0, :DIMENSIONS]
        norm = np.linalg.norm(prefix)
        if not np.isfinite(norm):
            raise ValueError('projected_navigation_query_invalid')
        if norm > 0:
            prefix = prefix/norm
        scores = np.empty(len(ids), dtype=np.float64)
        for start in range(0, len(ids), BLOCK_ROWS):
            check_cancelled()
            rows = np.asarray(self._read_rows(ids[start:start+BLOCK_ROWS]), dtype=np.float64)
            if not np.isfinite(rows).all():
                raise ValueError('projected_navigation_projection_invalid')
            norms = np.linalg.norm(rows, axis=1)
            # A zero prefix carries no directional information. Deterministic
            # zero scores allow exact reranking without NaNs or invented axes.
            norms[norms == 0] = 1
            scores[start:start+len(rows)] = (rows/norms[:, None])@prefix
        order = np.lexsort((ids, -scores))[:count]
        check_cancelled()
        self.assert_unchanged()
        return (1-scores[order]).reshape(1, count), ids[order].reshape(1, count)

    def close(self):
        pool, self.read_pool = self.read_pool, None
        if pool is not None:
            pool.shutdown(wait=True, cancel_futures=True)
        fd, self.read_fd = self.read_fd, None
        if fd is not None:
            os.close(fd)
        values, self.values = self.values, None
        if values is not None:
            values._mmap.close()
