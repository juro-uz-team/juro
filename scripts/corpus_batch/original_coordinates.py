"""Exact original-coordinate access to an admitted USearch 2.21 f32 matrix.

The serialized matrix is in insertion-slot order, not embedding ordinal order.
Prove the permutation against the original-byte receipt before using it. Copies
release Python's GIL during disk page faults; the owner must drain readers before
closing the mapping and must retain its existing storage-identity checks.
"""
import ctypes
import hashlib
import struct

import numpy as np

DIMENSIONS = 3072
WIDTH = DIMENSIONS * 4


class OriginalCoordinates:
    def __init__(self, mapping, count, original_sha256, read_original):
        self.matrix = self.slots = None
        if (type(count) is not int or not 0 < count <= 50000 or len(mapping) < 8
                or struct.unpack_from('<II', mapping) != (count, WIDTH)
                or len(mapping) < 8 + count * WIDTH):
            raise ValueError('original_coordinates_shape_invalid')
        matrix = np.ndarray((count, DIMENSIONS), dtype='<f4', buffer=mapping, offset=8)
        slots = np.empty(count, dtype=np.uint32)
        if hashlib.sha256(matrix).hexdigest() == original_sha256:
            slots[:] = np.arange(count, dtype=np.uint32)
        else:
            by_hash = {}
            for slot, row in enumerate(matrix):
                by_hash.setdefault(hashlib.sha256(row).digest(), []).append(slot)
            digest = hashlib.sha256()
            for start in range(0, count, 1024):
                size = min(1024, count-start)
                raw = read_original(start, size)
                if len(raw) != size * WIDTH:
                    raise ValueError('original_coordinates_source_invalid')
                digest.update(raw)
                block = np.frombuffer(raw, dtype='<f4').reshape(size, DIMENSIONS)
                for offset, row in enumerate(block):
                    positions = by_hash.get(hashlib.sha256(row).digest())
                    if not positions:
                        raise ValueError('original_coordinates_missing')
                    slot = positions.pop()
                    if matrix[slot].tobytes() != row.tobytes():
                        raise ValueError('original_coordinates_mismatch')
                    slots[start+offset] = slot
            if digest.hexdigest() != original_sha256 or any(by_hash.values()):
                raise ValueError('original_coordinates_population_invalid')
        matrix.flags.writeable = False
        slots.flags.writeable = False
        self.matrix, self.slots = matrix, slots

    def read(self, ids):
        if self.matrix is None or self.slots is None:
            raise ValueError('original_coordinates_closed')
        ids = np.asarray(ids)
        if (ids.ndim != 1 or ids.dtype.kind not in 'iu' or len(ids) > 50000
                or np.any(ids >= len(self.slots)) or np.any(ids < 0)):
            raise ValueError('original_coordinates_request_invalid')
        values = np.empty((len(ids), DIMENSIONS), dtype='<f4')
        source, target = self.matrix.ctypes.data, values.ctypes.data
        for position, slot in enumerate(self.slots[ids]):
            ctypes.memmove(target+position*WIDTH, source+int(slot)*WIDTH, WIDTH)
        return values

    def close(self):
        self.matrix = self.slots = None
