"""Generation-bound operations for the private prepared-corpus transport.

The application authenticates the text-bearing request before producing numeric
inputs. Its request digest is echoed, not recomputed without the original text.
The transport must authenticate its caller; these operations never activate a
release or infer legal eligibility from a discovery timestamp.
"""
import copy
import calendar
import re
import time

import numpy as np


def digest(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


class PreparedNumericService:
    def __init__(self, release, hybrid, catalog):
        self.release = copy.deepcopy(release)
        configuration = self.release['configuration']
        artifacts = configuration['artifacts']
        actual = {
            'packageSha256': catalog.package.sha256,
            'vectorCompletionSha256': hybrid.vectors.completion_sha256,
            'vectorIdentitySha256': hybrid.profiles.manifest['vector_identity_sha256'],
            'membershipSha256': catalog.memberships.manifest_sha256,
            'workIndexSha256': catalog.works.manifest_sha256,
            'navigationSha256': hybrid.dense.navigation.manifest_sha256,
            'sparseSha256': hybrid.sparse.manifest_sha256,
        }
        if (artifacts != actual or not all(digest(value) for value in actual.values())
                or configuration.get('backend') != 'prepared-corpus-v1'
                or configuration.get('navigationBackend') != 'pgvector'
                or configuration.get('embeddingModel') != 'openai/text-embedding-3-large'
                or configuration.get('dimensions') != 3072
                or configuration.get('evidenceSemantics') != 'discovery-only'
                or self.release.get('environment') not in ('production', 'staging')
                or self.release.get('capability') not in ('current', 'history')
                or not isinstance(self.release.get('id'), str) or not self.release['id']
                or catalog.vectors.completion_sha256 != hybrid.vectors.completion_sha256
                or catalog.vectors.count != hybrid.vectors.count
                or catalog.memberships.manifest_sha256 != hybrid.memberships.manifest_sha256):
            raise ValueError('numeric_service_generation_mismatch')
        # A qualified ranking policy must have a real implementation and paired
        # qualification. Do not silently serve broad fusion under that identity.
        if configuration.get('categoryRanking') != {'mode': 'disabled'}:
            raise ValueError('numeric_service_category_policy_unimplemented')
        self.hybrid, self.catalog = hybrid, catalog

    def search(self, request):
        fields = {'version', 'releaseId', 'environment', 'configuration', 'endpoint',
                  'requestSha256', 'limit', 'embedding', 'termHashes'}
        if (not isinstance(request, dict) or set(request) != fields
                or request['version'] != 'prepared-search-v1'
                or request['releaseId'] != self.release['id']
                or request['environment'] != self.release['environment']
                or request['configuration'] != self.release['configuration']
                or not digest(request['requestSha256'])
                or type(request['limit']) is not int or request['limit'] != 50):
            raise ValueError('numeric_service_request_mismatch')
        endpoint = request['endpoint']
        if self.release['capability'] == 'current':
            if endpoint != {'kind': 'current'}:
                raise ValueError('numeric_service_endpoint_invalid')
        else:
            if (not isinstance(endpoint, dict) or set(endpoint) != {'kind', 'instant'}
                    or endpoint['kind'] != 'timestamp' or not isinstance(endpoint['instant'], str)):
                raise ValueError('numeric_service_endpoint_invalid')
            # Match the application's ISO UTC schema without rounding fractions
            # or normalizing the timestamp used by its request identity.
            match = re.fullmatch(r'([0-9]{4})-([0-9]{2})-([0-9]{2})T(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]+)?)?Z', endpoint['instant'])
            if not match:
                raise ValueError('numeric_service_endpoint_invalid')
            year, month, day = map(int, match.groups())
            if not 1 <= month <= 12 or not 1 <= day <= calendar.monthrange(year, month)[1]:
                raise ValueError('numeric_service_endpoint_invalid')
        embedding, terms = request['embedding'], request['termHashes']
        if (not isinstance(embedding, list) or len(embedding) != 3072
                or any(type(value) not in (int, float) for value in embedding)
                or not isinstance(terms, list) or len(terms) > 64
                or any(not digest(term) for term in terms) or len(set(terms)) != len(terms)):
            raise ValueError('numeric_service_query_invalid')
        values = np.asarray(embedding, dtype=np.float64)
        if not np.isfinite(values).all() or np.max(np.abs(values)) > np.finfo(np.float32).max or not np.any(values.astype(np.float32)):
            raise ValueError('numeric_service_query_invalid')
        hits = self.hybrid.search(values, [bytes.fromhex(term) for term in terms], time.monotonic()+10)
        return {'version': request['version'], 'releaseId': self.release['id'],
                'environment': self.release['environment'], 'requestSha256': request['requestSha256'],
                'configuration': copy.deepcopy(self.release['configuration']),
                'lanes': {'dense': 'complete', 'sparse': 'complete'}, 'hits': hits}

    def read_exact(self, request):
        if (not isinstance(request, dict) or set(request) != {'artifacts', 'references'}
                or request['artifacts'] != self.release['configuration']['artifacts']):
            raise ValueError('numeric_service_catalog_mismatch')
        return self.catalog.read_exact(request['references'])
