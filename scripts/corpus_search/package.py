"""Authenticated streaming access to a sealed prepared corpus package.

A stream is verified only after exhaustion. Importers must stage their output
and commit its receipt only after `verified` is true; yielded rows alone are
not proof that a complete source partition was imported.
"""
import hashlib
import io
import json
import pathlib


def file_hash(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source,'sha256').hexdigest()


class VerifiedStream:
    def __init__(self,iterate):
        self._iterate=iterate
        self.verified=False
        self.started=False

    def __iter__(self):
        if self.started:
            raise ValueError('package_stream_already_consumed')
        self.started=True
        yield from self._iterate()
        self.verified=True


class PreparedPackage:
    def __init__(self,root,manifest_sha256):
        self.root=pathlib.Path(root).resolve(strict=True)
        path=self.root/'package-manifest.json'
        if file_hash(path)!=manifest_sha256:
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
        if file_hash(source)!=self.embeddings['pin']['source_manifest_sha256']:
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
        if not path.is_relative_to(self.root) or path.stat().st_size!=expected['bytes'] or file_hash(path)!=expected['sha256']:
            raise ValueError('package_file_receipt_mismatch')
        if receipt is not None and (receipt['bytes']!=expected['bytes'] or receipt['sha256']!=expected['sha256']):
            raise ValueError('package_projection_receipt_mismatch')
        return path

    def read_json(self,name):
        return json.loads(self.checked(name).read_bytes())

    def records(self,kind,part,max_record_bytes=128*1024*1024):
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
        if type(part) is not int or not 0<=part<len(self.memberships['receipts']):
            raise ValueError('package_membership_partition_invalid')
        receipt=self.memberships['receipts'][part]
        if receipt.get('format')!='binary-membership-parquet-v1':
            raise ValueError('package_membership_format_unsupported')
        def iterate():
            import duckdb
            path=self.checked('memberships/'+receipt['path'],receipt)
            connection=duckdb.connect(config={'threads':1,'memory_limit':'256MB'})
            digest=hashlib.sha256();count=0;size=0
            try:
                cursor=connection.execute('SELECT chunk,input_hash,work FROM read_parquet(?)',[str(path)])
                while batch:=cursor.fetchmany(4096):
                    for chunk,original,work in batch:
                        if not isinstance(chunk,bytes) or len(chunk)!=32 or not isinstance(original,bytes) or len(original)!=32 or not isinstance(work,str):
                            raise ValueError('package_membership_record_invalid')
                        line=('{"chunk":"retrieval-chunk-v1:'+chunk.hex()+'","input":"'+original.hex()+'","work":'+json.dumps(work,ensure_ascii=False)+'}\n').encode()
                        digest.update(line);size+=len(line)
                        yield self.membership_offsets[part]+count,chunk,original,work
                        count+=1
            finally:
                connection.close()
            source=receipt['source_receipt']
            if (count,size,digest.hexdigest())!=(source['count'],source['uncompressed_bytes'],source['uncompressed_sha256']) or count!=receipt['rows']:
                raise ValueError('package_membership_reconstruction_mismatch')
        return VerifiedStream(iterate)

    def mapping_rows(self,part):
        receipts=self.embeddings['mapping_receipts']
        if type(part) is not int or not 0<=part<len(receipts):
            raise ValueError('package_mapping_partition_invalid')
        receipt=receipts[part]
        def iterate():
            import duckdb
            path=self.checked('embedding-inputs/'+receipt['path'],receipt)
            identity=lambda:tuple(getattr(path.stat(),field) for field in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns'))
            before=identity()
            connection=duckdb.connect(config={'threads':1,'memory_limit':'256MB'});count=0
            try:
                cursor=connection.execute('SELECT original_hash,input_hash,locator FROM read_parquet(?)',[str(path)])
                while batch:=cursor.fetchmany(4096):
                    for original,compact,locator in batch:
                        if not isinstance(original,bytes) or len(original)!=32 or not isinstance(compact,bytes) or len(compact)!=32 or not isinstance(locator,str):
                            raise ValueError('package_mapping_record_invalid')
                        count+=1
                        yield original,compact,locator
            finally:
                connection.close()
            if count!=receipt['rows']:
                raise ValueError('package_mapping_count_mismatch')
            if identity()!=before:raise ValueError('package_mapping_storage_changed')
        return VerifiedStream(iterate)

    def input_rows(self,part):
        receipts=self.embeddings['input_receipts']
        if type(part) is not int or not 0<=part<len(receipts):raise ValueError('package_input_partition_invalid')
        receipt=receipts[part]
        def iterate():
            import duckdb
            path=self.checked('embedding-inputs/'+receipt['path'],receipt)
            def identity():
                s=path.stat();return s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns
            before=identity();connection=duckdb.connect(config={'threads':1,'memory_limit':'256MB'});count=0;tokens=0
            try:
                cursor=connection.execute('SELECT input_hash,input,tokens FROM read_parquet(?)',[str(path)])
                while batch:=cursor.fetchmany(4096):
                    for key,text,n in batch:
                        if (not isinstance(key,bytes) or len(key)!=32 or not isinstance(text,str)
                                or len(text)>1048576 or type(n) is not int or n<=0
                                or hashlib.sha256(text.encode('utf-8')).digest()!=key):
                            raise ValueError('package_input_identity_invalid')
                        yield count,key,text,n
                        count+=1;tokens+=n
            finally:connection.close()
            if (count,tokens)!=(receipt['rows'],receipt['tokens']):raise ValueError('package_input_totals_mismatch')
            if identity()!=before:raise ValueError('package_input_storage_changed')
        return VerifiedStream(iterate)
