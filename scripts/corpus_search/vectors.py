"""Pinned full-precision coordinates behind interchangeable candidate indexes."""
import bisect
import hashlib
import json
import mmap
import os
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

    Strict preparation uses `verify_all`; trusted runtime uses `open_retained`.
    Every returned coordinate retains the provider's original float32 bytes.
    Candidate search may use a different representation but cannot replace this
    exact-scoring store or its compact-input identities.
    """
    def __init__(self,root,completion_sha256,*,raw_read_mode='mapped',trust_prepared=False):
        if type(trust_prepared) is not bool:raise ValueError('vector_pool_trust_policy_invalid')
        self.trust_prepared=trust_prepared
        if type(raw_read_mode) is not str or raw_read_mode not in ('mapped','positioned'):
            raise ValueError('vector_pool_read_mode_invalid')
        if raw_read_mode=='positioned' and not callable(getattr(os,'pread',None)):
            raise ValueError('vector_pool_positioned_reads_unavailable')
        self.raw_read_mode=raw_read_mode
        self.root=pathlib.Path(root).resolve(strict=True)
        path=self.root/'completion.json'
        if not trust_prepared and file_hash(path)!=completion_sha256:
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
        if (json.loads(receipt_path.read_bytes())!=receipt or bitmap.stat().st_size!=count
                or (not self.trust_prepared and bitmap.read_bytes()!=bytes([1])*count)
                or identities.stat().st_size!=count*32
                or (not self.trust_prepared and file_hash(identities)!=receipt['input_hashes_sha256'])):
            raise ValueError('vector_pool_source_identity_mismatch')
        paths=[receipt_path,identities,bitmap]
        fd=None
        registry=self.root/f'vectors/{job}.representation.json'
        if registry.exists():
            registry=self._path(f'vectors/{job}.representation.json')
            descriptor=json.loads(registry.read_bytes())
            # The explicit trust policy controls authentication; both paths keep
            # the same prepared ordinal keys and original full-precision values.
            backend=IndexedVectors(self.root,job,trust_prepared=self.trust_prepared)
            paths.extend([registry,self._path(f"representations/{descriptor['index_sha256']}.usearch")])
            kind='indexed'
        else:
            raw=self._path(f'vectors/{job}.f32')
            raw_identity=signature([raw])[0]
            if raw.stat().st_size!=count*WIDTH or (not self.trust_prepared and file_hash(raw)!=receipt['vectors_sha256']):
                raise ValueError('vector_pool_coordinate_hash_mismatch')
            if signature([raw])[0]!=raw_identity:raise ValueError('vector_pool_storage_changed')
            backend=np.memmap(raw,dtype='<f4',mode='r',shape=(count,DIMENSIONS))
            paths.append(raw);kind='raw'
            if self.raw_read_mode=='positioned':
                try:
                    fd=os.open(raw,os.O_RDONLY)
                    stat=os.fstat(fd)
                    if (stat.st_dev,stat.st_ino,stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns)!=raw_identity:
                        raise ValueError('vector_pool_storage_changed')
                except BaseException:
                    if fd is not None:os.close(fd)
                    backend._mmap.close()
                    raise
        try:
            result={'kind':kind,'backend':backend,'identities':identities,'paths':paths,'signature':signature(paths)}
        except BaseException:
            if fd is not None:os.close(fd)
            if kind=='raw':backend._mmap.close()
            else:backend.close()
            raise
        if fd is not None:
            if result['signature'][-1]!=raw_identity:
                os.close(fd);backend._mmap.close()
                raise ValueError('vector_pool_storage_changed')
            result['fd']=fd
        self.opened[part]=result
        return result

    def verify_all(self):
        if self.trust_prepared:raise ValueError('vector_pool_retained_not_recertified')
        self._open_all()

    def open_retained(self):
        if not self.trust_prepared:raise ValueError('vector_pool_retained_policy_required')
        self._open_all()

    def _open_all(self):
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
        for entry in self.opened.values():
            if entry['kind'] == 'indexed':
                entry['backend'].prepare_random_reads()
            elif hasattr(mmap, 'MADV_RANDOM'):
                mapping = entry['backend']._mmap
                if hasattr(mapping, 'madvise'):
                    mapping.madvise(mmap.MADV_RANDOM)
            # Positioned reads use a separate open descriptor. Advising the
            # mmap above does not disable read-ahead on that descriptor.
            if 'fd' in entry and hasattr(os,'posix_fadvise') and hasattr(os,'POSIX_FADV_RANDOM'):
                os.posix_fadvise(entry['fd'],0,0,os.POSIX_FADV_RANDOM)

    def read(self,ids):
        groups=self._ids(ids)
        result=np.empty((len(ids),DIMENSIONS),dtype='<f4')
        for part,positions in groups.items():
            entry=self.opened[part]
            if signature(entry['paths'])!=entry['signature']:
                raise ValueError('vector_pool_storage_changed')
            positions.sort();local=np.asarray([key for key,_ in positions],dtype=np.uint64)
            if entry['kind']=='raw' and self.raw_read_mode=='positioned':
                # The caller supplies bounded concurrency. Positioned reads do
                # not share a cursor and preserve the admitted float32 bytes.
                values=np.empty((len(local),DIMENSIONS),dtype='<f4')
                for offset,row in enumerate(local):
                    raw=os.pread(entry['fd'],WIDTH,int(row)*WIDTH)
                    if len(raw)!=WIDTH:raise ValueError('vector_pool_coordinate_read_truncated')
                    values[offset]=np.frombuffer(raw,dtype='<f4')
                if signature(entry['paths'])!=entry['signature']:
                    raise ValueError('vector_pool_storage_changed')
            elif entry['kind']=='raw':values=np.asarray(entry['backend'][local],dtype='<f4')
            else:values=np.asarray(entry['backend'].read_positions(local),dtype='<f4')
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
            if 'fd' in entry:os.close(entry['fd'])
            if entry['kind']=='indexed':entry['backend'].close()
            else:entry['backend']._mmap.close()
        self.opened.clear()
