"""Authenticated inverse of the sealed completion's compact-input identities."""
import hashlib
import json
import os
import pathlib
import sqlite3
import bisect
import re
from membership import sync_directory
from works import file_hash,signature


class CompletedVectorIdentities:
    """Verify input identities without claiming to verify vector coordinates.

    This source cannot read or search embeddings. Coordinate admission remains
    VectorPool.verify_all's responsibility; this projection only inverts hashes.
    """
    def __init__(self,root,completion_sha256):
        self.root=pathlib.Path(root).resolve(strict=True);self.ready=False
        path=self.root/'completion.json'
        if path.is_symlink() or file_hash(path)!=completion_sha256:raise ValueError('vector_identity_completion_mismatch')
        self.completion_sha256=completion_sha256;self.completion=json.loads(path.read_bytes())
        if self.completion.get('model')!='text-embedding-3-large' or self.completion.get('dimensions')!=3072:
            raise ValueError('vector_identity_model_mismatch')
        self.shards=self.completion['shards'];self.ends=[];self.starts=[];self.paths=[];self.signatures=[]
        total=0;seen=set()
        for receipt in self.shards:
            job=receipt.get('job');count=receipt.get('count')
            if (not isinstance(job,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',job) or job in seen
                    or type(count) is not int or not 0<count<=50000
                    or receipt.get('model')!='text-embedding-3-large' or receipt.get('dimensions')!=3072):
                raise ValueError('vector_identity_shard_invalid')
            seen.add(job);self.starts.append(total);total+=count;self.ends.append(total)
        if not 0<total<2**53 or total!=self.completion.get('inputs'):raise ValueError('vector_identity_count_mismatch')
        self.count=total;self.completion_signature=signature(path)

    def verify_identities(self):
        self.ready=False;self.paths=[];self.signatures=[]
        for receipt in self.shards:
            job=receipt['job'];count=receipt['count']
            paths=[self.root/'receipts'/f'{job}.json',self.root/'vectors'/f'{job}.hashes',self.root/'vectors'/f'{job}.done']
            if any(path.is_symlink() or not path.resolve(strict=True).is_relative_to(self.root) for path in paths):
                raise ValueError('vector_identity_path_invalid')
            before=tuple(signature(path) for path in paths)
            if (json.loads(paths[0].read_bytes())!=receipt or paths[1].stat().st_size!=count*32
                    or file_hash(paths[1])!=receipt.get('input_hashes_sha256') or paths[2].read_bytes()!=bytes([1])*count):
                raise ValueError('vector_identity_receipt_mismatch')
            if tuple(signature(path) for path in paths)!=before:raise ValueError('vector_identity_storage_changed')
            self.paths.append(paths);self.signatures.append(before)
        if signature(self.root/'completion.json')!=self.completion_signature:raise ValueError('vector_identity_storage_changed')
        self.ready=True

    def assert_unchanged(self):
        if not self.ready:raise ValueError('vector_identity_source_unverified')
        if (signature(self.root/'completion.json')!=self.completion_signature
                or any(tuple(signature(path) for path in paths)!=expected for paths,expected in zip(self.paths,self.signatures))):
            raise ValueError('vector_identity_storage_changed')

    def input_hashes(self,ordinals):
        if not self.ready:raise ValueError('vector_identity_source_unverified')
        if (not isinstance(ordinals,(list,tuple)) or len(ordinals)>10000
                or any(type(value) is not int or not 0<=value<self.count for value in ordinals)):
            raise ValueError('vector_identity_position_invalid')
        groups={};result=[None]*len(ordinals)
        for position,ordinal in enumerate(ordinals):
            part=bisect.bisect_right(self.ends,ordinal);groups.setdefault(part,[]).append((ordinal-self.starts[part],position))
        for part,items in groups.items():
            paths=self.paths[part]
            if tuple(signature(path) for path in paths)!=self.signatures[part]:raise ValueError('vector_identity_storage_changed')
            first=min(row[0] for row in items);last=max(row[0] for row in items)
            with paths[1].open('rb') as source:source.seek(first*32);raw=source.read((last-first+1)*32)
            if len(raw)!=(last-first+1)*32:raise ValueError('vector_identity_storage_changed')
            for ordinal,position in items:result[position]=raw[(ordinal-first)*32:(ordinal-first+1)*32]
            if tuple(signature(path) for path in paths)!=self.signatures[part]:raise ValueError('vector_identity_storage_changed')
        return result


def publish_vector_identities(vectors,root,checkpoint=None):
    if not vectors.ready:raise ValueError('vector_identity_source_unverified')
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=False)
    pending=root/'identities.partial';db=sqlite3.connect(pending)
    try:
        db.execute('PRAGMA journal_mode=DELETE');db.execute('PRAGMA synchronous=FULL')
        db.execute('PRAGMA cache_size=-32768');db.execute('PRAGMA temp_store=FILE')
        db.execute('CREATE TABLE identities (hash BLOB PRIMARY KEY CHECK(length(hash)=32),ordinal INTEGER NOT NULL UNIQUE CHECK(ordinal>=0)) WITHOUT ROWID')
        for start in range(0,vectors.count,4096):
            ordinals=list(range(start,min(start+4096,vectors.count)))
            hashes=vectors.input_hashes(ordinals)
            if len(hashes)!=len(ordinals) or any(not isinstance(value,bytes) or len(value)!=32 for value in hashes):
                raise ValueError('vector_identity_input_invalid')
            with db:db.executemany('INSERT INTO identities VALUES(?,?)',zip(hashes,ordinals))
            if checkpoint:checkpoint({'phase':'vector-identities','rows':start+len(ordinals)})
        if (db.execute('PRAGMA integrity_check').fetchone()!=('ok',)
                or db.execute('SELECT count(*) FROM identities').fetchone()[0]!=vectors.count):
            raise ValueError('vector_identity_population_invalid')
        vectors.assert_unchanged();db.close()
        with pending.open('r+b') as source:os.fsync(source.fileno())
        path=root/'identities.sqlite';os.replace(pending,path)
        manifest={'format':'prepared-vector-identities-v1','complete':True,'rows':vectors.count,
                  'vector_completion_sha256':vectors.completion_sha256,
                  'database_bytes':path.stat().st_size,'database_sha256':file_hash(path)}
        raw=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
        with (root/'manifest.json').open('xb') as target:target.write(raw);target.flush();os.fsync(target.fileno())
        sync_directory(root);return hashlib.sha256(raw).hexdigest()
    finally:db.close()


class VectorIdentityIndex:
    def __init__(self,root,manifest_sha256,completion_sha256):
        self.root=pathlib.Path(root).resolve(strict=True);path=self.root/'manifest.json'
        if path.is_symlink() or path.stat().st_size>4096 or file_hash(path)!=manifest_sha256:
            raise ValueError('vector_identity_manifest_mismatch')
        self.manifest=json.loads(path.read_bytes());m=self.manifest
        if (m.get('format')!='prepared-vector-identities-v1' or m.get('complete') is not True
                or m.get('vector_completion_sha256')!=completion_sha256
                or type(m.get('rows')) is not int or not 0<m['rows']<2**53):
            raise ValueError('vector_identity_manifest_invalid')
        self.path=self.root/'identities.sqlite'
        if (self.path.is_symlink() or self.path.stat().st_size!=m.get('database_bytes')
                or file_hash(self.path)!=m.get('database_sha256')):
            raise ValueError('vector_identity_database_mismatch')
        self.identity=signature(self.path);self.manifest_sha256=manifest_sha256
        self.connection=sqlite3.connect(self.path.as_uri()+'?mode=ro&immutable=1',uri=True)
        self.connection.execute('PRAGMA query_only=ON');self.connection.execute('PRAGMA cache_size=-8192')

    def lookup(self,hashes):
        if (not isinstance(hashes,(list,tuple)) or len(hashes)>2000
                or any(not isinstance(value,bytes) or len(value)!=32 for value in hashes)):
            raise ValueError('vector_identity_lookup_bound')
        if signature(self.path)!=self.identity:raise ValueError('vector_identity_storage_changed')
        result=[]
        for value in hashes:
            row=self.connection.execute('SELECT ordinal FROM identities WHERE hash=?',(value,)).fetchone()
            ordinal=None if row is None else row[0]
            if ordinal is not None and (type(ordinal) is not int or not 0<=ordinal<self.manifest['rows']):
                raise ValueError('vector_identity_ordinal_invalid')
            result.append(ordinal)
        if signature(self.path)!=self.identity:raise ValueError('vector_identity_storage_changed')
        return result

    def close(self):self.connection.close()
