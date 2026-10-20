"""Lossless bounded sparse posting runs for external merge and later search.

Rows are (term hash, profile ordinal, four field frequencies, membership weight).
These runs are intermediate artifacts, not complete search indexes. Term and
ordinal ordering permits bounded merge without a corpus-sized in-memory sort.
"""
import hashlib
import heapq
import json
import os
import pathlib
import sqlite3
from works import file_hash,signature
from membership import sync_directory

MAX_INTEGER=2**53-1
BLOCK_ROWS=1024


def varint(value):
    if type(value) is not int or not 0<=value<=MAX_INTEGER:raise ValueError('sparse_integer_invalid')
    output=bytearray()
    while value>=128:output.append((value&127)|128);value>>=7
    output.append(value);return output


def integers(raw):
    value=shift=0
    for byte in raw:
        value|=(byte&127)<<shift
        if value>MAX_INTEGER or shift>49:raise ValueError('sparse_integer_overflow')
        if byte&128:shift+=7
        else:
            if shift and byte==0:raise ValueError('sparse_integer_noncanonical')
            yield value;value=shift=0
    if shift:raise ValueError('sparse_integer_truncated')


def write_posting_run(rows,root,profiles_sha256,checkpoint=None):
    if not isinstance(profiles_sha256,str) or len(profiles_sha256)!=64 or any(c not in '0123456789abcdef' for c in profiles_sha256):
        raise ValueError('sparse_profiles_pin_invalid')
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=False)
    db=sqlite3.connect(root/'lexicon.sqlite');count=blocks=terms=0
    db.execute('PRAGMA journal_mode=DELETE');db.execute('PRAGMA synchronous=FULL')
    db.execute('PRAGMA cache_size=-8192')
    db.execute('''CREATE TABLE blocks(term BLOB NOT NULL,block INTEGER NOT NULL,offset INTEGER NOT NULL,
        bytes INTEGER NOT NULL,rows INTEGER NOT NULL,frequency INTEGER NOT NULL,sha BLOB NOT NULL,
        PRIMARY KEY(term,block)) WITHOUT ROWID''')
    try:
        with (root/'postings.bin').open('xb') as output:
            term=None;previous_key=None;previous=-1;block=0;raw=bytearray();size=frequency=0
            def flush():
                nonlocal blocks,block,raw,size,frequency,previous
                if not size:return
                offset=output.tell();output.write(raw)
                db.execute('INSERT INTO blocks VALUES(?,?,?,?,?,?,?)',
                    (term,block,offset,len(raw),size,frequency,hashlib.sha256(raw).digest()))
                blocks+=1;block+=1;raw=bytearray();size=frequency=0;previous=-1
                if blocks%100==0:
                    db.commit()
                    if checkpoint:checkpoint({'phase':'sparse-postings','rows':count,'blocks':blocks,'bytes':output.tell()})
            for row_term,ordinal,frequencies,weight in rows:
                if (not isinstance(row_term,bytes) or len(row_term)!=32
                        or type(ordinal) is not int or not 0<=ordinal<=MAX_INTEGER
                        or not isinstance(frequencies,(list,tuple)) or len(frequencies)!=4
                        or any(type(v) is not int or not 0<=v<=MAX_INTEGER for v in frequencies)
                        or not any(frequencies) or type(weight) is not int or not 1<=weight<=MAX_INTEGER):
                    raise ValueError('sparse_posting_invalid')
                key=(row_term,ordinal)
                if previous_key is not None and key<=previous_key:raise ValueError('sparse_postings_order_invalid')
                if term!=row_term:
                    flush();term=row_term;block=0;terms+=1
                if frequency+weight>MAX_INTEGER:raise ValueError('sparse_frequency_overflow')
                for value in (ordinal-previous,weight,*frequencies):raw.extend(varint(value))
                previous=ordinal;previous_key=key;size+=1;frequency+=weight;count+=1
                if size==BLOCK_ROWS:flush()
            flush();db.commit();output.flush();os.fsync(output.fileno())
        if db.execute('PRAGMA integrity_check').fetchone()!=('ok',):raise ValueError('sparse_lexicon_invalid')
        db.close()
        artifacts={}
        for name in ['postings.bin','lexicon.sqlite']:
            path=root/name
            with path.open('r+b') as source:os.fsync(source.fileno())
            artifacts[name]={'bytes':path.stat().st_size,'sha256':file_hash(path)}
        manifest={'format':'prepared-sparse-posting-run-v1','complete':True,'search_index':False,
                  'profiles_sha256':profiles_sha256,'rows':count,'blocks':blocks,'terms':terms,
                  'block_rows':BLOCK_ROWS,'codec':'delta-profile-weight-field-varint-v1','artifacts':artifacts}
        encoded=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
        with (root/'manifest.json').open('xb') as target:target.write(encoded);target.flush();os.fsync(target.fileno())
        sync_directory(root);return hashlib.sha256(encoded).hexdigest()
    finally:db.close()


class PostingRun:
    def __init__(self,root,manifest_sha256,profiles_sha256):
        self.root=pathlib.Path(root).resolve(strict=True);path=self.root/'manifest.json'
        if path.is_symlink() or path.stat().st_size>8192 or file_hash(path)!=manifest_sha256:
            raise ValueError('sparse_run_manifest_mismatch')
        self.manifest=json.loads(path.read_bytes());m=self.manifest
        if (m.get('format')!='prepared-sparse-posting-run-v1' or m.get('complete') is not True
                or m.get('search_index') is not False or m.get('profiles_sha256')!=profiles_sha256
                or m.get('block_rows')!=BLOCK_ROWS or m.get('codec')!='delta-profile-weight-field-varint-v1'
                or any(type(m.get(key)) is not int or not 0<=m[key]<=MAX_INTEGER for key in ['rows','blocks','terms'])
                or set(m.get('artifacts',{}))!={'postings.bin','lexicon.sqlite'}):
            raise ValueError('sparse_run_manifest_invalid')
        self.signatures={}
        for name,receipt in m['artifacts'].items():
            path=self.root/name
            if path.is_symlink() or path.stat().st_size!=receipt['bytes'] or file_hash(path)!=receipt['sha256']:
                raise ValueError('sparse_run_artifact_mismatch')
            self.signatures[name]=signature(path)
        self.connection=sqlite3.connect((self.root/'lexicon.sqlite').as_uri()+'?mode=ro&immutable=1',uri=True)
        self.connection.execute('PRAGMA query_only=ON');self.connection.execute('PRAGMA cache_size=-2048')

    def assert_unchanged(self):
        if any(signature(self.root/name)!=value for name,value in self.signatures.items()):
            raise ValueError('sparse_run_storage_changed')

    def rows(self):
        from package import VerifiedStream
        def iterate():
            self.assert_unchanged();count=blocks=terms=offset=0;previous_key=None;previous_term=None;expected_block=0
            with (self.root/'postings.bin').open('rb') as source:
                for term,block,start,length,size,frequency,digest in self.connection.execute('SELECT * FROM blocks ORDER BY term,block'):
                    self.assert_unchanged()
                    if term!=previous_term:terms+=1;expected_block=0;previous_term=term
                    if (not isinstance(term,bytes) or len(term)!=32 or block!=expected_block or start!=offset
                            or not 1<=size<=BLOCK_ROWS or not 6*size<=length<=48*size):
                        raise ValueError('sparse_run_block_invalid')
                    raw=source.read(length)
                    if len(raw)!=length or hashlib.sha256(raw).digest()!=digest:raise ValueError('sparse_run_block_hash_mismatch')
                    values=iter(integers(raw));previous=-1;weight_sum=0
                    for _ in range(size):
                        row=[next(values,None) for _ in range(6)]
                        if None in row or row[0]<1 or row[1]<1 or not any(row[2:]):raise ValueError('sparse_run_row_invalid')
                        ordinal=previous+row[0];key=(term,ordinal)
                        if ordinal>MAX_INTEGER or previous_key is not None and key<=previous_key:raise ValueError('sparse_run_order_invalid')
                        previous=ordinal;previous_key=key;weight_sum+=row[1];count+=1
                        yield term,ordinal,tuple(row[2:]),row[1]
                    if next(values,None) is not None or weight_sum!=frequency:raise ValueError('sparse_run_block_population_invalid')
                    offset+=length;blocks+=1;expected_block+=1
            self.assert_unchanged()
            if (count,blocks,terms,offset)!=(self.manifest['rows'],self.manifest['blocks'],self.manifest['terms'],self.manifest['artifacts']['postings.bin']['bytes']):
                raise ValueError('sparse_run_population_invalid')
        return VerifiedStream(iterate)

    def term_rows(self,term,check_deadline=lambda:None):
        """Seek only the requested word; full consumption authenticates its population."""
        from package import VerifiedStream
        if not isinstance(term,bytes) or len(term)!=32:raise ValueError('sparse_term_invalid')
        check_deadline();self.assert_unchanged()
        population=self.connection.execute('SELECT coalesce(sum(rows),0),coalesce(sum(frequency),0),count(*) FROM blocks WHERE term=?',(term,)).fetchone()
        def iterate():
            count=frequency_sum=blocks=0;last=-1
            with (self.root/'postings.bin').open('rb') as source:
                for block,offset,length,size,frequency,digest in self.connection.execute(
                        'SELECT block,offset,bytes,rows,frequency,sha FROM blocks WHERE term=? ORDER BY block',(term,)):
                    check_deadline();self.assert_unchanged()
                    if (block!=blocks or not 1<=size<=BLOCK_ROWS or not 6*size<=length<=48*size
                            or offset<0 or offset+length>self.manifest['artifacts']['postings.bin']['bytes']):
                        raise ValueError('sparse_term_block_invalid')
                    source.seek(offset);raw=source.read(length)
                    if len(raw)!=length or hashlib.sha256(raw).digest()!=digest:raise ValueError('sparse_term_hash_mismatch')
                    values=iter(integers(raw));previous=-1;weight_sum=0
                    for _ in range(size):
                        row=[next(values,None) for _ in range(6)]
                        if None in row or row[0]<1 or row[1]<1 or not any(row[2:]):raise ValueError('sparse_term_row_invalid')
                        ordinal=previous+row[0]
                        if not last<ordinal<=MAX_INTEGER:raise ValueError('sparse_term_order_invalid')
                        last=previous=ordinal;weight_sum+=row[1];count+=1
                        yield ordinal,tuple(row[2:]),row[1]
                    if next(values,None) is not None or weight_sum!=frequency:raise ValueError('sparse_term_population_invalid')
                    frequency_sum+=frequency;blocks+=1
            check_deadline();self.assert_unchanged()
            if (count,frequency_sum,blocks)!=population:raise ValueError('sparse_term_population_invalid')
        check_deadline();return population[1],VerifiedStream(iterate)

    def close(self):self.connection.close()


def merge_posting_runs(runs,root,profiles_sha256,checkpoint=None):
    if not 1<=len(runs)<=32 or any(run.manifest['profiles_sha256']!=profiles_sha256 for run in runs):
        raise ValueError('sparse_merge_inputs_invalid')
    streams=[run.rows() for run in runs]
    def merged():
        yield from heapq.merge(*streams,key=lambda row:(row[0],row[1]))
        if not all(stream.verified for stream in streams):raise ValueError('sparse_merge_source_unverified')
    return write_posting_run(merged(),root,profiles_sha256,checkpoint)
