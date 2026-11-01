"""Bounded original publisher assets, selected only through retained source records."""
import base64
import hashlib
import io
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from cancellation import check_cancelled

MAX_ASSET_BYTES = 16 * 1024 * 1024


def publisher_url(value):
    if not isinstance(value, str) or len(value) > 4096:
        raise ValueError('source_asset_url_invalid')
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != 'https' or parsed.hostname not in ('lex.uz', 'www.lex.uz')
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise ValueError('source_asset_url_invalid')
    return urllib.parse.urlunsplit(parsed._replace(fragment=''))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def fetch_publisher_asset(url):
    opener = urllib.request.build_opener(_NoRedirect())
    deadline = time.monotonic() + 5
    for _ in range(4):
        check_cancelled()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('source_asset_deadline')
        url = publisher_url(url)
        request = urllib.request.Request(url, headers={'Accept-Encoding': 'identity', 'User-Agent': 'JURO-corpus/1.0'})
        try:
            response = opener.open(request, timeout=min(1, remaining))
        except urllib.error.HTTPError as error:
            if error.code in (301, 302, 303, 307, 308):
                location = error.headers.get('Location')
                error.close()
                if not location:
                    raise ValueError('source_asset_redirect_invalid') from None
                url = urllib.parse.urljoin(url, location)
                continue
            error.close()
            raise ValueError('source_asset_fetch_failed') from None
        with response:
            if response.status != 200 or response.headers.get('Content-Encoding', 'identity') != 'identity':
                raise ValueError('source_asset_response_invalid')
            chunks, size = [], 0
            while True:
                check_cancelled()
                if time.monotonic() >= deadline:
                    raise TimeoutError('source_asset_deadline')
                chunk = response.read1(min(65536, MAX_ASSET_BYTES + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > MAX_ASSET_BYTES:
                    raise ValueError('source_asset_byte_bound')
            check_cancelled()
            return b''.join(chunks)
    raise ValueError('source_asset_redirect_bound')


def verified_bytes(raw, inventory):
    expected = inventory.get('raw_hash')
    if (not isinstance(expected, str) or not re.fullmatch('[a-f0-9]{64}', expected)
            or not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_ASSET_BYTES
            or type(inventory.get('bytes')) is not int or len(raw) != inventory['bytes']
            or hashlib.sha256(raw).hexdigest() != expected):
        raise ValueError('source_asset_identity_mismatch')
    return raw


def read_original_asset(inventory, load_inventory, fetch=fetch_publisher_asset):
    """Return original bytes; this does not claim OCR completeness or legal currentness."""
    check_cancelled()
    if inventory.get('state') != 'done' or inventory.get('kind') not in ('asset', 'member'):
        raise ValueError('source_asset_kind_invalid')
    url = publisher_url(inventory.get('url'))
    if inventory['kind'] == 'asset':
        raw = verified_bytes(fetch(url), inventory)
    else:
        receipt = inventory.get('receipt') or {}
        archive_work = receipt.get('archive_work')
        member_name = receipt.get('member')
        if (not isinstance(archive_work, str) or not re.fullmatch('[a-f0-9]{64}', archive_work)
                or not isinstance(member_name, str) or not 0 < len(member_name) <= 4096):
            raise ValueError('source_asset_member_invalid')
        archive = load_inventory(archive_work)
        if (archive.get('id') != archive_work or archive.get('kind') != 'asset' or archive.get('state') != 'done'
                or publisher_url(archive.get('url')) != url):
            raise ValueError('source_asset_archive_mismatch')
        archive_bytes = verified_bytes(fetch(url), archive)
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as reader:
            members = reader.infolist()
            selected = [member for member in members if member.filename == member_name]
            if (len(members) > 4096 or len(selected) != 1 or selected[0].is_dir()
                    or selected[0].flag_bits & 1 or not 0 < selected[0].file_size <= MAX_ASSET_BYTES):
                raise ValueError('source_asset_member_bound')
            # Never extract to disk; verify the selected member against its retained receipt.
            with reader.open(selected[0]) as source:
                raw = source.read(MAX_ASSET_BYTES + 1)
            raw = verified_bytes(raw, inventory)
    check_cancelled()
    return {'work': inventory['id'], 'source_url': inventory['url'], 'sha256': inventory['raw_hash'],
            'byte_count': len(raw), 'data_base64': base64.b64encode(raw).decode('ascii')}
