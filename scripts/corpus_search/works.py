"""Authenticated work identities and package record locations for evidence hydration."""
import hashlib
import json
import os
import pathlib
import sqlite3


def file_hash(path):
    with path.open('rb') as source:return hashlib.file_digest(source,'sha256').hexdigest()


def work_key(work):
    if not isinstance(work,str) or not work or len(work.encode('utf-8'))>4096:
        raise ValueError('prepared_work_identity_invalid')
    return hashlib.sha256(work.encode('utf-8')).digest()


def signature(path):
    s=path.stat();return s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns


def build_work_index(package,root,progress=None):
    """Publish only after every inventory/prepared part authenticates in full.

    An interrupted build is deliberately not readable as a completed index.
    The caller may discard its staging directory and retry; no source is changed.
    """
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=False)
    pending=root/'works.partial';connection=sqlite3.connect(pending)
    connection.execute('PRAGMA journal_mode=DELETE');connection.execute('PRAGMA synchronous=FULL')
    connection.execute('PRAGMA cache_size=-16384');connection.execute('PRAGMA temp_store=FILE')
    connection.execute('''CREATE TABLE works (
        key BLOB PRIMARY KEY CHECK(length(key)=32),work TEXT NOT NULL,
        inventory_part INTEGER NOT NULL,inventory_row INTEGER NOT NULL,
        prepared_part INTEGER,prepared_row INTEGER,
        CHECK((prepared_part IS NULL)=(prepared_row IS NULL))) WITHOUT ROWID''')
    inventory_count=0;prepared_count=0
    try:
        for part in range(len(package.handoff['shards']['inventory'])):
            stream=package.records('inventory',part)
            with connection:
                for ordinal,row in stream:
                    work=row.get('id');key=work_key(work)
                    try:connection.execute('INSERT INTO works VALUES(?,?,?,?,NULL,NULL)',(key,work,part,ordinal))
                    except sqlite3.IntegrityError as error:raise ValueError('prepared_work_duplicate_inventory') from error
                    inventory_count+=1
                    del row
                if not stream.verified:raise ValueError('prepared_work_inventory_unverified')
            if progress:progress('inventory',part+1,inventory_count)
        for part in range(len(package.handoff['shards']['prepared'])):
            stream=package.records('prepared',part)
            with connection:
                for ordinal,row in stream:
                    work=row.get('work');key=work_key(work)
                    updated=connection.execute('''UPDATE works SET prepared_part=?,prepared_row=?
                        WHERE key=? AND work=? AND prepared_part IS NULL''',(part,ordinal,key,work)).rowcount
                    if updated!=1:raise ValueError('prepared_work_missing_or_duplicate_parent')
                    prepared_count+=1
                    del row
                if not stream.verified:raise ValueError('prepared_work_prepared_unverified')
            if progress:progress('prepared',part+1,prepared_count)
        if connection.execute('PRAGMA integrity_check').fetchone()!=('ok',):
            raise ValueError('prepared_work_integrity_failed')
        if connection.execute('SELECT count(*) FROM works').fetchone()[0]!=inventory_count:
            raise ValueError('prepared_work_population_mismatch')
        connection.close()
        with pending.open('r+b') as source:os.fsync(source.fileno())
        target=root/'works.sqlite';os.replace(pending,target)
        manifest={'format':'prepared-work-locations-v1','complete':True,'package_sha256':package.sha256,
                  'work_key_format':'sha256-utf8-work-id-v1','inventory_rows':inventory_count,
                  'prepared_rows':prepared_count,'database_bytes':target.stat().st_size,'database_sha256':file_hash(target)}
        raw=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
        with (root/'manifest.json').open('xb') as output:output.write(raw);output.flush();os.fsync(output.fileno())
        if os.name!='nt':
            fd=os.open(root,os.O_RDONLY)
            try:os.fsync(fd)
            finally:os.close(fd)
        return hashlib.sha256(raw).hexdigest()
    finally:connection.close()


class WorkIndex:
    def __init__(self,root,manifest_sha256,package_sha256):
        self.root=pathlib.Path(root).resolve(strict=True)
        manifest_path=self.root/'manifest.json'
        if manifest_path.stat().st_size>4096 or file_hash(manifest_path)!=manifest_sha256:
            raise ValueError('prepared_work_manifest_mismatch')
        self.manifest=json.loads(manifest_path.read_bytes());m=self.manifest
        self.manifest_sha256=manifest_sha256
        if (m.get('format')!='prepared-work-locations-v1' or m.get('complete') is not True
                or m.get('package_sha256')!=package_sha256 or m.get('work_key_format')!='sha256-utf8-work-id-v1'
                or any(type(m.get(key)) is not int or not 0<=m[key]<2**53 for key in ['inventory_rows','prepared_rows'])
                or m['prepared_rows']>m['inventory_rows']):
            raise ValueError('prepared_work_manifest_invalid')
        self.path=self.root/'works.sqlite'
        if self.path.is_symlink() or self.path.stat().st_size!=m['database_bytes'] or file_hash(self.path)!=m['database_sha256']:
            raise ValueError('prepared_work_database_mismatch')
        self.identity=signature(self.path)
        self.connection=sqlite3.connect(self.path.as_uri()+'?mode=ro&immutable=1',uri=True)
        self.connection.execute('PRAGMA query_only=ON');self.connection.execute('PRAGMA cache_size=-8192')

    def lookup(self,keys):
        if not isinstance(keys,(tuple,list)) or len(keys)>2000:
            raise ValueError('prepared_work_request_bound')
        if signature(self.path)!=self.identity:raise ValueError('prepared_work_storage_changed')
        result=[]
        for key in keys:
            if not isinstance(key,bytes) or len(key)!=32:raise ValueError('prepared_work_key_invalid')
            row=self.connection.execute('SELECT work,inventory_part,inventory_row,prepared_part,prepared_row FROM works WHERE key=?',(key,)).fetchone()
            if row is None:result.append(None);continue
            if work_key(row[0])!=key:raise ValueError('prepared_work_identity_mismatch')
            result.append({'work':row[0],'inventory':(row[1],row[2]),
                           'prepared':None if row[3] is None else (row[3],row[4])})
        return result

    def close(self):self.connection.close()


def hydrate_records(package,kind,locations,max_total_bytes=64*1024*1024,*,project=None):
    """Read bounded selected rows, authenticating every touched source part.

    Each location is (part,row). Return order and repeated requests are retained.
    Never return rows from a stream whose trailing receipt verification failed.
    An optional projection bounds retained fields, not the authenticated stream.
    """
    if (kind not in ('inventory','prepared','chunks') or not isinstance(locations,(list,tuple)) or len(locations)>2000
            or type(max_total_bytes) is not int or not 1<=max_total_bytes<=256*1024*1024):
        raise ValueError('prepared_hydration_request_invalid')
    groups={}
    for i,location in enumerate(locations):
        if (not isinstance(location,(list,tuple)) or len(location)!=2
                or any(type(v) is not int or v<0 for v in location)):
            raise ValueError('prepared_hydration_location_invalid')
        groups.setdefault(location[0],{}).setdefault(location[1],[]).append(i)
    results=[None]*len(locations);selected_bytes=0
    for part,requested in groups.items():
        stream=package.records(kind,part)
        for ordinal,row in stream:
            if ordinal in requested:
                if project is not None:row=project(row)
                selected_bytes+=len(json.dumps(row,ensure_ascii=False,separators=(',',':')).encode('utf-8'))
                if selected_bytes>max_total_bytes:raise ValueError('prepared_hydration_byte_bound')
            for i in requested.get(ordinal,[]):results[i]=row
        if not stream.verified:raise ValueError('prepared_hydration_unverified')
    if any(row is None for row in results):raise ValueError('prepared_hydration_missing_row')
    return results
