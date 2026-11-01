"""Pinned composition of candidate indexes; original coordinates remain authoritative.

The release navigation digest binds both index generations and all candidate
budgets. Loading this descriptor authenticates the policy, not its recall;
release qualification must still measure the resulting retrieval and answers.
"""
from contextlib import ExitStack,closing,contextmanager
import hashlib
import ctypes
import json
import pathlib
import re

from binary_navigation import BinaryNavigation,SUPPORTED_PREFIX_BITS
from projected_navigation import ProjectedNavigation
from numeric_http import unique_object
from works import signature


def artifact_reference(value):
    return (isinstance(value,dict) and set(value)=={'path','sha256'}
        and isinstance(value['path'],str) and pathlib.Path(value['path']).is_absolute()
        and isinstance(value['sha256'],str) and re.fullmatch('[a-f0-9]{64}',value['sha256']) is not None)


class NativeNavigationGeneration:
    def __init__(self,root,pin,completion_sha256,candidates):
        self.path=pathlib.Path(root)/'manifest.json'
        if (not isinstance(pin,str) or not re.fullmatch('[a-f0-9]{64}',pin)
                or self.path.is_symlink() or self.path.stat().st_size>65536):
            raise ValueError('native_navigation_manifest_invalid')
        self.identity=signature(self.path);raw=self.path.read_bytes()
        self.assert_unchanged()
        if hashlib.sha256(raw).hexdigest()!=pin:raise ValueError('native_navigation_manifest_mismatch')
        m=json.loads(raw,object_pairs_hook=unique_object)
        if (not isinstance(m,dict) or set(m)!={'format','completionSha256','binary','projection',
                    'prefixBits','upstreamCandidates','originalCandidates'}
                or m['format']!='prepared-native-navigation-v1'
                or not isinstance(m['completionSha256'],str) or not re.fullmatch('[a-f0-9]{64}',m['completionSha256'])
                or not all(artifact_reference(m[key]) for key in ('binary','projection'))
                or type(m['prefixBits']) is not int or m['prefixBits'] not in SUPPORTED_PREFIX_BITS
                or type(m['upstreamCandidates']) is not int or not 50<=m['upstreamCandidates']<=20000
                or type(m['originalCandidates']) is not int or not 50<=m['originalCandidates']<=m['upstreamCandidates']):
            raise ValueError('native_navigation_manifest_invalid')
        if m['completionSha256']!=completion_sha256 or m['originalCandidates']!=candidates:
            raise ValueError('native_navigation_lineage_mismatch')
        self.manifest=m;self.manifest_sha256=pin

    def assert_unchanged(self):
        if self.path.is_symlink() or signature(self.path)!=self.identity:
            raise ValueError('native_navigation_storage_changed')

    @contextmanager
    def open(self,kernel_path,kernel_sha256,*,read_workers):
        self.assert_unchanged();m=self.manifest
        with ExitStack() as resources:
            binary=resources.enter_context(closing(BinaryNavigation(m['binary']['path'],m['binary']['sha256'],
                m['completionSha256'],kernel_path,kernel_sha256,prefix_bits=m['prefixBits'])))
            positioned_read=getattr(binary.library,'projected_read_rows',None)
            if positioned_read is not None:
                positioned_read.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_size_t,ctypes.c_size_t,ctypes.c_void_p]
                positioned_read.restype=ctypes.c_int
            projection=resources.enter_context(closing(ProjectedNavigation(binary,m['projection']['path'],
                m['projection']['sha256'],upstream_candidates=m['upstreamCandidates'],read_workers=read_workers,
                positioned_read=positioned_read)))
            check_indexes=projection.assert_unchanged
            def check_generation():
                self.assert_unchanged();check_indexes()
            projection.assert_unchanged=check_generation
            projection.release_manifest_sha256=self.manifest_sha256
            projection.navigation_backend='binary-projected'
            self.assert_unchanged()
            yield projection
