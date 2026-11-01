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
from discovery_chunks import chunk_part_order
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
from native_navigation import NativeNavigationGeneration,artifact_reference
from works import signature

PATHS = {'package', 'vectors', 'identities', 'works', 'memberships', 'profiles', 'sparse', 'navigation'}


def validate_pgvector_execution(value):
    fields = {'sourceProjection', 'requestWorkers', 'maxPending', 'readWorkers'}
    if (not isinstance(value, dict) or not fields <= set(value)
            or set(value)-fields-{'sparseKernel', 'membershipPageNavigation'}
            or not artifact_reference(value['sourceProjection'])
            or ('sparseKernel' in value and not artifact_reference(value['sparseKernel']))
            or type(value.get('membershipPageNavigation', False)) is not bool
            or type(value['requestWorkers']) is not int or not 1 <= value['requestWorkers'] <= 4
            or type(value['maxPending']) is not int or not 1 <= value['maxPending'] <= 32
            or type(value['readWorkers']) is not int or value['readWorkers'] not in (1, 2, 4, 8)):
        raise ValueError('prepared_worker_execution_invalid')


def validate_native_execution(value):
    fields={'binaryKernel','sparseKernel','sourceProjection','requestWorkers','maxPending',
            'readWorkers','projectionReadWorkers','parallelLanes','rawReadMode','membershipPageNavigation'}
    if (not isinstance(value,dict) or not fields<=set(value) or set(value)-fields-{'sparseProcessWorkers','sourceLocations'}
            or not all(artifact_reference(value[key]) for key in ('binaryKernel','sparseKernel','sourceProjection'))
            or ('sourceLocations' in value and not artifact_reference(value['sourceLocations']))
            or type(value['requestWorkers']) is not int or not 1<=value['requestWorkers']<=4
            or type(value['maxPending']) is not int or not 1<=value['maxPending']<=32
            or type(value['readWorkers']) is not int or value['readWorkers'] not in (1,2,4,8)
            or type(value['projectionReadWorkers']) is not int or value['projectionReadWorkers'] not in (1,2,4,8,16,32)
            or type(value['parallelLanes']) is not bool or type(value['membershipPageNavigation']) is not bool
            or type(value.get('sparseProcessWorkers',0)) is not int
            or not 0<=value.get('sparseProcessWorkers',0)<=4
            or value['rawReadMode'] not in ('mapped','positioned')):
        raise ValueError('prepared_worker_execution_invalid')


def read_worker_manifest(path, pin):
    path = pathlib.Path(path)
    if (not isinstance(pin, str) or not re.fullmatch('[a-f0-9]{64}', pin)
            or path.is_symlink() or path.stat().st_size > 65536):
        raise ValueError('prepared_worker_manifest_invalid')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != pin:
        raise ValueError('prepared_worker_manifest_mismatch')
    spec = json.loads(raw, object_pairs_hook=unique_object)
    native=isinstance(spec,dict) and spec.get('format')=='prepared-numeric-worker-v2'
    concurrent_pgvector=isinstance(spec,dict) and spec.get('format')=='prepared-numeric-worker-v3'
    fields={'format','release','paths','profilesSha256','analyzerSha256','candidates',
            'execution' if native else 'probes'}
    if concurrent_pgvector:fields.add('execution')
    if isinstance(spec,dict) and 'trustPrepared' in spec:
        fields.add('trustPrepared')
        if type(spec['trustPrepared']) is not bool or (spec['trustPrepared'] and not concurrent_pgvector):
            raise ValueError('prepared_worker_trust_policy_invalid')
    if (not isinstance(spec, dict) or set(spec) != fields
            or spec['format'] not in ('prepared-numeric-worker-v1','prepared-numeric-worker-v2','prepared-numeric-worker-v3')
            or not isinstance(spec['paths'], dict) or set(spec['paths']) != PATHS
            or any(not isinstance(value, str) or not pathlib.Path(value).is_absolute() for value in spec['paths'].values())
            or any(not isinstance(spec[key], str) or not re.fullmatch('[a-f0-9]{64}', spec[key])
                   for key in ['profilesSha256', 'analyzerSha256'])
            or (not native and (type(spec['probes']) is not int or not 1 <= spec['probes'] <= 32768))
            or type(spec['candidates']) is not int or not 50 <= spec['candidates'] <= 20000):
        raise ValueError('prepared_worker_manifest_invalid')
    if native:validate_native_execution(spec['execution'])
    if concurrent_pgvector:validate_pgvector_execution(spec['execution'])
    release = spec['release']
    if not isinstance(release, dict) or not isinstance(release.get('configuration'), dict):
        raise ValueError('prepared_worker_release_invalid')
    if release['configuration'].get('navigationBackend')!=('binary-projected' if native else 'pgvector'):
        raise ValueError('prepared_worker_navigation_backend_mismatch')
    pins = release['configuration'].get('artifacts')
    if (not isinstance(pins, dict) or set(pins) != {'packageSha256', 'vectorCompletionSha256',
            'vectorIdentitySha256', 'membershipSha256', 'workIndexSha256', 'navigationSha256', 'sparseSha256'}
            or any(not isinstance(pin, str) or not re.fullmatch('[a-f0-9]{64}', pin) for pin in pins.values())):
        raise ValueError('prepared_worker_release_invalid')
    return spec


@contextmanager
def open_worker(spec, connect, *, sparse_kernel=None, source_projection=None, source_projection_sha256=None,
                raw_read_mode='mapped',membership_page_navigation=False):
    """Open the selected generation under its explicit preparation trust policy."""
    paths = spec['paths']
    pins = spec['release']['configuration']['artifacts']
    execution=spec.get('execution') if spec.get('format')=='prepared-numeric-worker-v2' else None
    pgvector_execution=spec.get('execution') if spec.get('format')=='prepared-numeric-worker-v3' else None
    trusted=spec.get('trustPrepared',False)
    if type(trusted) is not bool or (trusted and pgvector_execution is None):
        raise ValueError('prepared_worker_trust_policy_invalid')
    policy={'trust_prepared':True} if trusted else {}
    kernel_identities=[]
    def authenticate_kernel(reference):
        path=pathlib.Path(reference['path'])
        if path.is_symlink():raise ValueError('prepared_worker_kernel_invalid')
        before=signature(path)
        with path.open('rb') as source:actual=hashlib.file_digest(source,'sha256').hexdigest()
        if actual!=reference['sha256'] or signature(path)!=before:
            raise ValueError('prepared_worker_kernel_mismatch')
        kernel_identities.append((path,before))
    if pgvector_execution is not None:
        validate_pgvector_execution(pgvector_execution)
        if (sparse_kernel is not None or source_projection is not None or source_projection_sha256 is not None
                or raw_read_mode!='mapped' or membership_page_navigation is not False):
            raise ValueError('prepared_worker_execution_override')
        source_projection=pgvector_execution['sourceProjection']['path']
        source_projection_sha256=pgvector_execution['sourceProjection']['sha256']
        membership_page_navigation=pgvector_execution.get('membershipPageNavigation',False)
        if 'sparseKernel' in pgvector_execution:
            authenticate_kernel(pgvector_execution['sparseKernel'])
            sparse_kernel=pgvector_execution['sparseKernel']['path']
    if execution is not None:
        validate_native_execution(execution)
        if (sparse_kernel is not None or source_projection is not None or source_projection_sha256 is not None
                or raw_read_mode!='mapped' or membership_page_navigation is not False):
            raise ValueError('prepared_worker_execution_override')
        for key in ('binaryKernel','sparseKernel'):
            authenticate_kernel(execution[key])
        sparse_kernel=execution['sparseKernel']['path']
        source_projection=execution['sourceProjection']['path']
        source_projection_sha256=execution['sourceProjection']['sha256']
        raw_read_mode=execution['rawReadMode'];membership_page_navigation=execution['membershipPageNavigation']
    with ExitStack() as resources:
        if execution is None:
            generation = PgvectorGeneration(paths['navigation'], pins['navigationSha256'],**policy)
            navigation = generation.navigation(connect, spec['probes'])
            if generation.manifest['completion_sha256'] != pins['vectorCompletionSha256']:
                raise ValueError('prepared_worker_vector_generation_mismatch')
        else:
            generation=NativeNavigationGeneration(paths['navigation'],pins['navigationSha256'],
                pins['vectorCompletionSha256'],spec['candidates'])
            kernel=execution['binaryKernel']
            navigation=resources.enter_context(generation.open(kernel['path'],kernel['sha256'],
                read_workers=execution['projectionReadWorkers']))
        navigation.assert_unchanged()
        package = PreparedPackage(paths['package'], pins['packageSha256'],**policy)
        if trusted and source_projection is None:raise ValueError('prepared_worker_retained_projection_required')
        if (source_projection is None)!=(source_projection_sha256 is None):
            raise ValueError('prepared_worker_source_projection_pin_required')
        if source_projection is not None:
            from source_projection import SourceProjection
            package.source_projection=resources.enter_context(closing(SourceProjection(
                source_projection,source_projection_sha256,package,**policy)))
        vectors = resources.enter_context(closing(VectorPool(paths['vectors'], pins['vectorCompletionSha256'],
            raw_read_mode=raw_read_mode,**policy)))
        if trusted:vectors.open_retained()
        else:vectors.verify_all()
        identities = resources.enter_context(closing(VectorIdentityIndex(paths['identities'],
            pins['vectorIdentitySha256'], pins['vectorCompletionSha256'],**policy)))
        if identities.manifest['rows'] != vectors.count:
            raise ValueError('prepared_worker_vector_population_mismatch')
        works = resources.enter_context(closing(WorkIndex(paths['works'], pins['workIndexSha256'], pins['packageSha256'],**policy)))
        memberships = MembershipIndex(paths['memberships'], pins['membershipSha256'],
            page_navigation=membership_page_navigation,**policy)
        profiles = resources.enter_context(closing(SparseProfiles(paths['profiles'], spec['profilesSha256'],
            pins['packageSha256'], pins['vectorIdentitySha256'],**policy)))
        # The pinned profile publisher verified every chunk/member join in this
        # order. Keep membership ordinals stable when physical shards differ.
        package.chunk_parts=profiles.manifest.get('chunk_parts')
        chunk_part_order(package)
        sparse = resources.enter_context(closing(SparseIndex(paths['sparse'], pins['sparseSha256'],
            spec['profilesSha256'], spec['analyzerSha256'], kernel_path=sparse_kernel,**policy)))
        if execution is not None and execution.get('sparseProcessWorkers',0):
            from sparse_processes import isolated_sparse
            resources.enter_context(isolated_sparse(sparse,workers=execution['sparseProcessWorkers']))
        catalog = PreparedDiscoveryCatalog(package, vectors, memberships, works)
        dense = resources.enter_context(closing(DenseSearch(navigation, vectors, spec['candidates'],
            read_workers=(execution or pgvector_execution or {}).get('readWorkers',1))))
        hybrid = PreparedHybridSearch(dense, sparse, profiles, memberships)
        service = PreparedNumericService(spec['release'], hybrid, catalog)
        if execution is not None and 'sourceLocations' in execution:
            from source_locations import SourceLocations
            location=execution['sourceLocations']
            service.source_locations=resources.enter_context(SourceLocations(
                location['path'],location['sha256'],package.sha256))
        # Building the complete reader graph may take minutes. Fence navigation
        # again before listening, rather than relying on its initial check.
        navigation.assert_unchanged()
        if execution is not None:
            generation.assert_unchanged()
        if any(path.is_symlink() or signature(path)!=identity for path,identity in kernel_identities):
            raise ValueError('prepared_worker_kernel_changed')
        if source_projection is not None:package.source_projection.assert_unchanged()
        yield service


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    parser.add_argument('sha256')
    parser.add_argument('port', type=int)
    parser.add_argument('--sparse-kernel', help='Qualified compiled sparse kernel shared library')
    parser.add_argument('--source-projection', help='Authenticated source block projection directory')
    parser.add_argument('--source-projection-sha256', help='Pinned source projection manifest SHA256')
    args = parser.parse_args()
    try:
        spec = read_worker_manifest(args.manifest, args.sha256)
        token = os.environ['JURO_PREPARED_TRANSPORT_TOKEN']
        if not 1 <= args.port <= 65535 or not re.fullmatch(r'[!-~]{32,256}', token):
            raise ValueError('prepared_worker_transport_invalid')
        def connect():
            import psycopg
            return psycopg.connect(os.environ['JURO_PREPARED_DATABASE_URL'], autocommit=True, connect_timeout=5)
        with open_worker(spec, connect, sparse_kernel=args.sparse_kernel,
                         source_projection=args.source_projection,
                         source_projection_sha256=args.source_projection_sha256) as service:
            pool={}
            if spec['format'] in ('prepared-numeric-worker-v2','prepared-numeric-worker-v3'):
                from worker_readers import open_worker_reader
                execution=spec['execution']
                pool={'service_factory':lambda:open_worker_reader(service,read_workers=execution['readWorkers'],
                    parallel_lanes=execution.get('parallelLanes',False)),
                    'workers':execution['requestWorkers'],'max_pending':execution['maxPending']}
            with create_numeric_http_server(service, token, args.port, manifest_sha256=args.sha256,**pool) as server:
                print(json.dumps({'event': 'prepared_numeric_ready', 'manifestSha256': args.sha256}), flush=True)
                server.serve_forever()
    except Exception as error:
        # Connection/reader errors can contain credentials or source excerpts.
        print(json.dumps({'event': 'prepared_numeric_unavailable', 'kind': type(error).__name__}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
