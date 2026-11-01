"""Read prepared source records without repeating corpus authentication.

The projection and work index are existing preparation outputs. Digests identify
the selected generation; they are not recomputed over their stored contents.
"""
import bisect
import json
import pathlib
import sqlite3
import struct
import threading
from collections import OrderedDict
import zstandard
from cancellation import check_cancelled

INDEX = struct.Struct('<QQIII32s')
MAX_RECORD_BYTES = 128 * 1024 * 1024


def read_json(path, maximum=8 * 1024 * 1024):
    with path.open('rb') as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError('source_metadata_bound')
    return json.loads(raw)


class TrustedWorkIndex:
    def __init__(self, root, manifest_sha256, package_sha256):
        root = pathlib.Path(root).resolve()
        metadata = read_json(root / 'manifest.json')
        if metadata.get('format') != 'prepared-work-locations-v1' or metadata.get('package_sha256') != package_sha256:
            raise ValueError('source_work_generation_mismatch')
        self.manifest_sha256 = manifest_sha256
        self.path = root / 'works.sqlite'
        self.connection = sqlite3.connect(self.path.as_uri() + '?mode=ro&immutable=1', uri=True)
        self.connection.execute('PRAGMA query_only=ON')

    def lookup(self, keys):
        result = []
        for key in keys:
            check_cancelled()
            row = self.connection.execute('SELECT work,inventory_part,inventory_row,prepared_part,prepared_row '
                                          'FROM works WHERE key=?', (key,)).fetchone()
            result.append(None if row is None else {
                'work': row[0], 'inventory': (row[1], row[2]),
                'prepared': None if row[3] is None else (row[3], row[4])})
        return result

    def close(self):
        self.connection.close()


class TrustedSourceProjection:
    def __init__(self, root, package_sha256):
        self.root = pathlib.Path(root).resolve()
        metadata = read_json(self.root / 'manifest.json')
        if metadata.get('format') != 'prepared-source-blocks-v1' or metadata.get('package_sha256') != package_sha256:
            raise ValueError('source_projection_generation_mismatch')
        self.parts = metadata['parts']
        self.sha256 = package_sha256
        self.inventory_parts = len(self.parts['inventory'])
        self._indexes = OrderedDict()
        self._index_bytes = 0
        self._index_lock = threading.Lock()

    def _part(self, kind, part):
        if kind not in ('inventory', 'prepared', 'chunks') or type(part) is not int or not 0 <= part < len(self.parts[kind]):
            raise ValueError('source_projection_position_invalid')
        return self.root / f'{kind}-{part:06d}'

    def _blocks(self, directory):
        # Each projection owns one immutable generation. Cache only navigation,
        # with conservative Python object accounting, never mutable legal rows.
        with self._index_lock:
            cached = self._indexes.get(directory)
            if cached is not None:
                self._indexes.move_to_end(directory)
                return cached[0]
            with (directory / 'rows.idx').open('rb') as stream:
                raw = stream.read(512 * 1024 * 1024 + 1)
            if len(raw) > 512 * 1024 * 1024 or len(raw) % INDEX.size:
                raise ValueError('source_projection_index_bound')
            blocks = tuple(INDEX.iter_unpack(raw))
            weight = len(blocks) * 512 + 1024
            maximum = 32 * 1024 * 1024
            if weight <= maximum:
                while self._indexes and self._index_bytes + weight > maximum:
                    _, (_, previous) = self._indexes.popitem(last=False)
                    self._index_bytes -= previous
                self._indexes[directory] = (blocks, weight)
                self._index_bytes += weight
            return blocks

    def _read(self, directory, blocks, requested=None):
        with (directory / 'records.zst').open('rb') as stream:
            for start, offset, compressed, decoded, count, _stored_digest in blocks:
                check_cancelled()
                if not 0 < compressed <= MAX_RECORD_BYTES + 1024 * 1024 or not 0 < decoded <= MAX_RECORD_BYTES + 1:
                    raise ValueError('source_projection_block_bound')
                if not 0 < count <= 1024:
                    raise ValueError('source_projection_row_bound')
                stream.seek(offset)
                encoded = stream.read(compressed)
                if len(encoded) != compressed:
                    raise ValueError('source_projection_read_unavailable')
                frame_size = zstandard.frame_content_size(encoded)
                if frame_size not in (zstandard.CONTENTSIZE_UNKNOWN, zstandard.CONTENTSIZE_ERROR) and frame_size > MAX_RECORD_BYTES + 1:
                    raise ValueError('source_projection_block_bound')
                raw = zstandard.ZstdDecompressor().decompress(encoded, max_output_size=decoded)
                lines = raw.splitlines()
                if len(lines) != count:
                    raise ValueError('source_projection_rows_unavailable')
                for relative, line in enumerate(lines):
                    row = start + relative
                    if requested is None or row in requested:
                        check_cancelled()
                        yield row, json.loads(line)

    def records(self, kind, part):
        directory = self._part(kind, part)
        yield from self._read(directory, self._blocks(directory))

    def records_at(self, kind, part, requested):
        if not requested:
            return
        if any(type(row) is not int or row < 0 for row in requested):
            raise ValueError('source_projection_position_invalid')
        directory = self._part(kind, part)
        blocks = self._blocks(directory)
        starts = [block[0] for block in blocks]
        selected = set()
        for row in requested:
            index = bisect.bisect_right(starts, row) - 1
            if index < 0 or row >= blocks[index][0] + blocks[index][4]:
                raise ValueError('source_projection_position_unavailable')
            selected.add(index)
        yield from self._read(directory, [blocks[i] for i in sorted(selected)], set(requested))
