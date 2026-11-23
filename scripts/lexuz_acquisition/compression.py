"""Portable lossless storage; legacy gzip receipts remain readable unchanged."""
from contextlib import contextmanager
import gzip
import io
from pathlib import Path

import zstandard


def writer(target, *, window_log=None):
    # Each stream owns its compressor: network and preparation run concurrently.
    # No internal worker pool competes with the acquisition workers.
    if window_log is None:
        compressor = zstandard.ZstdCompressor(level=6, write_checksum=True)
    else:
        parameters = zstandard.ZstdCompressionParameters.from_level(
            6, window_log=window_log, write_checksum=1)
        compressor = zstandard.ZstdCompressor(compression_params=parameters)
    return compressor.stream_writer(target, closefd=False)


class _CheckedReader(io.RawIOBase):
    """Require a complete checksummed frame, including its terminal bytes."""
    def __init__(self, source):
        self.source = source
        self.decoder = zstandard.ZstdDecompressor().decompressobj()
        self.pending = memoryview(b'')

    def readable(self):
        return True

    def readinto(self, target):
        while not self.pending:
            if self.decoder.eof:
                if self.decoder.unused_data or self.source.read(1):
                    raise ValueError('unexpected_bytes_after_storage_frame')
                return 0
            packed = self.source.read(16384)
            if not packed:
                raise EOFError('incomplete_storage_frame')
            self.pending = memoryview(self.decoder.decompress(packed))
        size = min(len(target), len(self.pending))
        target[:size] = self.pending[:size]
        self.pending = self.pending[size:]
        return size


@contextmanager
def reader(path):
    path = Path(path)
    if path.suffix == '.zst':
        with path.open('rb') as source:
            with io.BufferedReader(_CheckedReader(source)) as stream:
                yield stream
    elif path.suffix == '.gz':
        with gzip.open(path, 'rb') as stream:
            yield stream
    elif path.suffix == '.zdelta':
        from .edition_storage import read_delta
        with io.BytesIO(read_delta(path)) as stream:
            yield stream
    else:
        raise ValueError(f'unsupported_storage_encoding:{path.suffix}')


def existing_key(root, sha):
    for suffix in ('.zst', '.gz', '.zdelta'):
        key = f'objects/{sha[:2]}/{sha}{suffix}'
        if (root/key).is_file():
            return key
    return None
