"""Bounded in-memory lookup of stored source identities by requested legal date.

Built before listener readiness. No publisher access, edition preparation,
stored index mutation, or request-time inventory scan.
"""
import datetime
import re
import urllib.parse
from types import MappingProxyType


def edition_date(value):
    match = re.fullmatch(r'(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}))?', value) if isinstance(value, str) else None
    if not match or (match[4] is not None and int(match[4]) > 23):
        raise ValueError('source_reference_edition_invalid')
    return datetime.date(int(match[3]), int(match[2]), int(match[1])).isoformat()


def document(value):
    if not isinstance(value, str) or not 1 <= len(value.encode()) <= 2048:
        raise ValueError('source_reference_url_invalid')
    url = urllib.parse.urlsplit(value)
    match = re.fullmatch(r'/docs/(-?\d+)', url.path)
    query = urllib.parse.parse_qsl(url.query, keep_blank_values=True, strict_parsing=True)
    if (url.scheme != 'https' or url.hostname not in ('lex.uz', 'www.lex.uz')
            or url.username or url.password or url.port or url.fragment or not match
            or len(query) > 1 or any(key != 'ONDATE' for key, _ in query)):
        raise ValueError('source_reference_url_invalid')
    return match[1], query[0][1] if query else None


def capture(row):
    if not isinstance(row, dict) or row.get('kind') != 'document' or row.get('state') != 'done':
        return None
    context, receipt = row.get('context'), row.get('receipt')
    if not isinstance(context, dict) or not isinstance(receipt, dict) or receipt.get('status') != 200:
        return None
    work = row.get('id')
    if not isinstance(work, str) or not re.fullmatch('[a-f0-9]{64}', work):
        return None
    try:
        source, requested = document(row.get('url'))
        if context.get('source') != source or context.get('edition') != requested:
            return None
        date = edition_date(requested) if requested is not None else None
    except ValueError:
        return None
    # Identical duplicate rows are safe. Different work identities are not
    # assumed to be equivalent aliases, even when their captured bytes match.
    return (source, date), (work, row['url'], requested)


class SourceReferences:
    def __init__(self, package):
        entries = {}
        exact_entries = {}

        def retain(index, key, identity):
            if key not in index:
                # Both indexes are bounded together, including multiple tokens
                # for a single calendar day. Conflicts never choose a capture.
                if len(entries) + len(exact_entries) >= 2_000_000:
                    raise ValueError('source_reference_inventory_bound')
                index[key] = identity
            elif index[key] != identity:
                index[key] = None

        parts = package.inventory_parts
        if not parts:
            raise ValueError('source_reference_inventory_unavailable')
        for part in range(parts):
            # Build the existing URL/date lookup from stored inventory records.
            for _, row in package.records('inventory', part):
                found = capture(row)
                if found is None:
                    continue
                key, identity = found
                if key not in entries and len(entries) >= 1_000_000:
                    raise ValueError('source_reference_inventory_bound')
                retain(entries, key, identity)
                if identity[2] is not None:
                    retain(exact_entries, (key[0], identity[2]), identity)
        self.package_sha256 = package.sha256
        self.entries = MappingProxyType(entries)
        self.exact_entries = MappingProxyType(exact_entries)

    def resolve(self, url, scope):
        source, requested = document(url)
        if not isinstance(scope, dict):
            raise ValueError('source_reference_scope_invalid')
        if scope == {'kind': 'current'}:
            if requested is not None:
                raise ValueError('source_reference_scope_invalid')
            at = None
        elif set(scope) == {'kind', 'at'} and scope['kind'] == 'historical':
            at = scope['at']
            if not isinstance(at, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', at):
                raise ValueError('source_reference_scope_invalid')
            datetime.date.fromisoformat(at)
            if requested is not None and edition_date(requested) != at:
                raise ValueError('source_reference_scope_invalid')
        else:
            raise ValueError('source_reference_scope_invalid')
        # An explicit publisher token is more specific than its calendar day.
        # Keep that distinction even when another token on the day is retained.
        index = self.exact_entries if requested is not None else self.entries
        key = (source, requested if requested is not None else at)
        if key not in index:
            return 'missing', None
        identity = index[key]
        if identity is None:
            return 'ambiguous', None
        if requested is not None and identity[2] != requested:
            return 'missing', None
        return 'unique', identity[0]
