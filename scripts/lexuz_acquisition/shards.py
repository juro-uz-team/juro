"""Lossless, bounded compressed handoff files with immutable receipts."""
import hashlib
import os
import shutil

from .store import ResourcePause, encoded
from .compression import writer


class ExportInterrupted(Exception):
    pass


class Shards:
    def __init__(self, root, name, limit=64*1024*1024, reserve=10*1024**3):
        self.root, self.name, self.limit, self.reserve = root, name, limit, reserve
        self.stream = self.file = None
        self.rows = self.length = self.checked_bytes = 0
        self.receipts = []
        self.partial = root / f'{name}.jsonl.zst.partial'

    def write(self, row):
        payload = (encoded(row)+'\n').encode()
        if self.stream and self.length+len(payload) > self.limit:
            self.close()
        if self.stream is None or self.checked_bytes + len(payload) >= 1024*1024:
            if (self.root.parent/'checkpoint-request.json').exists():
                raise ExportInterrupted('checkpoint_requested_during_export')
            if shutil.disk_usage(self.root).free < self.reserve + max(1024*1024, 2*len(payload)):
                raise ResourcePause('disk_reserve_breach_during_export')
            self.checked_bytes = 0
        if self.stream is None:
            self.file = self.partial.open('w+b')
            # Export has only a fixed set of writers. Its 8-MiB window shares
            # repeated edition text without increasing acquisition-worker RAM.
            self.stream = writer(self.file, window_log=23)
            self.sha = hashlib.sha256()
            self.length = self.rows = 0
        self.stream.write(payload)
        self.sha.update(payload)
        self.length += len(payload)
        self.checked_bytes += len(payload)
        self.rows += 1

    def close(self):
        if self.stream is None:
            return
        self.stream.close()
        self.stream = None
        self.file.flush()
        os.fsync(self.file.fileno())
        length = self.file.tell()
        self.file.seek(0)
        sha = hashlib.file_digest(self.file, 'sha256').hexdigest()
        self.file.close()
        self.file = None
        path = self.root / f'{self.name}-{sha}.jsonl.zst'
        # A retry reuses identical shards; changed shards cannot overwrite
        # files named by a previously published manifest.
        if path.exists():
            self.partial.unlink()
        else:
            os.replace(self.partial, path)
        self.receipts.append({'path': path.name, 'sha256': sha, 'bytes': length,
                              'count': self.rows, 'compression': 'zstd', 'record_format': 'jsonl',
                              'uncompressed_bytes': self.length, 'uncompressed_sha256': self.sha.hexdigest()})

    def abort(self):
        try:
            if self.stream is not None:
                self.stream.close()
        finally:
            self.stream = None
            if self.file is not None:
                self.file.close()
                self.file = None
            # Only this writer's incomplete derived output is disposable.
            self.partial.unlink(missing_ok=True)
