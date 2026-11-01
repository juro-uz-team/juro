"""Bounded complete reads through the existing immutable source projection."""
from discovery_json import encode_discovery_json


class SourceRows:
    def __init__(self, projection):
        self.projection = projection

    def read(self, kind, locations, maximum):
        grouped, result, total = {}, {}, 0
        for part, row in locations:
            grouped.setdefault(part, set()).add(row)
        # Bound aggregate complete records and preserve their requested positions.
        # Projection reads own their file handles and decoders. Server worker
        # admission bounds concurrency; unrelated sources need no shared lock.
        for part, requested in grouped.items():
            seen = set()
            for row, record in self.projection.records_at(kind, part, sorted(requested)):
                if row not in requested or row in seen:
                    raise ValueError('source_projection_identity')
                seen.add(row)
                total += len(encode_discovery_json(record))
                if total > maximum:
                    raise ValueError('source_projection_read_bound')
                result[part, row] = record
            if seen != requested:
                raise ValueError('source_projection_identity')
        return [result[part, row] for part, row in locations]
