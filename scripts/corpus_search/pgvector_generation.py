"""Attest a sealed pgvector relation from the navigation read transaction.

An operator seals an authenticated import with an always-enabled statement
trigger and publishes this manifest after qualification. Runtime roles cannot
own or modify the relation, guard function or schema. Database administrators
remain trusted; this is not protection against a malicious superuser.
Release admission must independently verify import and qualification receipts.
"""
import hashlib
import json
import pathlib
import re

GUARD_BODY = "BEGIN RAISE EXCEPTION 'prepared_generation_immutable'; END;"
GUARD_NAME = 'prepared_generation_immutable'


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch('[a-z_][a-z0-9_]{0,62}', value):
        raise ValueError('pgvector_generation_identifier_invalid')
    return '"' + value + '"'


def inspect_generation(cursor, schema, table, index, lists):
    relation = identifier(schema) + '.' + identifier(table)
    index_relation = identifier(schema) + '.' + identifier(index)
    # Hold the selected relation against replacement until this read ends.
    cursor.execute(f'LOCK TABLE {relation} IN ACCESS SHARE MODE')
    cursor.execute("""SELECT json_build_object(
        'database', (SELECT oid FROM pg_database WHERE datname=current_database()),
        'table_oid', t.oid, 'table_file', t.relfilenode, 'table_owner', t.relowner,
        'table_kind', t.relkind, 'persistence', t.relpersistence, 'rls', t.relrowsecurity,
        'children', (SELECT count(*) FROM pg_inherits WHERE inhparent=t.oid OR inhrelid=t.oid),
        'rules', (SELECT count(*) FROM pg_rewrite WHERE ev_class=t.oid),
        'columns', (SELECT json_agg(json_build_array(attname,format_type(atttypid,atttypmod),attnotnull,attgenerated) ORDER BY attnum)
                    FROM pg_attribute WHERE attrelid=t.oid AND attnum>0 AND NOT attisdropped),
        'index_oid', i.oid, 'index_file', i.relfilenode, 'index_definition', pg_get_indexdef(i.oid),
        'index_options', i.reloptions, 'index_method', am.amname, 'index_valid', x.indisvalid,
        'index_ready', x.indisready, 'index_live', x.indislive, 'index_table', x.indrelid,
        'index_columns', x.indkey::text, 'index_expression', pg_get_expr(x.indexprs,t.oid),
        'index_predicate', pg_get_expr(x.indpred,t.oid), 'index_opclass', op.opcname,
        'guard_oid', g.oid, 'guard_type', g.tgtype, 'guard_enabled', g.tgenabled,
        'guard_internal', g.tgisinternal, 'guard_arguments', g.tgnargs,
        'guard_columns', g.tgattr::text, 'guard_condition', pg_get_expr(g.tgqual,t.oid),
        'function_oid', p.oid, 'function_owner', p.proowner, 'function_source', p.prosrc,
        'function_language', lang.lanname, 'function_return', p.prorettype::regtype::text,
        'function_security_definer', p.prosecdef, 'function_settings', p.proconfig,
        'pgvector', (SELECT extversion FROM pg_extension WHERE extname='vector'),
        'pgvector_schema', (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'))
        FROM pg_class t JOIN pg_index x ON x.indrelid=t.oid
        JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_am am ON am.oid=i.relam
        JOIN pg_opclass op ON op.oid=x.indclass[0]
        JOIN pg_trigger g ON g.tgrelid=t.oid AND g.tgname=%s
        JOIN pg_proc p ON p.oid=g.tgfoid JOIN pg_language lang ON lang.oid=p.prolang
        WHERE t.oid=%s::regclass AND i.oid=%s::regclass""", (GUARD_NAME, relation, index_relation))
    row = cursor.fetchone()
    if not row:
        raise ValueError('pgvector_generation_missing')
    value = row[0]
    expected = {'table_kind': 'r', 'persistence': 'p', 'rls': False, 'children': 0, 'rules': 0,
        'index_method': 'ivfflat', 'index_valid': True, 'index_ready': True, 'index_live': True,
        'index_table': value['table_oid'], 'index_columns': '2', 'index_expression': None,
        'index_predicate': None, 'index_opclass': 'bit_hamming_ops', 'index_options': [f'lists={lists}'],
        'guard_type': 62, 'guard_enabled': 'A', 'guard_internal': False, 'guard_arguments': 0,
        'guard_columns': '', 'guard_condition': None, 'function_source': GUARD_BODY,
        'function_language': 'plpgsql', 'function_return': 'trigger', 'function_security_definer': False,
        'function_settings': None, 'pgvector_schema': 'public'}
    if (any(value.get(key) != required for key, required in expected.items())
            or [column[:2] for column in value['columns']] != [['id', 'bigint'], ['v', 'bit(3072)']]
            or any(column[3] for column in value['columns']) or not value['pgvector']):
        raise ValueError('pgvector_generation_not_sealed')
    return value


class PgvectorGeneration:
    def __init__(self, path, manifest_sha256):
        path = pathlib.Path(path)
        if path.is_symlink() or path.stat().st_size > 65536:
            raise ValueError('pgvector_generation_manifest_invalid')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != manifest_sha256:
            raise ValueError('pgvector_generation_manifest_mismatch')
        self.manifest = json.loads(raw)
        m = self.manifest
        if (m.get('format') != 'pgvector-sealed-navigation-v1' or m.get('dimensions') != 3072
                or type(m.get('count')) is not int or not 0 < m['count'] < 2**53
                or type(m.get('lists')) is not int or not 1 <= m['lists'] <= 32768
                or any(not isinstance(m.get(key), str) or not re.fullmatch('[a-f0-9]{64}', m[key])
                       for key in ['completion_sha256', 'import_receipt_sha256'])
                or not isinstance(m.get('snapshot'), dict)):
            raise ValueError('pgvector_generation_manifest_invalid')
        for key in ['schema', 'table', 'index']:
            identifier(m.get(key))
        self.manifest_sha256 = manifest_sha256

    def navigation(self, connect, probes, timeout_ms=10000):
        from pgvector_navigation import PgvectorNavigation
        m = self.manifest
        return PgvectorNavigation(connect, self, schema=m['schema'], table=m['table'],
            completion_sha256=m['completion_sha256'], manifest_sha256=self.manifest_sha256,
            count=m['count'], lists=m['lists'], probes=probes, timeout_ms=timeout_ms)

    def __call__(self, cursor, manifest_sha256):
        if manifest_sha256 != self.manifest_sha256:
            raise ValueError('pgvector_generation_pin_mismatch')
        m = self.manifest
        observed = inspect_generation(cursor, m['schema'], m['table'], m['index'], m['lists'])
        if observed != m['snapshot']:
            raise ValueError('pgvector_generation_changed')
        cursor.execute("""SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls,
            s.rolsuper OR s.rolcreaterole OR s.rolcreatedb OR s.rolreplication OR s.rolbypassrls
              OR EXISTS (SELECT 1 FROM pg_roles elevated
                WHERE (elevated.rolsuper OR elevated.rolcreaterole OR elevated.rolcreatedb
                  OR elevated.rolreplication OR elevated.rolbypassrls
                  OR elevated.rolname IN ('pg_write_all_data','pg_execute_server_program','pg_write_server_files'))
                AND (pg_has_role(current_user,elevated.oid,'SET') OR pg_has_role(session_user,elevated.oid,'SET'))),
            pg_has_role(current_user,%s::oid,'MEMBER') OR pg_has_role(session_user,%s::oid,'MEMBER'),
            pg_has_role(current_user,%s::oid,'MEMBER') OR pg_has_role(session_user,%s::oid,'MEMBER'),
            has_schema_privilege(current_user,%s,'CREATE'),
            has_table_privilege(current_user,%s::oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'),
            has_any_column_privilege(current_user,%s::oid,'INSERT,UPDATE'),
            has_table_privilege(current_user,%s::oid,'SELECT')
            FROM pg_roles r,pg_roles s WHERE r.rolname=current_user AND s.rolname=session_user""",
            (observed['table_owner'], observed['table_owner'], observed['function_owner'], observed['function_owner'],
             m['schema'], observed['table_oid'], observed['table_oid'], observed['table_oid']))
        if cursor.fetchone() != (False, False, False, False, False, False, False, True):
            raise ValueError('pgvector_generation_read_role_required')
