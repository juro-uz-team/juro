"""Start one private, generation-pinned prepared numeric worker.

Run from a checkout: python scripts/corpus_search/worker.py MANIFEST SHA256 PORT
Database credentials and the loopback token come only from the environment.
Listening proves artifact admission, not retrieval qualification or activation;
the application must separately admit the release before routing user traffic.
"""
import argparse
from contextlib import ExitStack, contextmanager, closing
import hashlib
import json
import os
import pathlib
import re
import sys

# Existing preserved-coordinate readers share the repository's batch codecs.
if __name__ == '__main__':
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from dense_search import DenseSearch
from discovery_catalog import PreparedDiscoveryCatalog
from hybrid_search import PreparedHybridSearch
from membership import MembershipIndex
from numeric_http import create_numeric_http_server, unique_object
from numeric_service import PreparedNumericService
from package import PreparedPackage
from pgvector_generation import PgvectorGeneration
from sparse_profiles import SparseProfiles
from sparse_search import SparseIndex
from vector_identity import VectorIdentityIndex
from vectors import VectorPool
from works import WorkIndex

PATHS = {'package', 'vectors', 'identities', 'works', 'memberships', 'profiles', 'sparse', 'navigation'}


def read_worker_manifest(path, pin):
    path = pathlib.Path(path)
    if (not isinstance(pin, str) or not re.fullmatch('[a-f0-9]{64}', pin)
            or path.is_symlink() or path.stat().st_size > 65536):
        raise ValueError('prepared_worker_manifest_invalid')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != pin:
        raise ValueError('prepared_worker_manifest_mismatch')
    spec = json.loads(raw, object_pairs_hook=unique_object)
    if (not isinstance(spec, dict) or set(spec) != {'format', 'release', 'paths', 'profilesSha256',
            'analyzerSha256', 'probes', 'candidates'} or spec['format'] != 'prepared-numeric-worker-v1'
            or not isinstance(spec['paths'], dict) or set(spec['paths']) != PATHS
            or any(not isinstance(value, str) or not pathlib.Path(value).is_absolute() for value in spec['paths'].values())
            or any(not isinstance(spec[key], str) or not re.fullmatch('[a-f0-9]{64}', spec[key])
                   for key in ['profilesSha256', 'analyzerSha256'])
            or type(spec['probes']) is not int or not 1 <= spec['probes'] <= 32768
            or type(spec['candidates']) is not int or not 50 <= spec['candidates'] <= 20000):
        raise ValueError('prepared_worker_manifest_invalid')
    release = spec['release']
    if not isinstance(release, dict) or not isinstance(release.get('configuration'), dict):
        raise ValueError('prepared_worker_release_invalid')
    pins = release['configuration'].get('artifacts')
    if (not isinstance(pins, dict) or set(pins) != {'packageSha256', 'vectorCompletionSha256',
            'vectorIdentitySha256', 'membershipSha256', 'workIndexSha256', 'navigationSha256', 'sparseSha256'}
            or any(not isinstance(pin, str) or not re.fullmatch('[a-f0-9]{64}', pin) for pin in pins.values())):
        raise ValueError('prepared_worker_release_invalid')
    return spec


@contextmanager
def open_worker(spec, connect):
    """Authenticate every dependency before exposing any HTTP listener."""
    paths = spec['paths']
    pins = spec['release']['configuration']['artifacts']
    with ExitStack() as resources:
        generation = PgvectorGeneration(paths['navigation'], pins['navigationSha256'])
        navigation = generation.navigation(connect, spec['probes'])
        navigation.assert_unchanged()
        if generation.manifest['completion_sha256'] != pins['vectorCompletionSha256']:
            raise ValueError('prepared_worker_vector_generation_mismatch')
        package = PreparedPackage(paths['package'], pins['packageSha256'])
        vectors = resources.enter_context(closing(VectorPool(paths['vectors'], pins['vectorCompletionSha256'])))
        vectors.verify_all()
        identities = resources.enter_context(closing(VectorIdentityIndex(paths['identities'],
            pins['vectorIdentitySha256'], pins['vectorCompletionSha256'])))
        if identities.manifest['rows'] != vectors.count:
            raise ValueError('prepared_worker_vector_population_mismatch')
        works = resources.enter_context(closing(WorkIndex(paths['works'], pins['workIndexSha256'], pins['packageSha256'])))
        memberships = MembershipIndex(paths['memberships'], pins['membershipSha256'])
        profiles = resources.enter_context(closing(SparseProfiles(paths['profiles'], spec['profilesSha256'],
            pins['packageSha256'], pins['vectorIdentitySha256'])))
        sparse = resources.enter_context(closing(SparseIndex(paths['sparse'], pins['sparseSha256'],
            spec['profilesSha256'], spec['analyzerSha256'])))
        catalog = PreparedDiscoveryCatalog(package, vectors, memberships, works)
        hybrid = PreparedHybridSearch(DenseSearch(navigation, vectors, spec['candidates']), sparse, profiles, memberships)
        service = PreparedNumericService(spec['release'], hybrid, catalog)
        # Building the complete reader graph may take minutes. Fence navigation
        # again before listening, rather than relying on its initial check.
        navigation.assert_unchanged()
        yield service


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    parser.add_argument('sha256')
    parser.add_argument('port', type=int)
    args = parser.parse_args()
    try:
        import psycopg
        spec = read_worker_manifest(args.manifest, args.sha256)
        dsn = os.environ['JURO_PREPARED_DATABASE_URL']
        token = os.environ['JURO_PREPARED_TRANSPORT_TOKEN']
        if not 1 <= args.port <= 65535 or not re.fullmatch(r'[!-~]{32,256}', token):
            raise ValueError('prepared_worker_transport_invalid')
        def connect():
            return psycopg.connect(dsn, autocommit=True, connect_timeout=5)
        with open_worker(spec, connect) as service:
            with create_numeric_http_server(service, token, args.port, manifest_sha256=args.sha256) as server:
                print(json.dumps({'event': 'prepared_numeric_ready', 'manifestSha256': args.sha256}), flush=True)
                server.serve_forever()
    except Exception as error:
        # Connection/reader errors can contain credentials or source excerpts.
        print(json.dumps({'event': 'prepared_numeric_unavailable', 'kind': type(error).__name__}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
