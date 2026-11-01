"""Authenticated, bounded random reads of prepared source records.

Publication consumes each original VerifiedStream in full. Independent zstd
frames preserve complete records; physical (part,row) locations do not change.
No source classifications, legal eligibility or corpus selection are inferred.
"""
import bisect
import hashlib
import json
import os
import pathlib
import shutil
import struct
import tempfile
from array import array

import zstandard
from cancellation import check_cancelled
from membership import sync_directory
from package import VerifiedStream, file_hash
from prepared import canonical
from works import signature

KINDS=('chunks','inventory','prepared')
BLOCK_ROWS=1024
BLOCK_BYTES=8*1024*1024
MAX_RECORD_BYTES=128*1024*1024
INDEX_CAPACITY=512*1024*1024
INDEX=struct.Struct('<QQIII32s')
FORMAT='prepared-source-blocks-v1'


def digest(raw):return hashlib.sha256(raw).hexdigest()


def source_receipt(package,kind,part):
    if kind not in KINDS or type(part) is not int or not 0<=part<len(package.handoff['shards'][kind]):
        raise ValueError('source_projection_partition_invalid')
    return package.handoff['shards'][kind][part]


def write_file(path,raw):
    with path.open('xb') as target:
        target.write(raw);target.flush();os.fsync(target.fileno())


def part_name(kind,part):return f'{kind}-{part:06d}'


def publish_part(package,root,kind,part,*,existing_pin=None,reserve_bytes=8*1024**3):
    """Publish one complete part; failures leave unadmitted staging files.

    A completed part is reusable only after its receipt, bytes and index verify.
    An operator must use a fresh staging root after an interrupted part build;
    completed sibling parts need not be rebuilt.
    """
    receipt=source_receipt(package,kind,part)
    if type(reserve_bytes) is not int or reserve_bytes<0:raise ValueError('source_projection_reserve_invalid')
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=True)
    target=root/part_name(kind,part)
    if target.exists():
        if existing_pin is None:raise ValueError('source_projection_resume_pin_required')
        with SourcePart(target,existing_pin,package,kind,part) as existing:
            return existing.pin
    staging=pathlib.Path(tempfile.mkdtemp(prefix=part_name(kind,part)+'.partial-',dir=root))
    count=0;offset=0;block=[];block_bytes=0;first=0
    compressor=zstandard.ZstdCompressor(level=3)
    with (staging/'records.zst').open('xb') as data,(staging/'rows.idx').open('xb') as index:
        def flush():
            nonlocal offset,block,block_bytes,first
            if not block:return
            raw=b''.join(block);encoded=compressor.compress(raw)
            if shutil.disk_usage(root).free<len(encoded)+reserve_bytes:
                raise ValueError('source_projection_disk_reserve')
            data.write(encoded)
            index.write(INDEX.pack(first,offset,len(encoded),len(raw),len(block),hashlib.sha256(encoded).digest()))
            offset+=len(encoded);first+=len(block);block=[];block_bytes=0
        stream=package.records(kind,part)
        for ordinal,row in stream:
            check_cancelled()
            if ordinal!=count:raise ValueError('source_projection_row_order')
            raw=canonical(row)+b'\n'
            if len(raw)>MAX_RECORD_BYTES:raise ValueError('source_projection_record_bound')
            if block and (len(block)>=BLOCK_ROWS or block_bytes+len(raw)>BLOCK_BYTES):flush()
            block.append(raw);block_bytes+=len(raw);count+=1
            del row,raw
        if not stream.verified or count!=receipt['count']:
            raise ValueError('source_projection_source_unverified')
        flush()
        for output in (data,index):output.flush();os.fsync(output.fileno())
    check_cancelled()
    manifest={'format':FORMAT,'package_sha256':package.sha256,'kind':kind,'part':part,
              'source_receipt_sha256':digest(canonical(receipt)),'rows':count,
              'block_rows':BLOCK_ROWS,'block_bytes':BLOCK_BYTES,'max_record_bytes':MAX_RECORD_BYTES,
              'files':{name:{'bytes':(staging/name).stat().st_size,'sha256':file_hash(staging/name)}
                       for name in ('records.zst','rows.idx')}}
    raw=canonical(manifest);write_file(staging/'manifest.json',raw)
    sync_directory(staging);os.rename(staging,target);sync_directory(root)
    return digest(raw)


class SourcePart:
    def __init__(self,root,pin,package,kind,part,*,max_index_bytes=INDEX_CAPACITY,trust_prepared=False):
        self.trust_prepared=trust_prepared
        self.root=pathlib.Path(root).resolve(strict=True);self.pin=pin
        receipt=source_receipt(package,kind,part)
        manifest_path=self.root/'manifest.json'
        if manifest_path.is_symlink() or manifest_path.stat().st_size>4096:
            raise ValueError('source_projection_manifest_invalid')
        manifest_identity=signature(manifest_path);raw=manifest_path.read_bytes()
        if signature(manifest_path)!=manifest_identity:raise ValueError('source_projection_storage_changed')
        if not trust_prepared and digest(raw)!=pin:raise ValueError('source_projection_manifest_mismatch')
        m=json.loads(raw);self.manifest=m
        expected={'format':FORMAT,'package_sha256':package.sha256,'kind':kind,'part':part,
                  'source_receipt_sha256':digest(canonical(receipt)),'rows':receipt['count'],
                  'block_rows':BLOCK_ROWS,'block_bytes':BLOCK_BYTES,'max_record_bytes':MAX_RECORD_BYTES}
        if any(m.get(k)!=v for k,v in expected.items()) or set(m.get('files',{}))!={'records.zst','rows.idx'}:
            raise ValueError('source_projection_lineage_mismatch')
        self.paths=[manifest_path];self.identities=[manifest_identity]
        for name in ('records.zst','rows.idx'):
            path=self.root/name;file=m['files'][name]
            if type(file.get('bytes')) is not int or file['bytes']<0:
                raise ValueError('source_projection_file_mismatch')
            if name=='rows.idx' and file['bytes']>max_index_bytes:
                raise ValueError('source_projection_index_capacity')
            before=signature(path)
            if path.is_symlink() or path.stat().st_size!=file['bytes'] or (not trust_prepared and file_hash(path)!=file['sha256']):
                raise ValueError('source_projection_file_mismatch')
            if signature(path)!=before:raise ValueError('source_projection_storage_changed')
            self.paths.append(path);self.identities.append(before)
        raw=self.paths[2].read_bytes()
        if len(raw)%INDEX.size:raise ValueError('source_projection_index_invalid')
        self.blocks=raw;self.starts=array('Q');row=0;offset=0
        for first,position,size,decoded,count,sha in INDEX.iter_unpack(raw):
            check_cancelled()
            if (first!=row or position!=offset or not 1<=count<=BLOCK_ROWS or not 1<=size<=MAX_RECORD_BYTES+MAX_RECORD_BYTES//256+1024
                    or not 1<=decoded<=MAX_RECORD_BYTES or (decoded>BLOCK_BYTES and count!=1)):
                raise ValueError('source_projection_index_invalid')
            self.starts.append(first);row+=count;offset+=size
        if row!=m['rows'] or offset!=m['files']['records.zst']['bytes']:
            raise ValueError('source_projection_population_mismatch')
        self.assert_unchanged()

    def assert_unchanged(self):
        check_cancelled()
        if [signature(path) for path in self.paths]!=self.identities:
            raise ValueError('source_projection_storage_changed')

    def records_at(self,requested,*,decode_record=None):
        if (not isinstance(requested,(list,tuple)) or len(requested)>2000
                or any(type(row) is not int or not 0<=row<self.manifest['rows'] for row in requested)):
            raise ValueError('source_projection_selection_invalid')
        selected=sorted(set(requested))
        def iterate():
            self.assert_unchanged();groups={}
            for row in selected:groups.setdefault(bisect.bisect_right(self.starts,row)-1,set()).add(row)
            with self.paths[1].open('rb') as source:
                for block,rows in groups.items():
                    self.assert_unchanged()
                    first,offset,size,decoded,count,sha=INDEX.unpack_from(self.blocks,block*INDEX.size)
                    source.seek(offset);encoded=source.read(size)
                    if len(encoded)!=size or (not self.trust_prepared and hashlib.sha256(encoded).digest()!=sha):
                        raise ValueError('source_projection_block_mismatch')
                    if zstandard.frame_content_size(encoded)!=decoded:
                        raise ValueError('source_projection_decoded_bound')
                    raw=zstandard.ZstdDecompressor().decompress(encoded,max_output_size=decoded,allow_extra_data=False)
                    if len(raw)!=decoded or not raw.endswith(b'\n'):
                        raise ValueError('source_projection_decoded_bound')
                    boundaries=[0]
                    for _ in range(count):
                        check_cancelled()
                        end=raw.find(b'\n',boundaries[-1])
                        if end<0:raise ValueError('source_projection_block_rows')
                        boundaries.append(end+1)
                    if boundaries[-1]!=len(raw):raise ValueError('source_projection_block_rows')
                    for row in sorted(rows):
                        check_cancelled();position=row-first
                        # Copy only requested rows; a block may contain many
                        # large, unrelated publisher records.
                        record=raw[boundaries[position]:boundaries[position+1]-1]
                        value=(decode_record or json.loads)(record)
                        if not isinstance(value,dict):raise ValueError('source_projection_record_invalid')
                        yield row,value
                        del value,record
                    del raw,boundaries,encoded
            self.assert_unchanged()
        return VerifiedStream(iterate)

    def close(self):pass
    def __enter__(self):return self
    def __exit__(self,*args):self.close()


def publish(package,root,progress=None,*,resume=None,reserve_bytes=8*1024**3):
    """Resume complete per-part publications, seal only the full population."""
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=True)
    parts={};known={kind:list(pins) for kind,pins in (resume or {}).items()}
    for kind in KINDS:
        parts[kind]=[]
        for part in range(len(package.handoff['shards'][kind])):
            previous=(resume or {}).get(kind,[])
            pin=publish_part(package,root,kind,part,existing_pin=previous[part] if part<len(previous) else None,reserve_bytes=reserve_bytes)
            parts[kind].append(pin)
            retained=known.setdefault(kind,[])
            if part<len(retained):
                if retained[part]!=pin:raise ValueError('source_projection_checkpoint_mismatch')
            else:retained.append(pin)
            checkpoint=canonical({'format':FORMAT,'package_sha256':package.sha256,'parts':known})
            checkpoint_pin=digest(checkpoint)
            # Keep the current and previous externally pinned checkpoints. A
            # crash between rotation and publication leaves the previous one.
            temporary=root/'checkpoint.partial'
            with temporary.open('wb') as output:
                output.write(checkpoint);output.flush();os.fsync(output.fileno())
            path=root/'checkpoint.json'
            if path.exists():os.replace(path,root/'checkpoint.previous.json')
            os.replace(temporary,path);sync_directory(root)
            if progress:progress(kind,part,checkpoint_pin)
    manifest={'format':FORMAT,'package_sha256':package.sha256,'parts':parts}
    raw=canonical(manifest)
    path=root/'manifest.json'
    if path.exists():
        if path.read_bytes()!=raw:raise ValueError('source_projection_existing_manifest_mismatch')
    else:write_file(path,raw);sync_directory(root)
    return digest(raw)


def read_checkpoint(path,pin,package):
    path=pathlib.Path(path)
    if path.stat().st_size>16*1024*1024:raise ValueError('source_projection_checkpoint_invalid')
    raw=path.read_bytes()
    if digest(raw)!=pin:raise ValueError('source_projection_checkpoint_mismatch')
    m=json.loads(raw)
    if (m.get('format')!=FORMAT or m.get('package_sha256')!=package.sha256
            or not isinstance(m.get('parts'),dict) or not set(m['parts']).issubset(KINDS)):
        raise ValueError('source_projection_checkpoint_invalid')
    for kind,pins in m['parts'].items():
        if (not isinstance(pins,list) or len(pins)>len(package.handoff['shards'][kind])
                or any(not isinstance(pin,str) or len(pin)!=64 or any(c not in '0123456789abcdef' for c in pin) for pin in pins)):
            raise ValueError('source_projection_checkpoint_invalid')
    return m['parts']


class SourceProjection:
    def __init__(self,root,pin,package,*,trust_prepared=False):
        self.root=pathlib.Path(root).resolve(strict=True);self.package=package
        path=self.root/'manifest.json'
        if path.is_symlink() or path.stat().st_size>16*1024*1024:
            raise ValueError('source_projection_manifest_invalid')
        before=signature(path);raw=path.read_bytes()
        if signature(path)!=before:raise ValueError('source_projection_storage_changed')
        if not trust_prepared and digest(raw)!=pin:raise ValueError('source_projection_manifest_mismatch')
        m=json.loads(raw)
        if (m.get('format')!=FORMAT or m.get('package_sha256')!=package.sha256
                or set(m.get('parts',{}))!=set(KINDS)):
            raise ValueError('source_projection_lineage_mismatch')
        self.parts={};self.path=path;self.identity=before;index_bytes=0
        for kind in KINDS:
            pins=m['parts'][kind]
            if not isinstance(pins,list) or len(pins)!=len(package.handoff['shards'][kind]):
                raise ValueError('source_projection_population_mismatch')
            for part,pin in enumerate(pins):
                target=self.root/part_name(kind,part)
                if target.is_symlink():raise ValueError('source_projection_path_invalid')
                reader=SourcePart(target,pin,package,kind,part,max_index_bytes=INDEX_CAPACITY-index_bytes,trust_prepared=trust_prepared)
                self.parts[kind,part]=reader;index_bytes+=len(reader.blocks)
        self.assert_unchanged()

    def assert_unchanged(self):
        if signature(self.path)!=self.identity:raise ValueError('source_projection_storage_changed')
        for part in self.parts.values():part.assert_unchanged()

    def records_at(self,kind,part,requested,*,decode_record=None):
        if signature(self.path)!=self.identity:raise ValueError('source_projection_storage_changed')
        source_receipt(self.package,kind,part)
        stream=self.parts[kind,part].records_at(requested,decode_record=decode_record)
        def iterate():
            yield from stream
            if not stream.verified:raise ValueError('source_projection_stream_unverified')
            if signature(self.path)!=self.identity:raise ValueError('source_projection_storage_changed')
        return VerifiedStream(iterate)

    def close(self):self.parts.clear()


if __name__=='__main__':
    import argparse
    from package import PreparedPackage
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',required=True);parser.add_argument('--package-sha256',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--resume-manifest');parser.add_argument('--resume-sha256')
    parser.add_argument('--reserve-bytes',type=int,default=8*1024**3)
    args=parser.parse_args()
    package=PreparedPackage(args.package,args.package_sha256)
    if bool(args.resume_manifest)!=bool(args.resume_sha256):parser.error('both resume arguments are required')
    resume=read_checkpoint(args.resume_manifest,args.resume_sha256,package) if args.resume_manifest else None
    pin=publish(package,args.output,lambda kind,part,pin:print(json.dumps({'kind':kind,'part':part,'checkpointSha256':pin}),flush=True),resume=resume,reserve_bytes=args.reserve_bytes)
    print(json.dumps({'manifestSha256':pin}),flush=True)
