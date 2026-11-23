"""Bounded exact-byte edition deltas with one retained independent base."""
import hashlib
import io
import json
import os
import re
import struct
from urllib.parse import urlsplit

import zstandard

MAGIC = b'LEXDELTA\x01'
MAX_BYTES = 8 * 1024 * 1024
BASE_KEY = re.compile(r'objects/([0-9a-f]{2})/([0-9a-f]{64})\.(gz|zst)\Z')


def family(row):
    if row['kind'] != 'document':
        return None
    url = urlsplit(row['url'])
    if url.hostname not in ('lex.uz', 'www.lex.uz') or not re.fullmatch(r'/(?:ru/|uz/|en/)?docs/-?\d+', url.path):
        return None
    return url._replace(query='', fragment='').geturl()


def _base(root, record):
    from .compression import reader
    match = BASE_KEY.fullmatch(record['key'])
    if not match or match[1] != match[2][:2] or match[2] != record['sha256']:
        raise ValueError('delta_base_must_be_independent_content_addressed_object')
    if not 0 < record['bytes'] <= MAX_BYTES:
        raise ValueError('delta_base_size_out_of_bounds')
    path = (root/record['key']).resolve()
    if not path.is_relative_to((root/'objects').resolve()):
        raise ValueError('delta_base_outside_object_namespace')
    with reader(path) as stream:
        payload = stream.read(MAX_BYTES + 1)
    if len(payload) != record['bytes'] or hashlib.sha256(payload).hexdigest() != record['sha256']:
        raise ValueError('delta_base_integrity_failure')
    return payload


def decode(root, header, packed):
    if header.get('schema') != 1 or not 0 < header['bytes'] <= MAX_BYTES:
        raise ValueError('unsupported_or_oversized_edition_delta')
    base = _base(root, header['base'])
    if zstandard.frame_content_size(packed) != header['bytes']:
        raise ValueError('edition_delta_frame_size_mismatch')
    dictionary = zstandard.ZstdCompressionDict(base, dict_type=zstandard.DICT_TYPE_RAWCONTENT)
    payload = zstandard.ZstdDecompressor(dict_data=dictionary).decompress(
        packed, max_output_size=MAX_BYTES, allow_extra_data=False)
    if len(payload) != header['bytes'] or hashlib.sha256(payload).hexdigest() != header['sha256']:
        raise ValueError('edition_delta_integrity_failure')
    return payload


def _header(source, path):
    if path.parent.parent.name != 'objects':
        raise ValueError('edition_delta_outside_object_namespace')
    if source.read(len(MAGIC)) != MAGIC:
        raise ValueError('invalid_edition_delta_magic')
    size = source.read(4)
    if len(size) != 4 or not 0 < (length := struct.unpack('>I', size)[0]) <= 2048:
        raise ValueError('invalid_edition_delta_header')
    header = json.loads(source.read(length))
    if header['sha256'] != path.stem or path.parent.name != path.stem[:2]:
        raise ValueError('edition_delta_identity_mismatch')
    return header


def read_header(path):
    with path.open('rb') as source:
        return _header(source, path)


def read_delta(path):
    with path.open('rb') as source:
        header = _header(source, path)
        packed = source.read(MAX_BYTES + 4097)
        if len(packed) > MAX_BYTES + 4096:
            raise ValueError('edition_delta_frame_too_large')
    return decode(path.parents[2], header, packed)


def try_delta(root, temporary, sha, length, base):
    """Replace only our unpublished temp file after an exact round trip.

    Optional optimization failure retains the complete independent download and
    returns an explicit receipt note. A published dependent never falls back to
    partial text when its base is missing or corrupt.
    """
    from .compression import _CheckedReader
    if not base or not 0 < length <= MAX_BYTES or base['sha256'] == sha:
        return '.zst', {}
    with temporary.open('rb') as source, io.BufferedReader(_CheckedReader(source)) as stream:
        payload = stream.read(MAX_BYTES + 1)
    if len(payload) != length or hashlib.sha256(payload).hexdigest() != sha:
        raise ValueError('independent_download_integrity_failure')
    alternate = temporary.with_suffix('.delta.partial')
    try:
        anchor = _base(root, base)
        dictionary = zstandard.ZstdCompressionDict(anchor, dict_type=zstandard.DICT_TYPE_RAWCONTENT)
        packed = zstandard.ZstdCompressor(level=6, dict_data=dictionary, write_checksum=True).compress(payload)
        header = {'schema': 1, 'base': base, 'sha256': sha, 'bytes': length}
        metadata = json.dumps(header, sort_keys=True, separators=(',', ':')).encode()
        encoded = MAGIC + struct.pack('>I', len(metadata)) + metadata + packed
        normal_size = temporary.stat().st_size
        if len(encoded) > normal_size - max(4096, normal_size//10):
            return '.zst', {}
        # The storage stage owns this check. Parsing/OCR receipts are unchanged.
        if zstandard.ZstdDecompressor(dict_data=dictionary).decompress(
                packed, max_output_size=MAX_BYTES, allow_extra_data=False) != payload:
            raise ValueError('edition_delta_roundtrip_failure')
        with alternate.open('wb') as target:
            target.write(encoded)
            target.flush()
            os.fsync(target.fileno())
        os.replace(alternate, temporary)
        return '.zdelta', {'format': 'zstd-edition-delta-v1', 'base': base,
                           'saved_bytes': normal_size-len(encoded)}
    except (OSError, ValueError, KeyError, EOFError, zstandard.ZstdError) as error:
        return '.zst', {'format': 'zstd', 'delta_fallback': f'{type(error).__name__}:{error}',
                        'base': base}
    finally:
        alternate.unlink(missing_ok=True)
