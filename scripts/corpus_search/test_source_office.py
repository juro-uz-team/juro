import base64
import hashlib
import unittest
from source_office import render_office_pdf


class OfficeSourceTests(unittest.TestCase):
    def test_rendered_source_binds_original_bytes_and_pinned_renderer(self):
        original = b'Artificial office fixture'
        pdf = b'%PDF-1.7 artificial complete rendition'
        image = 'sha256:' + 'a' * 64
        calls = []
        def runner(raw, suffix, selected_image):
            calls.append((raw, suffix, selected_image))
            return pdf
        receipt = render_office_pdf(original, 'folder/annex.DOCX', image, runner=runner)
        self.assertEqual(calls, [(original, '.docx', image)])
        self.assertEqual(base64.b64decode(receipt['data_base64']), pdf)
        self.assertEqual(receipt['source_sha256'], hashlib.sha256(original).hexdigest())
        self.assertEqual(receipt['sha256'], hashlib.sha256(pdf).hexdigest())
        self.assertEqual(receipt['renderer_image'], image)

    def test_unpinned_renderer_and_unsupported_inputs_never_start_a_container(self):
        def never(*_args): self.fail('Unexpected rendering')
        for image, name, raw in [('renderer:latest', 'file.doc', b'fixture'),
                                 ('sha256:' + 'a' * 64, 'file.exe', b'fixture'),
                                 ('sha256:' + 'a' * 64, 'file.doc', b'')]:
            with self.assertRaises(ValueError):
                render_office_pdf(raw, name, image, runner=never)

    def test_failed_or_oversize_conversion_is_not_an_evidence_rendition(self):
        for output in [b'', b'Not PDF', b'%PDF-' + b'x' * (16 * 1024 * 1024)]:
            with self.assertRaisesRegex(ValueError, 'office_render_output'):
                render_office_pdf(b'fixture', 'file.doc', 'sha256:' + 'a' * 64,
                                  runner=lambda *_: output)


if __name__ == '__main__':
    unittest.main()
