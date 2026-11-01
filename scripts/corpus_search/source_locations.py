"""Immutable publisher-URL locators for retained acquisition records.

This index locates captures; it never chooses an edition or establishes that a
capture is current, applicable or completely extracted.
"""
import hashlib
import json
import os
import pathlib
import re
import sqlite3
from urllib.parse import urlsplit,parse_qsl,urlencode
from cancellation import check_cancelled
from works import signature,file_hash


def source_url(value):
    if (not isinstance(value,str) or len(value)>8192 or value!=value.strip()
            or any(ord(char)<32 or ord(char)==127 for char in value)):
        raise ValueError('source_location_url_invalid')
    try:
        url=urlsplit(value)
        if (url.scheme!='https' or url.hostname not in ('lex.uz','www.lex.uz') or url.port
                or url.username or url.password or not url.path.startswith('/')
                or '%' in url.path or any(char.isspace() for char in url.path+url.netloc)):
            raise ValueError('source_location_url_invalid')
        query=parse_qsl(url.query,keep_blank_values=True,strict_parsing=True)
        if (len(query)>1 or any(key!='ONDATE' or not re.fullmatch(r'\d{2}\.\d{2}\.\d{4}(?: \d{2})?',date)
                               for key,date in query)):
            raise ValueError('source_location_url_invalid')
        return 'https://lex.uz'+url.path+('?' + urlencode(query) if query else '')
    except (ValueError,TypeError) as error:raise ValueError('source_location_url_invalid') from error


def build_source_locations(package,root,progress=None):
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=False)
    pending=root/'sources.partial';connection=sqlite3.connect(pending)
    connection.execute('PRAGMA synchronous=FULL')
    connection.execute('PRAGMA temp_store=FILE')
    connection.execute('CREATE TABLE sources(url TEXT NOT NULL,work TEXT NOT NULL,PRIMARY KEY(url,work)) WITHOUT ROWID')
    count=0;excluded=0
    try:
        for part in range(len(package.handoff['shards']['inventory'])):
            stream=package.records('inventory',part)
            with connection:
                for _,row in stream:
                    check_cancelled()
                    work=row.get('id')
                    if not isinstance(work,str) or not work or len(work.encode())>4096:
                        raise ValueError('source_location_work_invalid')
                    try:url=source_url(row.get('url'))
                    except ValueError:
                        excluded+=1;continue
                    try:connection.execute('INSERT INTO sources VALUES(?,?)',(url,work))
                    except sqlite3.IntegrityError as error:raise ValueError('source_location_duplicate_work') from error
                    count+=1
                if not stream.verified:raise ValueError('source_location_inventory_unverified')
            if progress:progress(part+1,count,excluded)
        if connection.execute('PRAGMA integrity_check').fetchone()!=('ok',):raise ValueError('source_location_integrity_failed')
        if connection.execute('SELECT count(*) FROM sources').fetchone()[0]!=count:raise ValueError('source_location_population_mismatch')
        connection.close()
        with pending.open('r+b') as target:os.fsync(target.fileno())
        target=root/'sources.sqlite';os.replace(pending,target)
        manifest={'format':'prepared-source-locations-v1','package_sha256':package.sha256,
                  'rows':count,'excluded_urls':excluded,'database_bytes':target.stat().st_size,'database_sha256':file_hash(target)}
        raw=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
        with (root/'manifest.json').open('xb') as output:output.write(raw);output.flush();os.fsync(output.fileno())
        if os.name!='nt':
            fd=os.open(root,os.O_RDONLY)
            try:os.fsync(fd)
            finally:os.close(fd)
        return hashlib.sha256(raw).hexdigest()
    finally:connection.close()


class SourceLocations:
    def __init__(self,root,manifest_sha256,package_sha256):
        self.root=pathlib.Path(root).resolve(strict=True);manifest_path=self.root/'manifest.json'
        if manifest_path.is_symlink() or manifest_path.stat().st_size>4096 or file_hash(manifest_path)!=manifest_sha256:
            raise ValueError('source_location_manifest_mismatch')
        manifest=json.loads(manifest_path.read_bytes())
        if (set(manifest)!={'format','package_sha256','rows','excluded_urls','database_bytes','database_sha256'}
                or manifest['format']!='prepared-source-locations-v1' or manifest['package_sha256']!=package_sha256
                or any(type(manifest[key]) is not int or manifest[key]<0 for key in ('rows','excluded_urls','database_bytes'))):
            raise ValueError('source_location_manifest_invalid')
        self.path=self.root/'sources.sqlite';self.manifest_sha256=manifest_sha256
        if self.path.is_symlink() or self.path.stat().st_size!=manifest['database_bytes'] or file_hash(self.path)!=manifest['database_sha256']:
            raise ValueError('source_location_database_mismatch')
        self.identity=signature(self.path)
        self.connection=sqlite3.connect(self.path.as_uri()+'?mode=ro&immutable=1',uri=True)
        self.connection.execute('PRAGMA query_only=ON')
        self.connection.execute('PRAGMA cache_size=-2048')

    def lookup(self,url):
        check_cancelled()
        if signature(self.path)!=self.identity:raise ValueError('source_location_storage_changed')
        rows=self.connection.execute('SELECT work FROM sources WHERE url=? ORDER BY work LIMIT 65',(source_url(url),)).fetchall()
        if len(rows)>64:raise ValueError('source_location_lookup_bound')
        return [row[0] for row in rows]

    def close(self):self.connection.close()
    def __enter__(self):return self
    def __exit__(self,*_):self.close()
