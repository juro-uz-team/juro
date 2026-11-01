"""Serve complete immutable corpus sources on a private, separately pinned listener.

No database credentials, provider calls, index writes or activation operations.
The existing numeric worker can continue serving candidate discovery unchanged.
"""
import argparse
import copy
import hashlib
import json
import os
import pathlib
import re
import sqlite3
from contextlib import closing, contextmanager, ExitStack
from numeric_http import create_numeric_http_server, unique_object
from source_service import PreparedSourceService
from trusted_source_storage import TrustedSourceProjection, TrustedWorkIndex
from source_rows import SourceRows
from source_references import SourceReferences


def read_manifest(path, pin):
    path = pathlib.Path(path)
    if (not re.fullmatch('[a-f0-9]{64}', pin) or path.is_symlink()
            or path.stat().st_size > 65536):
        raise ValueError('source_worker_manifest_invalid')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != pin:
        raise ValueError('source_worker_manifest_mismatch')
    spec = json.loads(raw, object_pairs_hook=unique_object)
    if (not isinstance(spec, dict) or set(spec) - {'officeImage', 'sourceProjection'} != {'format', 'paths', 'artifacts', 'workers', 'maxPending'}
            or spec['format'] != 'prepared-source-worker-v1'
            or not isinstance(spec['paths'], dict) or set(spec['paths']) != {'package', 'works'}
            or any(not isinstance(value, str) or not pathlib.Path(value).is_absolute() for value in spec['paths'].values())
            or not isinstance(spec['artifacts'], dict) or set(spec['artifacts']) != PreparedSourceService.ARTIFACTS
            or any(not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value) for value in spec['artifacts'].values())
            or type(spec['workers']) is not int or not 1 <= spec['workers'] <= 4
            or type(spec['maxPending']) is not int or not 1 <= spec['maxPending'] <= 32
            or ('officeImage' in spec and (not isinstance(spec['officeImage'], str)
                or not re.fullmatch(r'sha256:[a-f0-9]{64}', spec['officeImage'])))):
        raise ValueError('source_worker_manifest_invalid')
    projection = spec.get('sourceProjection')
    if projection is not None and (not isinstance(projection, dict) or set(projection) != {'path', 'sha256'}
            or not isinstance(projection['path'], str) or not pathlib.Path(projection['path']).is_absolute()
            or not isinstance(projection['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', projection['sha256'])):
        raise ValueError('source_worker_projection_invalid')
    return spec


@contextmanager
def open_reader(owner):
    works = owner.works
    with closing(sqlite3.connect(works.path.as_uri() + '?mode=ro&immutable=1', uri=True)) as connection:
        connection.execute('PRAGMA query_only=ON')
        connection.execute('PRAGMA cache_size=-8192')
        local = copy.copy(works)
        local.connection = connection
        yield PreparedSourceService(owner.package, local, owner.artifacts, office_image=owner.office_image,
                                    source_rows=owner.source_rows,
                                    source_references=owner.source_references)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    parser.add_argument('sha256')
    parser.add_argument('port', type=int)
    args = parser.parse_args()
    spec = read_manifest(args.manifest, args.sha256)
    if not 1 <= args.port <= 65535:
        raise ValueError('source_worker_port_invalid')
    with ExitStack() as resources:
        projection = spec.get('sourceProjection')
        if projection is None:
            raise ValueError('source_worker_stored_projection_required')
        package = TrustedSourceProjection(projection['path'], spec['artifacts']['packageSha256'])
        works = resources.enter_context(closing(TrustedWorkIndex(spec['paths']['works'],
            spec['artifacts']['workIndexSha256'], package.sha256)))
        references = SourceReferences(package)
        rows = SourceRows(package)
        owner = PreparedSourceService(package, works, spec['artifacts'], office_image=spec.get('officeImage'),
                                      source_rows=rows, source_references=references)
        server = resources.enter_context(closing(create_numeric_http_server(owner,
            os.environ['JURO_PREPARED_TRANSPORT_TOKEN'], args.port, manifest_sha256=args.sha256,
            service_factory=lambda: open_reader(owner), workers=spec['workers'], max_pending=spec['maxPending'])))
        print(json.dumps({'event': 'listening', 'manifestSha256': args.sha256, 'port': server.server_port}), flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
