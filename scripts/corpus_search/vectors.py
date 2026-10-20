"""Pinned full-precision coordinates behind interchangeable candidate indexes."""
import bisect
import hashlib
import json
import mmap
import pathlib

import numpy as np
from scripts.corpus_batch.representation import IndexedVectors

DIMENSIONS=3072
WIDTH=DIMENSIONS*4


def file_hash(path):
    with path.open('rb') as source:return hashlib.file_digest(source,'sha256').hexdigest()


def signature(paths):
    return tuple((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
                 for s in (path.stat() for path in paths))


class VectorPool:
    """Global ordinals follow the exact sealed completion's shard order.

    `verify_all` is an admission prerequisite, not work done on each query.
    Every returned coordinate retains the provider's original float32 bytes.
    Candidate search may use a different representation but cannot replace this
    exact-scoring store or its compact-input identities.
    """
    def __init__(self,root,completion_sha256):
        self.root=pathlib.Path(root).resolve(strict=True)
        path=self.root/'completion.json'
        if file_hash(path)!=completion_sha256:
            raise ValueError('vector_pool_completion_mismatch')
        self.completion=json.loads(path.read_bytes())
        self.completion_sha256=completion_sha256
        if self.completion.get('model')!='text-embedding-3-large' or self.completion.get('dimensions')!=DIMENSIONS:
            raise ValueError('vector_pool_model_mismatch')
        self.shards=self.completion['shards'];self.ends=[];self.starts=[];seen=set();total=0
        for receipt in self.shards:
            job=receipt.get('job');count=receipt.get('count')
            if (not isinstance(job,str) or not job or len(job)>100
                    or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in job)
                    or job in seen or type(count) is not int or not 0<count<=50000
                    or receipt.get('model')!='text-embedding-3-large' or receipt.get('dimensions')!=DIMENSIONS
                    or receipt.get('dtype')!='little-endian-float32' or receipt.get('transformation')!='none'):
                raise ValueError('vector_pool_shard_invalid')
            seen.add(job);self.starts.append(total);total+=count;self.ends.append(total)
        if total!=self.completion.get('inputs') or not 0<total<2**53:
            raise ValueError('vector_pool_count_mismatch')
        self.count=total;self.opened={};self.ready=False

    def _path(self,relative):
        path=self.root/relative
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(self.root):
            raise ValueError('vector_pool_path_invalid')
        return path

    def _open(self,part):
        if part in self.opened:return self.opened[part]
        receipt=self.shards[part];job=receipt['job'];count=receipt['count']
        receipt_path=self._path(f'receipts/{job}.json')
        identities=self._path(f'vectors/{job}.hashes');bitmap=self._path(f'vectors/{job}.done')
        if (json.loads(receipt_path.read_bytes())!=receipt or bitmap.read_bytes()!=bytes([1])*count
                or identities.stat().st_size!=count*32 or file_hash(identities)!=receipt['input_hashes_sha256']):
            raise ValueError('vector_pool_source_identity_mismatch')
        paths=[receipt_path,identities,bitmap]
        registry=self.root/f'vectors/{job}.representation.json'
        if registry.exists():
            registry=self._path(f'vectors/{job}.representation.json')
            descriptor=json.loads(registry.read_bytes())
            # IndexedVectors authenticates the registry, saved index and complete
            # reconstructed original-byte digest before this backend is admitted.
            backend=IndexedVectors(self.root,job)
            paths.extend([registry,self._path(f"representations/{descriptor['index_sha256']}.usearch")])
            kind='indexed'
        else:
            raw=self._path(f'vectors/{job}.f32')
            if raw.stat().st_size!=count*WIDTH or file_hash(raw)!=receipt['vectors_sha256']:
                raise ValueError('vector_pool_coordinate_hash_mismatch')
            backend=np.memmap(raw,dtype='<f4',mode='r',shape=(count,DIMENSIONS))
            paths.append(raw);kind='raw'
        result={'kind':kind,'backend':backend,'identities':identities,'paths':paths,'signature':signature(paths)}
        self.opened[part]=result
        return result

    def verify_all(self):
        try:
            for part in range(len(self.shards)):self._open(part)
            self.ready=True
        except BaseException:
            self.close()
            raise

    def _ids(self,ids):
        if not self.ready:raise ValueError('vector_pool_not_verified')
        if not isinstance(ids,(list,tuple,np.ndarray)) or len(ids)>10000:
            raise ValueError('vector_pool_request_bound')
        groups={}
        for position,value in enumerate(ids):
            if not isinstance(value,(int,np.integer)) or isinstance(value,(bool,np.bool_)) or not 0<=int(value)<self.count:
                raise ValueError('vector_pool_position_invalid')
            part=bisect.bisect_right(self.ends,int(value))
            groups.setdefault(part,[]).append((int(value)-self.starts[part],position))
        return groups

    def assert_unchanged(self):
        if not self.ready:raise ValueError('vector_pool_not_verified')
        for entry in self.opened.values():
            if signature(entry['paths'])!=entry['signature']:
                raise ValueError('vector_pool_storage_changed')

    def prepare_random_reads(self):
        """Avoid sequential read-ahead when reranking scattered candidates.

        Set this only for retrieval, after authentication. Sequential gold scans
        retain their default mapping policy. Platforms without madvise retain
        identical coordinate reads but require their own latency qualification.
        """
        self.assert_unchanged()
        if not hasattr(mmap, 'MADV_RANDOM'):
            return
        for entry in self.opened.values():
            if entry['kind'] == 'raw':
                mapping = entry['backend']._mmap
                if hasattr(mapping, 'madvise'):
                    mapping.madvise(mmap.MADV_RANDOM)

    def read(self,ids):
        groups=self._ids(ids)
        result=np.empty((len(ids),DIMENSIONS),dtype='<f4')
        for part,positions in groups.items():
            entry=self.opened[part]
            if signature(entry['paths'])!=entry['signature']:
                raise ValueError('vector_pool_storage_changed')
            positions.sort();local=np.asarray([key for key,_ in positions],dtype=np.uint64)
            if entry['kind']=='raw':values=np.asarray(entry['backend'][local],dtype='<f4')
            else:values=np.asarray(entry['backend'].index.get(local,dtype='f32'),dtype='<f4')
            if values.shape!=(len(local),DIMENSIONS) or not np.isfinite(values).all() or np.any(np.linalg.norm(values,axis=1)==0):
                raise ValueError('vector_pool_coordinates_invalid')
            result[[position for _,position in positions]]=values
        return result

    def input_hashes(self,ids):
        groups=self._ids(ids);result=[None]*len(ids)
        for part,positions in groups.items():
            entry=self.opened[part]
            if signature(entry['paths'])!=entry['signature']:
                raise ValueError('vector_pool_storage_changed')
            with entry['identities'].open('rb') as source:
                for local,position in sorted(positions):
                    source.seek(local*32);value=source.read(32)
                    if len(value)!=32:raise ValueError('vector_pool_input_unavailable')
                    result[position]=value
        return result

    def close(self):
        self.ready=False
        for entry in self.opened.values():
            if entry['kind']=='indexed':entry['backend'].close()
            else:entry['backend']._mmap.close()
        self.opened.clear()
