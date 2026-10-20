"""Stream authenticated coordinates into PostgreSQL without text round trips.

The caller authenticates the source and imports into an unpublished staging
table. COPY completion is not admission: population, index, recall and latency
qualification must finish before selecting a Search Release. Half and binary
values are navigation derivatives; retain the original float32 source.
"""
import struct

import numpy as np


DIMENSIONS = 3072
COPY_HEADER = b"PGCOPY\n\xff\r\n\0" + struct.pack("!ii", 0, 0)
COPY_TRAILER = struct.pack("!h", -1)


def encode_copy(rows, representation="vector"):
    """Yield binary COPY for (bigint ordinal, vector/halfvec/bit value).

    Rows must arrive in strictly increasing completion ordinal order. This is
    a bounded stream, so consumers must abort/rollback COPY if iteration fails.
    Authentication and full-population checks belong to the source publisher.
    """
    if representation not in ("vector", "halfvec", "bit"):
        raise ValueError("pgvector_representation_invalid")
    yield COPY_HEADER
    previous = -1
    for ordinal, coordinates in rows:
        if type(ordinal) is not int or not previous < ordinal < 2**63:
            raise ValueError("pgvector_ordinal_invalid")
        values = np.asarray(coordinates)
        if (values.dtype.kind != "f" or values.dtype.itemsize != 4
                or values.shape != (DIMENSIONS,) or not np.isfinite(values).all()
                or not np.any(values != 0)):
            raise ValueError("pgvector_original_coordinates_invalid")
        if representation == "vector":
            payload = struct.pack("!hh", DIMENSIONS, 0) + values.astype(">f4").tobytes()
        elif representation == "halfvec":
            with np.errstate(over="ignore", under="ignore"):
                half = values.astype(">f2")
            if not np.isfinite(half).all() or not np.any(half != 0):
                raise ValueError("pgvector_half_coordinates_invalid")
            payload = struct.pack("!hh", DIMENSIONS, 0) + half.tobytes()
        else:
            # pgvector binary_quantize uses strictly positive coordinates.
            payload = struct.pack("!i", DIMENSIONS) + np.packbits(
                values > 0, bitorder="big").tobytes()
        yield struct.pack("!hiq i", 2, 8, ordinal, len(payload)) + payload
        previous = ordinal
    yield COPY_TRAILER
