import base64
import hashlib
import io
import unittest
import zipfile
from source_assets import read_original_asset, publisher_url, MAX_ASSET_BYTES


def record(raw, **fields):
    return {'id': 'a' * 64, 'kind': 'asset', 'state': 'done', 'url': 'https://lex.uz/files/fixture.pdf',
            'bytes': len(raw), 'raw_hash': hashlib.sha256(raw).hexdigest(), **fields}


class SourceAssetTests(unittest.TestCase):
    def test_exact_original_pdf_is_returned_without_text_substitution(self):
        raw = b'%PDF-artificial fixture with visual source content'
        result = read_original_asset(record(raw), lambda _: self.fail('No archive required'), lambda _: raw)
        self.assertEqual(base64.b64decode(result['data_base64']), raw)
        self.assertEqual(result['byte_count'], len(raw))
        self.assertEqual(result['sha256'], hashlib.sha256(raw).hexdigest())

    def test_changed_publisher_bytes_are_not_accepted_as_the_retained_source(self):
        with self.assertRaisesRegex(ValueError, 'identity_mismatch'):
            read_original_asset(record(b'original'), lambda _: None, lambda _: b'modified')

    def test_archive_member_requires_both_archive_and_member_identity(self):
        stream = io.BytesIO()
        raw = b'Artificial complete office file'
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('folder/fixture.doc', raw)
        packed = stream.getvalue()
        url = 'https://lex.uz/files/fixture.zip'
        parent = record(packed, id='b' * 64, url=url)
        member = record(raw, kind='member', url=url+'#member:0',
                        receipt={'archive_work': parent['id'], 'member': 'folder/fixture.doc'})
        result = read_original_asset(member, lambda work: parent if work == parent['id'] else None, lambda _: packed)
        self.assertEqual(base64.b64decode(result['data_base64']), raw)
        for invalid in [{**parent, 'raw_hash': '0' * 64}, {**parent, 'url': 'https://lex.uz/files/other.zip'}]:
            with self.assertRaises(ValueError):
                read_original_asset(member, lambda _: invalid, lambda _: packed)
        with self.assertRaisesRegex(ValueError, 'identity_mismatch'):
            read_original_asset({**member, 'raw_hash': '0' * 64}, lambda _: parent, lambda _: packed)

    def test_only_official_https_urls_are_fetchable(self):
        for url in ['http://lex.uz/file', 'https://foreign.test/file', 'https://lex.uz@localhost/file',
                    'https://lex.uz:444/file', 'file:///source', None]:
            with self.assertRaises(ValueError):publisher_url(url)
        self.assertEqual(publisher_url('https://lex.uz/files/source.zip#member:0'), 'https://lex.uz/files/source.zip')

    def test_unsupported_inventory_is_rejected_before_network(self):
        for changes in [{'kind': 'document'}, {'state': 'excluded'}]:
            with self.assertRaisesRegex(ValueError, 'kind_invalid'):
                read_original_asset(record(b'fixture', **changes), lambda _: None, lambda _: self.fail('Unexpected fetch'))

    def test_oversize_source_cannot_escape_transport_bound(self):
        raw = b'x' * (MAX_ASSET_BYTES + 1)
        with self.assertRaisesRegex(ValueError, 'identity_mismatch'):
            read_original_asset(record(raw), lambda _: None, lambda _: raw)


if __name__ == '__main__':
    unittest.main()
