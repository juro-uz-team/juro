"""Paged immutable mapping from compact embedding inputs to source memberships.

Records retain original input and chunk identities plus a hash reference to the
exact acquisition-work string in the pinned work dictionary. They are
discovery references, not verified provisions or temporal applicability claims.
Source publication must verify the original-to-compact mapping and the complete
membership population before publishing the root manifest.
"""
from collections import OrderedDict
import hashlib
import json
import os
import pathlib
import struct

RECORD = struct.Struct('<32s32s32s32sQ')
PAGE_ROWS = 4096
PAGE_BYTES = PAGE_ROWS * RECORD.size
MAX_ORDINAL = 2**53-1


def sha(value):
    return hashlib.sha256(value).hexdigest()


def sync_directory(root):
    if os.name != 'nt':
        fd = os.open(root,os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def write_part(root, prefix, rows):
    """Publish one already-sorted partition; no whole-population arrays.

    Input tuple: compact input hash, original input hash, chunk hash,
    SHA256(exact UTF-8 work ID),
    original global membership ordinal. Sorting preserves ordinal order within
    each input, allowing bounded continuation without dropping repeated members.
    """
    if type(prefix) is not int or not 0 <= prefix < 256:
        raise ValueError('membership_prefix_invalid')
    root = pathlib.Path(root)
    root.mkdir(parents=True,exist_ok=True)
    target = root/f'{prefix:02x}.members'
    if target.exists():
        raise ValueError('membership_part_already_published')
    pending = target.with_suffix('.partial')
    total = 0
    previous = None
    pages = []
    entire = hashlib.sha256()
    with pending.open('xb') as output:
        page = bytearray()
        for row in rows:
            if (len(row) != 5 or any(not isinstance(value,bytes) or len(value) != 32 for value in row[:4])
                    or row[0][0] != prefix or type(row[4]) is not int or not 0 <= row[4] <= MAX_ORDINAL):
                raise ValueError('membership_record_invalid')
            identity = (row[0],row[4])
            if previous is not None and identity <= previous:
                raise ValueError('membership_order_or_identity_invalid')
            previous = identity
            page.extend(RECORD.pack(*row))
            total += 1
            if len(page) == PAGE_BYTES:
                output.write(page); entire.update(page); pages.append(sha(page)); page.clear()
        if page:
            output.write(page); entire.update(page); pages.append(sha(page))
        output.flush(); os.fsync(output.fileno())
    os.replace(pending,target)
    sync_directory(root)
    return {'prefix':prefix,'rows':total,'bytes':total*RECORD.size,
            'sha256':entire.hexdigest(),'pages':pages}


class MembershipIndex:
    def __init__(self,root,manifest_sha256,cache_pages=64):
        self.root = pathlib.Path(root).resolve(strict=True)
        path = self.root/'manifest.json'
        if path.stat().st_size > 8*1024*1024:
            raise ValueError('membership_manifest_too_large')
        raw = path.read_bytes()
        if sha(raw) != manifest_sha256:
            raise ValueError('membership_manifest_pin_mismatch')
        self.manifest_sha256=manifest_sha256
        manifest = json.loads(raw)
        if (manifest.get('format') != 'prepared-membership-pages-v1'
                or manifest.get('complete') is not True
                or manifest.get('record_bytes') != RECORD.size
                or manifest.get('page_rows') != PAGE_ROWS
                or manifest.get('work_key_format') != 'sha256-utf8-work-id-v1'
                or type(manifest.get('rows')) is not int or not 0 <= manifest['rows'] <= MAX_ORDINAL
                or type(cache_pages) is not int or not 1 <= cache_pages <= 256):
            raise ValueError('membership_manifest_invalid')
        for field in ('package_sha256','mapping_manifest_sha256','source_membership_manifest_sha256','work_manifest_sha256'):
            value = manifest.get(field,'')
            if not isinstance(value,str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
                raise ValueError('membership_manifest_lineage_invalid')
        parts = manifest.get('parts')
        if not isinstance(parts,list) or len(parts) > 256:
            raise ValueError('membership_manifest_parts_invalid')
        self.parts = {}
        for part in parts:
            prefix = part.get('prefix')
            count = part.get('rows')
            if (type(prefix) is not int or not 0 <= prefix < 256 or prefix in self.parts
                    or type(count) is not int or not 0 < count <= MAX_ORDINAL
                    or part.get('bytes') != count*RECORD.size
                    or not isinstance(part.get('pages'),list)
                    or len(part['pages']) != (count+PAGE_ROWS-1)//PAGE_ROWS):
                raise ValueError('membership_manifest_part_invalid')
            for digest in [part.get('sha256'),*part['pages']]:
                if not isinstance(digest,str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
                    raise ValueError('membership_manifest_page_invalid')
            path = self.root/f'{prefix:02x}.members'
            if path.is_symlink() or path.resolve().parent != self.root or path.stat().st_size != part['bytes']:
                raise ValueError('membership_part_unavailable')
            self.parts[prefix] = part
        if sum(part['rows'] for part in parts) != manifest['rows']:
            raise ValueError('membership_manifest_count_mismatch')
        self.manifest = manifest
        self.cache_pages = cache_pages
        self.pages = OrderedDict()

    def _row(self,prefix,ordinal):
        part = self.parts[prefix]
        if not 0 <= ordinal < part['rows']:
            raise ValueError('membership_position_invalid')
        page_number,offset = divmod(ordinal,PAGE_ROWS)
        identity = (prefix,page_number)
        if identity not in self.pages:
            with (self.root/f'{prefix:02x}.members').open('rb') as source:
                source.seek(page_number*PAGE_BYTES)
                page = source.read(min(PAGE_BYTES,(part['rows']-page_number*PAGE_ROWS)*RECORD.size))
            if sha(page) != part['pages'][page_number]:
                raise ValueError('membership_page_hash_mismatch')
            self.pages[identity] = page
            if len(self.pages) > self.cache_pages:
                self.pages.popitem(last=False)
        self.pages.move_to_end(identity)
        row = RECORD.unpack_from(self.pages[identity],offset*RECORD.size)
        if row[0][0] != prefix or row[4] > MAX_ORDINAL:
            raise ValueError('membership_page_identity_invalid')
        return row

    def lookup_exact(self,compact_input_hash,membership_ordinal):
        """Authenticate one named source membership, never its next neighbour."""
        if type(membership_ordinal) is not int or not 0<=membership_ordinal<=MAX_ORDINAL:
            raise ValueError('membership_lookup_invalid')
        rows,_=self.lookup(compact_input_hash,limit=1,
                           after_ordinal=membership_ordinal-1 if membership_ordinal else None)
        return rows[0] if rows and rows[0][4]==membership_ordinal else None

    def lookup(self,compact_input_hash,limit=2000,after_ordinal=None):
        """Page all memberships for one vector input; never silently truncate.

        Returns (records, next_after_ordinal). Continue while the latter is not
        None. The caller must apply source/edition eligibility and deduplication.
        """
        if (not isinstance(compact_input_hash,bytes) or len(compact_input_hash) != 32
                or type(limit) is not int or not 1 <= limit <= 2000
                or (after_ordinal is not None and (type(after_ordinal) is not int or not 0 <= after_ordinal <= MAX_ORDINAL))):
            raise ValueError('membership_lookup_invalid')
        prefix = compact_input_hash[0]
        if prefix not in self.parts:
            return [],None
        count = self.parts[prefix]['rows']
        first,last = 0,count
        target = (compact_input_hash,-1 if after_ordinal is None else after_ordinal)
        while first < last:
            middle = (first+last)//2
            row = self._row(prefix,middle)
            if (row[0],row[4]) <= target:
                first = middle+1
            else:
                last = middle
        result = []
        while first < count and len(result) < limit:
            row = self._row(prefix,first)
            if row[0] != compact_input_hash:
                break
            result.append(row); first += 1
        more = first < count and self._row(prefix,first)[0] == compact_input_hash
        return result,result[-1][4] if more else None
