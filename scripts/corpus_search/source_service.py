"""Complete retained source reads independent of search execution and legal decisions.

This service admits an immutable package and work index. It neither creates nor
changes embeddings/indexes, and never promotes acquisition metadata to law.
"""
import copy
import re
from urllib.parse import parse_qs, urlsplit
from discovery_json import encode_discovery_json
from source_assets import publisher_url
from works import hydrate_records, work_key


def pdf_link(value):
    try:
        url = publisher_url(value)
        parsed = urlsplit(url)
        path = parsed.path.lower()
        uploaded_pdf = path == '/pages/getpdf.aspx' and any(
            name.lower().endswith('.pdf') for name in parse_qs(parsed.query).get('file', []))
        return url if re.fullmatch(r'/(?:pdffile|pdfs)/-?\d+', path) or path.endswith('.pdf') or uploaded_pdf else None
    except ValueError:
        return None


def file_backed(unit):
    return bool(unit.get('attachmentOrigin')) or str(unit.get('method', '')).startswith(
        ('pdf_', 'rapidocr-', 'tesseract-', 'ocr')) or str(unit.get('locator', '')).startswith('page:')


def pdf_presentation(inventory, prepared):
    wrapper = pdf_link(inventory.get('capture_url') or inventory.get('url'))
    assets = [(url, item.get('locator')) for item in prepared.get('discoveries', [])
              if item.get('kind') == 'asset' and (url := pdf_link(item.get('url')))]
    direct = next((url for url, locator in assets if locator == 'pdf-viewer'), None)
    units = prepared.get('units', [])
    has_text = any(unit.get('text') and not file_backed(unit) for unit in units)
    origins = [url for unit in units if (url := pdf_link((unit.get('attachmentOrigin') or {}).get('url')))]
    links = list(dict.fromkeys([*(url for url, _ in assets), *origins]))
    if wrapper or (not has_text and (links or any(file_backed(unit) for unit in units))):
        primary = direct or (links[0] if len(links) == 1 else wrapper or inventory['url'])
        return {'pdfUrl': primary, 'pdfLinks': [url for url in links if url != primary]}
    return {'pdfLinks': links} if links else {}


class PreparedSourceService:
    ARTIFACTS = frozenset(('packageSha256', 'vectorCompletionSha256', 'vectorIdentitySha256',
                          'membershipSha256', 'workIndexSha256', 'navigationSha256', 'sparseSha256'))
    # The shared private HTTP transport exposes only implemented operations.
    search = None
    read_exact = None
    # Original files are consumed from stored citation artifacts by the app.
    # This source listener cannot fetch publishers or render new corpus assets.
    read_asset = None

    def __init__(self, package, works, artifacts, office_image=None, source_rows=None,
                 source_references=None, browser=None):
        if (not isinstance(artifacts, dict) or set(artifacts) != self.ARTIFACTS
                or any(not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value)
                       for value in artifacts.values())
                or artifacts['packageSha256'] != package.sha256
                or artifacts['workIndexSha256'] != works.manifest_sha256):
            raise ValueError('source_service_generation_mismatch')
        self.package, self.works = package, works
        self.artifacts = copy.deepcopy(artifacts)
        if office_image is not None and (not isinstance(office_image, str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', office_image)):
            raise ValueError('source_service_renderer_invalid')
        self.office_image = office_image
        self.source_rows = source_rows
        if source_references is not None and source_references.package_sha256 != package.sha256:
            raise ValueError('source_reference_package_mismatch')
        self.source_references = source_references
        self.browser = browser

    def browse_sources(self, request):
        if (not isinstance(request, dict) or request.get('artifacts') != self.artifacts
                or self.browser is None):
            raise ValueError('source_catalog_generation')
        with self.browser.open() as catalog:
            if set(request) == {'artifacts', 'query', 'language', 'category', 'page'}:
                return catalog.search(request['query'], request['language'], request['category'], request['page'])
            if set(request) != {'artifacts', 'work', 'offset'}:
                raise ValueError('source_catalog_request')
            work, offset = request['work'], request['offset']
            if (not isinstance(work, str) or not re.fullmatch('[a-f0-9]{64}', work)
                    or type(offset) is not int or not 0 <= offset <= 1_000_000):
                raise ValueError('source_catalog_request')
            selected = catalog.source(work)
            if selected is None:
                return {'entry': None, 'units': [], 'nextOffset': None}
            plan, total = catalog.reading_plan(work, offset, 24)
        locations = self.works.lookup([work_key(key) for key, _, _ in plan])
        if any(not row or not row['prepared'] for row in locations):
            raise ValueError('source_catalog_identity')
        records = self.read_records('prepared', [row['prepared'] for row in locations], 128 * 1024 * 1024)
        root = self.works.lookup([work_key(work)])[0]
        inventory, = self.read_records('inventory', [root['inventory']], 32 * 1024 * 1024)
        prepared = next((item for item in records if item.get('work') == work), None)
        if prepared is None:
            prepared, = self.read_records('prepared', [root['prepared']], 128 * 1024 * 1024)
        units, gaps = [], False
        for (key, start, count), record in zip(plan, records, strict=True):
            if record.get('work') != key or len(record['units']) < start + count:
                raise ValueError('source_catalog_identity')
            gaps |= bool(record.get('gaps'))
            units.extend({'text': unit['text'], 'locator': str(unit.get('locator') or ''),
                          'fileBacked': key != work or file_backed(unit)}
                         for unit in record['units'][start:start+count] if isinstance(unit.get('text'), str))
        return {'entry': selected, 'units': units, 'nextOffset': offset + 24 if offset + 24 < total else None,
                'extractionGaps': gaps, **pdf_presentation(inventory, prepared)}

    def read_records(self, kind, locations, maximum):
        if self.source_rows is not None:
            return self.source_rows.read(kind, locations, maximum)
        return hydrate_records(self.package, kind, locations, max_total_bytes=maximum)

    def read_sources(self, request):
        if not isinstance(request, dict) or set(request) not in ({'artifacts', 'works'}, {'artifacts', 'reference'}):
            raise ValueError('source_service_request_invalid')
        if request['artifacts'] != self.artifacts:
            raise ValueError('source_service_generation_mismatch')
        reference_status = None
        if 'reference' in request:
            reference = request['reference']
            if not isinstance(reference, dict) or set(reference) != {'url', 'scope'}:
                raise ValueError('source_reference_request_invalid')
            if self.source_references is None:
                raise ValueError('source_reference_inventory_unavailable')
            reference_status, work = self.source_references.resolve(reference['url'], reference['scope'])
            if work is None:
                return {'package_sha256': self.package.sha256, 'work_index_sha256': self.works.manifest_sha256,
                        'sources': {}, 'reference_status': reference_status}
            works = [work]
        else:
            works = request['works']
        if (not isinstance(works, list) or not 1 <= len(works) <= 8
                or any(not isinstance(work, str) or not work or len(work.encode()) > 4096 for work in works)
                or len(set(works)) != len(works)):
            raise ValueError('source_service_request_bound')
        locations = self.works.lookup([work_key(work) for work in works])
        if any(location is None or location['work'] != work for work, location in zip(works, locations)):
            raise ValueError('source_service_source_missing')
        maximum = 32 * 1024 * 1024
        inventories = self.read_records('inventory', [row['inventory'] for row in locations], maximum)
        prepared = iter(self.read_records('prepared',
            [row['prepared'] for row in locations if row['prepared'] is not None], maximum))
        sources = {}
        for work, inventory, location in zip(works, inventories, locations):
            record = next(prepared) if location['prepared'] is not None else None
            if inventory.get('id') != work or (record is not None and record.get('work') != work):
                raise ValueError('source_service_identity_mismatch')
            sources[work] = {'inventory': inventory, 'prepared': record,
                             **(pdf_presentation(inventory, record) if record and inventory.get('kind') == 'document' else {})}
        result = {'package_sha256': self.package.sha256, 'work_index_sha256': self.works.manifest_sha256,
                  'sources': sources}
        if reference_status is not None:
            result['reference_status'] = reference_status
        if len(encode_discovery_json(result)) > maximum:
            raise ValueError('source_service_response_bound')
        return result

