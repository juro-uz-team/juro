"""Build immutable current/history release candidates from a maintenance package."""
import argparse
from contextlib import closing, ExitStack
import hashlib
import json
import math
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from package import PreparedPackage, file_hash
from pgvector_copy import encode_copy
from pgvector_generation import GUARD_BODY, GUARD_NAME, identifier, inspect_generation
from publish_membership import publish_memberships
from publish_sparse_index import publish_sparse_index
from source_browser import SourceBrowser, build_catalog
from source_references import capture
from source_projection import publish as publish_source_projection
from sparse_profiles import SparseProfiles, publish_sparse_profiles
from sparse_tokenization import ProductionTokenizer, tokenize_profiles
from vector_identity import VectorIdentityIndex, publish_vector_identities
from vectors import VectorPool
from works import WorkIndex, build_work_index

PLATFORM = Path(__file__).resolve().parents[2] / 'apps/platform'


def write_json(path, value):
    raw = (json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n').encode()
    with path.open('xb') as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    return hashlib.sha256(raw).hexdigest()


def publish_navigation(connection, vectors, destination, reader_role):
    schema = 'storage'
    reader = identifier(reader_role)
    table = 'corpus_delta_' + vectors.completion_sha256[:32]
    index = table + '_idx'
    relation = identifier(schema) + '.' + identifier(table)
    function = identifier(schema) + '.' + identifier(table + '_guard')
    lists = max(1, min(512, math.isqrt(vectors.count) // 4))
    with connection.transaction(), connection.cursor() as cursor:
        checksum = hashlib.sha256()
        cursor.execute('SELECT to_regclass(%s)', (relation,))
        if cursor.fetchone()[0] is not None:
            # Compare the sealed derivative to the accepted original coordinates
            # before reusing an import that survived a partial filesystem build.
            observed = inspect_generation(cursor, schema, table, index, lists)
            for block in encode_copy(_coordinate_rows(vectors), 'bit'):
                checksum.update(block)
            readback = hashlib.sha256()
            with cursor.copy(f'COPY (SELECT id,v FROM {relation} ORDER BY id) TO STDOUT (FORMAT BINARY)') as reader_stream:
                for block in reader_stream:
                    readback.update(block)
            if readback.digest() != checksum.digest():
                raise ValueError('maintenance_navigation_reuse_mismatch')
        else:
            cursor.execute(f'CREATE TABLE {relation}(id bigint NOT NULL PRIMARY KEY, v bit(3072) NOT NULL)')
            with cursor.copy(f'COPY {relation} (id,v) FROM STDIN (FORMAT BINARY)') as writer:
                for block in encode_copy(_coordinate_rows(vectors), 'bit'):
                    checksum.update(block)
                    writer.write(block)
            cursor.execute(f'CREATE INDEX {identifier(index)} ON {relation} USING ivfflat (v bit_hamming_ops) WITH (lists={lists})')
            cursor.execute(f'CREATE FUNCTION {function}() RETURNS trigger LANGUAGE plpgsql AS ' + '$$' + GUARD_BODY + '$$')
            cursor.execute(f'CREATE TRIGGER {GUARD_NAME} BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON {relation} '
                           f'FOR EACH STATEMENT EXECUTE FUNCTION {function}()')
            cursor.execute(f'ALTER TABLE {relation} ENABLE ALWAYS TRIGGER {GUARD_NAME}')
            cursor.execute(f'GRANT SELECT ON TABLE {relation} TO {reader}')
            cursor.execute(f'ANALYZE {relation}')
            observed = inspect_generation(cursor, schema, table, index, lists)
        cursor.execute(f'SELECT count(*),min(id),max(id) FROM {relation}')
        if cursor.fetchone() != (vectors.count, 0, vectors.count - 1):
            raise ValueError('maintenance_navigation_population_mismatch')
        imported = {'count': vectors.count, 'completion_sha256': vectors.completion_sha256,
                    'binary_copy_sha256': checksum.hexdigest(), 'relation': relation}
    proof = write_json(destination/'navigation-import.json', imported)
    path = destination/'navigation.json'
    pin = write_json(path, {'format': 'pgvector-sealed-navigation-v1', 'dimensions': 3072,
                     'schema': schema, 'table': table, 'index': index, 'lists': lists, 'count': vectors.count,
                     'completion_sha256': vectors.completion_sha256, 'import_receipt_sha256': proof, 'snapshot': observed})
    return path, pin, lists


def _coordinate_rows(vectors):
    for start in range(0, vectors.count, 256):
        ordinals = list(range(start, min(start + 256, vectors.count)))
        yield from zip(ordinals, vectors.read(ordinals), strict=True)


def build_release(root, package, vectors, templates, connection, reader_role):
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=False)
    with ExitStack() as resources:
        work_pin = build_work_index(package, root/'works')
        works = resources.enter_context(closing(WorkIndex(root/'works', work_pin, package.sha256)))
        identity_pin = publish_vector_identities(vectors, root/'identities')
        identities = resources.enter_context(closing(VectorIdentityIndex(root/'identities', identity_pin, vectors.completion_sha256)))
        member_pin = publish_memberships(package, works, vectors, root/'memberships')
        profile_pin = publish_sparse_profiles(package, identities, root/'profiles')
        profiles = resources.enter_context(closing(SparseProfiles(root/'profiles', profile_pin,
                                                                    package.sha256, identity_pin)))
        analyzer_files = ('lib/legal-corpus/custom-bm25.ts', 'lib/legal-corpus/prepared-sparse-profile.ts',
                          'scripts/lexuz-sparse-profile.mts')
        analyzer_pin = hashlib.sha256(b''.join((PLATFORM/name).read_bytes() for name in analyzer_files)).hexdigest()
        # tsx is resolved by Node from the installed platform checkout.
        tokenizer = resources.enter_context(closing(ProductionTokenizer([
            'node', '--import', (PLATFORM/'node_modules/tsx/dist/loader.mjs').as_uri(),
            str(PLATFORM/'scripts/lexuz-sparse-profile.mts')])))
        tokenized = tokenize_profiles(profiles, tokenizer.tokenize, root/'tokenization', analyzer_pin)
        sparse_pin = publish_sparse_index(root/'tokenization', tokenized, root/'sparse')
        source_pin = publish_source_projection(package, root/'source-projection')
        build_catalog(package, root/'catalog.sqlite')
        catalog_pin = file_hash(root/'catalog.sqlite')
        with SourceBrowser(root/'catalog.sqlite', catalog_pin, package.sha256).open() as catalog:
            publication_works = [row[0] for row in catalog.db.execute('SELECT work FROM documents ORDER BY work')]
        unresolved = set(package.handoff['unresolved_works'])
        navigation, nav_pin, lists = publish_navigation(connection, vectors, root, reader_role)
        artifacts = {
            'packageSha256': package.sha256, 'workIndexSha256': work_pin, 'vectorIdentitySha256': identity_pin,
            'vectorCompletionSha256': vectors.completion_sha256, 'membershipSha256': member_pin,
            'sparseSha256': sparse_pin, 'navigationSha256': nav_pin,
        }
        paths = {key: str(root/key) for key in ('identities', 'works', 'memberships', 'profiles', 'sparse')}
        paths.update(package=str(package.root), vectors=str(vectors.root), navigation=str(navigation))
        receipts = {}
        for name in ('current', 'history'):
            template = templates[name]
            if template['capability'] != name:
                raise ValueError('maintenance_release_template_capability')
            release = {**template, 'id': f"release:{template['environment']}:{name}:lexuz:{package.sha256[:24]}",
                       'configuration': {**template['configuration'], 'navigationBackend': 'pgvector',
                                         'artifacts': artifacts, 'categoryRanking': {'mode': 'disabled'}}}
            path = root/f'{name}-worker.json'
            pin = write_json(path, {'format': 'prepared-numeric-worker-v1', 'release': release, 'paths': paths,
                             'profilesSha256': profile_pin, 'analyzerSha256': analyzer_pin,
                             'probes': lists, 'candidates': 50})
            receipts[name] = {'release': release, 'path': str(path), 'sha256': pin}
        source = root/'source-worker.json'
        source_worker_pin = write_json(source, {'format': 'prepared-source-worker-v1', 'artifacts': artifacts,
            'paths': {key: paths[key] for key in ('package', 'works')}, 'workers': 2, 'maxPending': 8,
            'sourceProjection': {'path': str(root/'source-projection'), 'sha256': source_pin},
            'browserCatalog': {'path': str(root/'catalog.sqlite'), 'sha256': catalog_pin}})
        replacements = set()
        for part in range(len(package.handoff['shards']['inventory'])):
            for _, item in package.records('inventory', part):
                found = capture(item)
                if found:
                    replacements.add((found[0][0], found[1][2]))
        replacements = sorted(replacements, key=lambda key: (key[0], key[1] or ''))
        _, key, text, _ = next(iter(package.input_rows(0)))
        if vectors.input_hashes([0]) != [key]:
            raise ValueError('maintenance_release_probe_identity')
        compact = json.loads(text)
        probe = tokenizer.tokenize({'id': key.hex(), 'members': 1, 'fields': {
            'title': compact['documentTitle'], 'hierarchy': '\n'.join(compact.get('hierarchy', [])),
            'article': '', 'text': compact['officialText'],
        }})
        terms = [item['termHash'] for item in sorted(probe['postings'],
                 key=lambda row: (-sum(row['termFrequencies'].values()), row['termHash']))[:64]]
        write_json(root/'release-candidate.json', {'format': 'prepared-corpus-release-candidate-v1', **receipts,
                   'sources': {'path': str(source), 'sha256': source_worker_pin}, 'qualificationRequired': True,
                   'replacements': replacements, 'publicationWorks': publication_works,
                   'partialPublicationWorks': [work for work in publication_works if work in unresolved],
                   'probe': {'embedding': vectors.read([0])[0].tolist(), 'termHashes': terms}})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package')
    parser.add_argument('package_sha256')
    parser.add_argument('vectors')
    parser.add_argument('vectors_sha256')
    parser.add_argument('template', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--reader-role', required=True)
    args = parser.parse_args()
    import psycopg
    package = PreparedPackage(args.package, args.package_sha256)
    templates = json.loads(args.template.read_bytes())
    with closing(VectorPool(args.vectors, args.vectors_sha256)) as vectors:
        vectors.verify_all()
        if vectors.completion.get('package_sha256') != package.sha256:
            raise ValueError('maintenance_vectors_package_mismatch')
        with psycopg.connect(os.environ['JURO_PREPARED_BUILD_DATABASE_URL'], autocommit=True) as connection:
            build_release(args.destination, package, vectors, templates, connection, args.reader_role)
    print(str(args.destination.resolve()/'release-candidate.json'), file=sys.stdout)


if __name__ == '__main__':
    main()
