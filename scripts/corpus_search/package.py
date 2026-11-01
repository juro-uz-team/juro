"""Authenticated streaming access to a sealed prepared corpus package.

A stream is verified only after exhaustion. Importers must stage their output
and commit its receipt only after `verified` is true; yielded rows alone are
not proof that a complete source partition was imported.
"""
import hashlib
import io
import json
import pathlib
from contextlib import contextmanager
from types import SimpleNamespace
from cancellation import check_cancelled, cancel_connection


@contextmanager
def parquet_connection():
    import duckdb
    check_cancelled()
    connection=duckdb.connect(config={'threads':1,'memory_limit':'256MB'})
    try:
        with cancel_connection(SimpleNamespace(cancel=connection.interrupt)):
            yield connection
    finally:connection.close()


def file_hash(path):
    with path.open('rb') as source:
        digest=hashlib.sha256()
        while True:
            check_cancelled()
            block=source.read(1024*1024)
            if not block:break
            digest.update(block)
        return digest.hexdigest()


class VerifiedStream:
    def __init__(self,iterate):
        self._iterate=iterate
        self.verified=False
        self.started=False

    def __iter__(self):
        if self.started:
            raise ValueError('package_stream_already_consumed')
        self.started=True
        iterator=iter(self._iterate())
        try:
            while True:
                check_cancelled()
                try:row=next(iterator)
                except StopIteration:break
                check_cancelled()
                yield row
                del row
            check_cancelled()
            self.verified=True
        finally:
            close=getattr(iterator,'close',None)
            if close is not None:close()


class PreparedPackage:
    trust_prepared=False
    def __init__(self,root,manifest_sha256,*,trust_prepared=False):
        if type(trust_prepared) is not bool:raise ValueError('package_trust_policy_invalid')
        self.trust_prepared=trust_prepared
        self.root=pathlib.Path(root).resolve(strict=True)
        path=self.root/'package-manifest.json'
        if not trust_prepared and file_hash(path)!=manifest_sha256:
            raise ValueError('package_manifest_pin_mismatch')
        self.sha256=manifest_sha256
        self.manifest=json.loads(path.read_bytes())
        self.files={}
        for receipt in self.manifest['files']:
            name=receipt['path'].replace('\\','/')
            if name in self.files:
                raise ValueError('package_duplicate_path')
            self.files[name]=receipt
        self.handoff=self.read_json('provenance/handoff-manifest.json')
        self.memberships=self.read_json('memberships/manifest.json')
        self.embeddings=self.read_json('embedding-inputs/manifest.json')
        if (self.memberships.get('status')!='exact_projection_verified'
                or self.memberships.get('pin',{}).get('format')!='membership-storage-v1'
                or self.memberships['pin']['source_manifest_sha256']!=self.files['provenance/handoff-manifest.json']['sha256']
                or self.embeddings.get('status')!='exact_projection_verified'
                or self.embeddings.get('format')!='legal-embedding-storage-v1'):
            raise ValueError('package_projection_unverified')
        if self.embeddings.get('configuration')!={'model':'text-embedding-3-large','dimensions':3072,
                'tokenizer':'cl100k_base','codec_version':'legal-embedding-input-compact-v2'}:
            raise ValueError('package_embedding_configuration_mismatch')
        source=self.checked('embedding-inputs/source-manifest.json')
        if (self.files['embedding-inputs/source-manifest.json']['sha256']!=self.embeddings['pin']['source_manifest_sha256']
                or (not trust_prepared and file_hash(source)!=self.embeddings['pin']['source_manifest_sha256'])):
            raise ValueError('package_embedding_lineage_mismatch')
        self.membership_offsets=[]
        total=0
        for receipt in self.memberships['receipts']:
            self.membership_offsets.append(total)
            total+=receipt['rows']
        if total!=self.memberships['rows'] or total!=self.handoff['memberships']:
            raise ValueError('package_membership_count_mismatch')

    def checked(self,name,receipt=None):
        name=name.replace('\\','/')
        if name not in self.files:
            raise ValueError('package_file_not_registered')
        expected=self.files[name]
        path=(self.root/name).resolve(strict=True)
        if not path.is_relative_to(self.root) or path.stat().st_size!=expected['bytes'] or (not self.trust_prepared and file_hash(path)!=expected['sha256']):
            raise ValueError('package_file_receipt_mismatch')
        if receipt is not None and (receipt['bytes']!=expected['bytes'] or receipt['sha256']!=expected['sha256']):
            raise ValueError('package_projection_receipt_mismatch')
        return path

    def read_json(self,name):
        return json.loads(self.checked(name).read_bytes())

    def records(self,kind,part,max_record_bytes=128*1024*1024):
        if self.trust_prepared:raise ValueError('package_retained_projection_required')
        if type(max_record_bytes) is not int or not 1<=max_record_bytes<=128*1024*1024:
            raise ValueError('package_source_record_limit_invalid')
        receipts=self.handoff['shards'].get(kind)
        if not isinstance(receipts,list) or type(part) is not int or not 0<=part<len(receipts):
            raise ValueError('package_source_partition_invalid')
        receipt=receipts[part]
        if receipt.get('record_format')!='jsonl' or receipt.get('compression')!='zstd':
            raise ValueError('package_source_format_invalid')
        def iterate():
            import zstandard
            path=self.checked('corpus/'+receipt['path'],receipt)
            digest=hashlib.sha256();count=0;size=0
            with path.open('rb') as source,zstandard.ZstdDecompressor().stream_reader(source) as decompressed,io.BufferedReader(decompressed) as lines:
                while line:=lines.readline(max_record_bytes+1):
                    if len(line)>max_record_bytes or not line.endswith(b'\n'):
                        raise ValueError('package_source_record_bound')
                    digest.update(line);size+=len(line);count+=1
                    value=json.loads(line)
                    if not isinstance(value,dict):
                        raise ValueError('package_source_record_invalid')
                    yield count-1,value
                    # Do not retain a potentially large parsed document while
                    # allocating and decoding the next source record.
                    del value,line
            if (count,size,digest.hexdigest())!=(receipt['count'],receipt['uncompressed_bytes'],receipt['uncompressed_sha256']):
                raise ValueError('package_source_reconstruction_mismatch')
        return VerifiedStream(iterate)

    def membership_rows(self,part):
        if self.trust_prepared:raise ValueError('package_retained_projection_required')
        if type(part) is not int or not 0<=part<len(self.memberships['receipts']):
            raise ValueError('package_membership_partition_invalid')
        receipt=self.memberships['receipts'][part]
        if receipt.get('format')!='binary-membership-parquet-v1':
            raise ValueError('package_membership_format_unsupported')
        def iterate():
            path=self.checked('memberships/'+receipt['path'],receipt)
            digest=hashlib.sha256();count=0;size=0
            with parquet_connection() as connection:
                cursor=connection.execute('SELECT chunk,input_hash,work FROM read_parquet(?)',[str(path)])
                while batch:=cursor.fetchmany(4096):
                    for chunk,original,work in batch:
                        if not isinstance(chunk,bytes) or len(chunk)!=32 or not isinstance(original,bytes) or len(original)!=32 or not isinstance(work,str):
                            raise ValueError('package_membership_record_invalid')
                        line=('{"chunk":"retrieval-chunk-v1:'+chunk.hex()+'","input":"'+original.hex()+'","work":'+json.dumps(work,ensure_ascii=False)+'}\n').encode()
                        digest.update(line);size+=len(line)
                        yield self.membership_offsets[part]+count,chunk,original,work
                        count+=1
            source=receipt['source_receipt']
            if (count,size,digest.hexdigest())!=(source['count'],source['uncompressed_bytes'],source['uncompressed_sha256']) or count!=receipt['rows']:
                raise ValueError('package_membership_reconstruction_mismatch')
        return VerifiedStream(iterate)

    def mapping_rows(self,part):
        if self.trust_prepared:raise ValueError('package_retained_projection_required')
        receipts=self.embeddings['mapping_receipts']
        if type(part) is not int or not 0<=part<len(receipts):
            raise ValueError('package_mapping_partition_invalid')
        receipt=receipts[part]
        def iterate():
            path=self.checked('embedding-inputs/'+receipt['path'],receipt)
            identity=lambda:tuple(getattr(path.stat(),field) for field in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns'))
            before=identity()
            count=0
            with parquet_connection() as connection:
                cursor=connection.execute('SELECT original_hash,input_hash,locator FROM read_parquet(?)',[str(path)])
                while batch:=cursor.fetchmany(4096):
                    for original,compact,locator in batch:
                        if not isinstance(original,bytes) or len(original)!=32 or not isinstance(compact,bytes) or len(compact)!=32 or not isinstance(locator,str):
                            raise ValueError('package_mapping_record_invalid')
                        count+=1
                        yield original,compact,locator
            if count!=receipt['rows']:
                raise ValueError('package_mapping_count_mismatch')
            if identity()!=before:raise ValueError('package_mapping_storage_changed')
        return VerifiedStream(iterate)

    def input_rows_at(self,part,requested):
        """Validate every compact input, then materialize only selected rows.

        SQL checks the same decoded values as input_rows. Selected ordinals are
        physical Parquet row positions, never an inferred ordering or identity.
        The complete compressed receipt remains a prerequisite for both scans.
        """
        receipts=self.embeddings['input_receipts']
        if type(part) is not int or not 0<=part<len(receipts):raise ValueError('package_input_partition_invalid')
        receipt=receipts[part]
        if (not isinstance(requested,(list,tuple)) or len(requested)>128
                or any(type(row) is not int or not 0<=row<receipt['rows'] for row in requested)):
            raise ValueError('package_input_selection_invalid')
        selected=sorted(set(requested))
        if self.trust_prepared:
            return self._retained_input_rows_at(receipt,selected)
        def iterate():
            path=self.checked('embedding-inputs/'+receipt['path'],receipt)
            def identity():
                s=path.stat();return s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns
            before=identity()
            with parquet_connection() as connection:
                schema=connection.execute('DESCRIBE SELECT input_hash,input,tokens FROM read_parquet(?)',[str(path)]).fetchall()
                integers={'TINYINT','SMALLINT','INTEGER','BIGINT','UTINYINT','USMALLINT','UINTEGER','UBIGINT'}
                if ([row[1] for row in schema[:2]]!=['BLOB','VARCHAR'] or schema[2][1] not in integers):
                    raise ValueError('package_input_identity_invalid')
                count,tokens,invalid=connection.execute('''SELECT count(*),coalesce(sum(tokens),0),
                    count(*) FILTER (WHERE input_hash IS NULL OR input IS NULL OR tokens IS NULL
                        OR octet_length(input_hash)<>32 OR length(input)>1048576 OR tokens<=0
                        OR sha256(input)<>lower(hex(input_hash)))
                    FROM read_parquet(?)''',[str(path)]).fetchone()
                if invalid:raise ValueError('package_input_identity_invalid')
                if (count,tokens)!=(receipt['rows'],receipt['tokens']):raise ValueError('package_input_totals_mismatch')
                if identity()!=before:raise ValueError('package_input_storage_changed')
                rows=connection.execute('''SELECT file_row_number,input_hash,input,tokens
                    FROM read_parquet(?,file_row_number=true)
                    WHERE file_row_number IN (SELECT unnest(?::BIGINT[])) ORDER BY file_row_number''',
                    [str(path),selected]).fetchall()
                if [row[0] for row in rows]!=selected:raise ValueError('package_input_selection_missing')
                if identity()!=before:raise ValueError('package_input_storage_changed')
                yield from rows
            if identity()!=before:raise ValueError('package_input_storage_changed')
        return VerifiedStream(iterate)

    def _retained_input_rows_at(self,receipt,selected):
        """Read selected prepared rows without scanning or reauthenticating a partition."""
        def iterate():
            path=self.checked('embedding-inputs/'+receipt['path'],receipt)
            def identity():
                s=path.stat();return s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns
            before=identity()
            with parquet_connection() as connection:
                rows=connection.execute('''SELECT file_row_number,input_hash,input,tokens
                    FROM read_parquet(?,file_row_number=true)
                    WHERE file_row_number IN (SELECT unnest(?::BIGINT[])) ORDER BY file_row_number''',
                    [str(path),selected]).fetchall()
            if identity()!=before:raise ValueError('package_input_storage_changed')
            if [row[0] for row in rows]!=selected:raise ValueError('package_input_selection_missing')
            for row,key,text,tokens in rows:
                if (not isinstance(key,bytes) or len(key)!=32 or not isinstance(text,str)
                        or len(text)>1048576 or type(tokens) is not int or tokens<=0):
                    raise ValueError('package_input_identity_invalid')
                yield row,key,text,tokens
            if identity()!=before:raise ValueError('package_input_storage_changed')
        return VerifiedStream(iterate)

    def input_rows(self,part):
        if self.trust_prepared:raise ValueError('package_retained_projection_required')
        receipts=self.embeddings['input_receipts']
        if type(part) is not int or not 0<=part<len(receipts):raise ValueError('package_input_partition_invalid')
        receipt=receipts[part]
        def iterate():
            path=self.checked('embedding-inputs/'+receipt['path'],receipt)
            def identity():
                s=path.stat();return s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns
            before=identity();count=0;tokens=0
            with parquet_connection() as connection:
                cursor=connection.execute('SELECT input_hash,input,tokens FROM read_parquet(?)',[str(path)])
                while batch:=cursor.fetchmany(4096):
                    for key,text,n in batch:
                        if (not isinstance(key,bytes) or len(key)!=32 or not isinstance(text,str)
                                or len(text)>1048576 or type(n) is not int or n<=0
                                or hashlib.sha256(text.encode('utf-8')).digest()!=key):
                            raise ValueError('package_input_identity_invalid')
                        yield count,key,text,n
                        count+=1;tokens+=n
            if (count,tokens)!=(receipt['rows'],receipt['tokens']):raise ValueError('package_input_totals_mismatch')
            if identity()!=before:raise ValueError('package_input_storage_changed')
        return VerifiedStream(iterate)
