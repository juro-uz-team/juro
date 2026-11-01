"""Complete retained source reads independent of search execution and legal decisions.

This service admits an immutable package and work index. It neither creates nor
changes embeddings/indexes, and never promotes acquisition metadata to law.
"""
import copy
import re
from discovery_json import encode_discovery_json
from works import hydrate_records, work_key


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
                 source_references=None):
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
            sources[work] = {'inventory': inventory, 'prepared': record}
        result = {'package_sha256': self.package.sha256, 'work_index_sha256': self.works.manifest_sha256,
                  'sources': sources}
        if reference_status is not None:
            result['reference_status'] = reference_status
        if len(encode_discovery_json(result)) > maximum:
            raise ValueError('source_service_response_bound')
        return result

