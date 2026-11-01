"""Read-only package integrity check for competing captured-current source bytes.

Performed before the source listener starts. No source acquisition, preparation,
edition selection, disk cache, index mutation or freshness maintenance.
"""
import re
import urllib.parse
from types import MappingProxyType


def capture_identity(row):
    context, receipt = row.get('context') or {}, row.get('receipt') or {}
    if (row.get('kind') != 'document' or row.get('state') != 'done'
            or context.get('edition') is not None or receipt.get('status') != 200):
        return None
    url = urllib.parse.urlsplit(row.get('url', ''))
    match = re.fullmatch(r'/docs/(-?\d+)', url.path)
    query = urllib.parse.parse_qs(url.query, keep_blank_values=True)
    raw = row.get('raw_hash', '')
    if (url.scheme != 'https' or url.hostname not in ('lex.uz', 'www.lex.uz')
            or url.username or url.password or url.port or not match
            or 'ONDATE' in query or 'ONDATE2' in query or str(context.get('source')) != match[1]
            or not re.fullmatch('[a-f0-9]{64}', raw) or receipt.get('sha256') != raw):
        return None
    return match[1], raw


class CaptureSelection:
    def __init__(self, package):
        selected = {}
        shards = package.handoff['shards']['inventory']
        if not shards:
            raise ValueError('capture_inventory_unavailable')
        for part in range(len(shards)):
            # Consume the complete authenticated stream, including its integrity trailer.
            for _, row in package.records('inventory', part):
                identity = capture_identity(row)
                if identity is None:
                    continue
                source, raw = identity
                if source not in selected:
                    if len(selected) >= 1_000_000:
                        raise ValueError('capture_inventory_bound')
                    selected[source] = raw
                elif selected[source] != raw:
                    selected[source] = None
        self.package_sha256 = package.sha256
        self.selected = MappingProxyType(selected)

    def check(self, inventory):
        identity = capture_identity(inventory)
        if identity is None or identity[0] not in self.selected:
            return 'unavailable'
        expected = self.selected[identity[0]]
        if expected is None:
            return 'conflict'
        return 'unique' if expected == identity[1] else 'unavailable'
