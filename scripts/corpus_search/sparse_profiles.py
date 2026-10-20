"""Bounded authenticated lexical profiles, before postings/tokenization.

One original embedding input retains its complete structural fields and exact
membership multiplicity. A completed profile database is not a search index.
"""
import hashlib
import json
import os
import pathlib
import sqlite3
import zlib
from discovery_chunks import chunk_original_input,chunk_part_order
from prepared import canonical
from membership import sync_directory
from works import file_hash,signature


def sparse_fields(chunk):
    hierarchy=chunk.get('hierarchy');article=chunk.get('articleTitle')
    if (not isinstance(hierarchy,list) or any(not isinstance(item,str) for item in hierarchy)
            or article is not None and not isinstance(article,str)
            or not isinstance(chunk.get('sourceDocumentTitle'),str) or not isinstance(chunk.get('officialText'),str)):
        raise ValueError('sparse_profile_fields_invalid')
    # articleNumber is a publisher locator in this handoff, not a legal label.
    return {'title':chunk['sourceDocumentTitle'],'hierarchy':'\n'.join(hierarchy),
            'article':article or '', 'text':chunk['officialText']}


def publish_sparse_profiles(package,identities,root,checkpoint=None):
    if identities.manifest.get('vector_completion_sha256') is None:raise ValueError('sparse_profile_vector_pin_missing')
    chunk_parts=chunk_part_order(package)
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=False)
    pending=root/'profiles.partial';db=sqlite3.connect(pending)
    def progress(phase,**values):
        if checkpoint:checkpoint({'phase':phase,**values})
    def source_rows(kind):
        count=0
        parts=package.memberships['receipts'] if kind=='memberships' else package.handoff['shards']['chunks']
        for part in (range(len(parts)) if kind=='memberships' else chunk_parts):
            stream=package.membership_rows(part) if kind=='memberships' else package.records('chunks',part)
            for row in stream:
                yield row if kind=='memberships' else (count,row[1]);count+=1
            if not stream.verified:raise ValueError('sparse_profile_source_unverified')
    originals=0;members=0
    try:
        db.execute('PRAGMA journal_mode=DELETE');db.execute('PRAGMA synchronous=FULL')
        db.execute('PRAGMA cache_size=-131072');db.execute('PRAGMA temp_store=FILE')
        db.execute('''CREATE TABLE profiles(original BLOB PRIMARY KEY CHECK(length(original)=32),
            compact BLOB NOT NULL CHECK(length(compact)=32),vector_ordinal INTEGER NOT NULL,
            members INTEGER NOT NULL DEFAULT 0,first_membership INTEGER,fields BLOB) WITHOUT ROWID''')
        def insert(batch):
            ordinals=identities.lookup([row[1] for row in batch])
            if any(value is None for value in ordinals):raise ValueError('sparse_profile_vector_missing')
            db.executemany('INSERT INTO profiles(original,compact,vector_ordinal) VALUES(?,?,?)',
                           [(row[0],row[1],ordinal) for row,ordinal in zip(batch,ordinals)])
        for part in range(len(package.embeddings['mapping_receipts'])):
            stream=package.mapping_rows(part);batch=[]
            with db:
                for original,compact,_ in stream:
                    batch.append((original,compact));originals+=1
                    if len(batch)==1024:insert(batch);batch=[]
                if batch:insert(batch)
                if not stream.verified:raise ValueError('sparse_profile_mapping_unverified')
            progress('sparse-mapping',parts=part+1,rows=originals)
        chunks=iter(source_rows('chunks'));source=iter(source_rows('memberships'))
        while True:
            batch=[]
            for _ in range(1024):
                member=next(source,None);chunk_row=next(chunks,None)
                if member is None or chunk_row is None:
                    if member is not None or chunk_row is not None:raise ValueError('sparse_profile_population_mismatch')
                    break
                ordinal,chunk_hash,original,work=member;chunk_ordinal,chunk=chunk_row
                text=chunk.get('officialText')
                if (ordinal!=members+len(batch) or chunk_ordinal!=ordinal or chunk.get('work')!=work
                        or chunk.get('id')!='retrieval-chunk-v1:'+chunk_hash.hex()
                        or not isinstance(text,str) or hashlib.sha256(text.encode()).hexdigest()!=chunk.get('officialTextSha256')
                        or hashlib.sha256(chunk_original_input(chunk)).digest()!=original):
                    raise ValueError('sparse_profile_chunk_membership_mismatch')
                policy={key:chunk[key] for key in ['ordinal','policyVersion','snapshotProvisionId','targetTokens','officialTextSha256']}
                if policy['policyVersion']!='retrieval-chunk-v1' or hashlib.sha256(canonical(policy)).digest()!=chunk_hash:
                    raise ValueError('sparse_profile_chunk_policy_mismatch')
                batch.append((original,ordinal,chunk))
            if not batch:break
            keys=list({row[0] for row in batch})
            existing=dict(db.execute('SELECT original,members FROM profiles WHERE original IN ('+','.join('?' for _ in keys)+')',keys))
            if len(existing)!=len(keys):raise ValueError('sparse_profile_mapping_missing')
            updates={}
            for original,ordinal,chunk in batch:
                if original not in updates:
                    fields=None if existing[original] else zlib.compress(json.dumps(sparse_fields(chunk),ensure_ascii=False,separators=(',',':')).encode(),3)
                    updates[original]=[0,ordinal,fields]
                updates[original][0]+=1
            with db:db.executemany('''UPDATE profiles SET members=members+?,first_membership=coalesce(first_membership,?),
                fields=coalesce(fields,?) WHERE original=?''',[(count,ordinal,fields,key) for key,(count,ordinal,fields) in updates.items()])
            members+=len(batch);progress('sparse-memberships',rows=members)
        if members!=package.memberships['rows'] or db.execute('SELECT 1 FROM profiles WHERE members=0 OR fields IS NULL LIMIT 1').fetchone():
            raise ValueError('sparse_profile_population_incomplete')
        if db.execute('SELECT sum(members) FROM profiles').fetchone()[0]!=members or db.execute('PRAGMA integrity_check').fetchone()!=('ok',):
            raise ValueError('sparse_profile_database_invalid')
        identities.lookup([]);db.close()
        with pending.open('r+b') as target:os.fsync(target.fileno())
        path=root/'profiles.sqlite';os.replace(pending,path)
        manifest={'format':'prepared-sparse-profiles-v1','complete':True,'search_index':False,'members':members,'profiles':originals,
          'chunk_parts':chunk_parts,
          'package_sha256':package.sha256,'vector_identity_sha256':identities.manifest_sha256,
          'vector_completion_sha256':identities.manifest['vector_completion_sha256'],
          'mapping_sha256':package.files['embedding-inputs/manifest.json']['sha256'],
          'source_membership_sha256':package.files['memberships/manifest.json']['sha256'],
          'fields_codec':'zlib-json-title-hierarchy-article-text-v1','database_bytes':path.stat().st_size,'database_sha256':file_hash(path)}
        raw=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
        with (root/'manifest.json').open('xb') as target:target.write(raw);target.flush();os.fsync(target.fileno())
        sync_directory(root);return hashlib.sha256(raw).hexdigest()
    finally:db.close()


class SparseProfiles:
    """Authenticated bounded iterator for offline production tokenization."""
    def __init__(self,root,manifest_sha256,package_sha256,vector_identity_sha256):
        self.root=pathlib.Path(root).resolve(strict=True);path=self.root/'manifest.json'
        if path.is_symlink() or path.stat().st_size>8*1024*1024 or file_hash(path)!=manifest_sha256:
            raise ValueError('sparse_profiles_manifest_mismatch')
        self.manifest=json.loads(path.read_bytes());m=self.manifest
        parts=m.get('chunk_parts')
        if parts is not None and (not isinstance(parts,list)
                or any(type(part) is not int for part in parts)
                or sorted(parts)!=list(range(len(parts)))):
            raise ValueError('sparse_profiles_chunk_order_invalid')
        if (m.get('format')!='prepared-sparse-profiles-v1' or m.get('complete') is not True
                or m.get('search_index') is not False or m.get('package_sha256')!=package_sha256
                or m.get('vector_identity_sha256')!=vector_identity_sha256
                or m.get('fields_codec')!='zlib-json-title-hierarchy-article-text-v1'
                or any(type(m.get(key)) is not int or not 0<m[key]<2**53 for key in ['members','profiles'])
                or m['profiles']>m['members']):
            raise ValueError('sparse_profiles_manifest_invalid')
        self.path=self.root/'profiles.sqlite'
        if (self.path.is_symlink() or self.path.stat().st_size!=m.get('database_bytes')
                or file_hash(self.path)!=m.get('database_sha256')):
            raise ValueError('sparse_profiles_database_mismatch')
        self.identity=signature(self.path);self.manifest_sha256=manifest_sha256
        self.connection=sqlite3.connect(self.path.as_uri()+'?mode=ro&immutable=1',uri=True)
        self.connection.execute('PRAGMA query_only=ON');self.connection.execute('PRAGMA cache_size=-8192')

    def assert_unchanged(self):
        if signature(self.path)!=self.identity:raise ValueError('sparse_profiles_storage_changed')

    def rows(self):
        from package import VerifiedStream
        def iterate():
            count=members=0;self.assert_unchanged()
            for original,compact,vector,multiplicity,first,compressed in self.connection.execute(
                    'SELECT original,compact,vector_ordinal,members,first_membership,fields FROM profiles ORDER BY original'):
                if (len(original)!=32 or len(compact)!=32
                        or any(type(value) is not int or not 0<=value<2**53 for value in [vector,first])
                        or type(multiplicity) is not int or not 0<multiplicity<=self.manifest['members']
                        or len(compressed)>8*1024*1024):
                    raise ValueError('sparse_profiles_row_invalid')
                decoder=zlib.decompressobj();raw=decoder.decompress(compressed,8*1024*1024+1)
                if len(raw)>8*1024*1024 or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
                    raise ValueError('sparse_profiles_fields_encoding_invalid')
                fields=json.loads(raw)
                if (not isinstance(fields,dict) or set(fields)!={'title','hierarchy','article','text'}
                        or any(not isinstance(value,str) for value in fields.values())):
                    raise ValueError('sparse_profiles_fields_invalid')
                count+=1;members+=multiplicity
                if count%1024==0:self.assert_unchanged()
                yield {'id':original.hex(),'compact':compact.hex(),'vector_ordinal':vector,
                       'first_membership':first,'members':multiplicity,'fields':fields}
            self.assert_unchanged()
            if count!=self.manifest['profiles'] or members!=self.manifest['members']:
                raise ValueError('sparse_profiles_population_mismatch')
        return VerifiedStream(iterate)

    def close(self):self.connection.close()
