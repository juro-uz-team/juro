import struct
import unittest

import numpy as np

from pgvector_copy import COPY_HEADER, COPY_TRAILER, encode_copy


class PgvectorCopyTests(unittest.TestCase):
    def setUp(self):
        self.values = np.resize(np.array([0.0, -0.0, 0.125, -0.25], dtype=np.float32), 3072)

    def payload(self, representation):
        chunks = list(encode_copy([(42, self.values)], representation))
        self.assertEqual(chunks[0], COPY_HEADER)
        self.assertEqual(chunks[-1], COPY_TRAILER)
        fields, size, ordinal, length = struct.unpack("!hiq i", chunks[1][:18])
        self.assertEqual((fields, size, ordinal, length), (2, 8, 42, len(chunks[1]) - 18))
        return chunks[1][18:]

    def test_original_float32_round_trip_preserves_signed_zero_and_bytes(self):
        payload = self.payload("vector")
        self.assertEqual(struct.unpack("!hh", payload[:4]), (3072, 0))
        restored = np.frombuffer(payload[4:], dtype=">f4").astype("<f4")
        self.assertEqual(restored.tobytes(), self.values.tobytes())

    def test_navigation_derivatives_match_pgvector_wire_layout(self):
        payload = self.payload("halfvec")
        self.assertEqual(struct.unpack("!hh", payload[:4]), (3072, 0))
        np.testing.assert_array_equal(np.frombuffer(payload[4:], dtype=">f2"), self.values)
        payload = self.payload("bit")
        self.assertEqual(struct.unpack("!i", payload[:4]), (3072,))
        self.assertEqual(payload[4:], bytes([0b00100010]) * 384)

    def test_rejects_lossy_originals_invalid_values_and_unordered_identities(self):
        for values in [self.values.astype(np.float64), self.values[:10],
                       np.full(3072, np.nan, dtype=np.float32), np.zeros(3072, dtype=np.float32)]:
            with self.assertRaisesRegex(ValueError, "original_coordinates_invalid"):
                list(encode_copy([(0, values)]))
        for ordinal in [-1, True, 2**63]:
            with self.assertRaisesRegex(ValueError, "ordinal_invalid"):
                list(encode_copy([(ordinal, self.values)]))
        with self.assertRaisesRegex(ValueError, "ordinal_invalid"):
            list(encode_copy([(2, self.values), (2, self.values)]))
        for value in [1e10, 1e-20]:
            with self.assertRaisesRegex(ValueError, "half_coordinates_invalid"):
                list(encode_copy([(0, np.full(3072, value, dtype=np.float32))], "halfvec"))
        with self.assertRaisesRegex(ValueError, "representation_invalid"):
            list(encode_copy([], "unknown"))


if __name__ == "__main__":
    unittest.main()
