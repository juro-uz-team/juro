import hashlib
import json
import pathlib
import tempfile
import unittest
import sqlite3
from collections import OrderedDict
from contextlib import contextmanager,ExitStack
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

import test_vectors
from worker import read_worker_manifest, open_worker, PATHS
from vectors import VectorPool
from worker_readers import open_worker_reader
from works import signature
from binary_navigation import BinaryNavigation


class WorkerTests(unittest.TestCase):
    def test_native_owner_opens_complete_graph_with_real_dense_hybrid_and_service(self):
        from projected_navigation import ProjectedNavigation
        from dense_search import DenseSearch
        from hybrid_search import PreparedHybridSearch
        from numeric_service import PreparedNumericService
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);kernel=root/'kernel.so';kernel.write_bytes(b'pinned test kernel')
            reference={'path':str(kernel),'sha256':hashlib.sha256(kernel.read_bytes()).hexdigest()}
            pins=dict(zip(['packageSha256','vectorCompletionSha256','vectorIdentitySha256',
                'membershipSha256','workIndexSha256','navigationSha256','sparseSha256'],[c*64 for c in 'abcdef1']))
            closed=[]
            def close(name):return lambda:closed.append(name)
            navigation=object.__new__(ProjectedNavigation)
            navigation.completion_sha256=pins['vectorCompletionSha256'];navigation.count=64;navigation.dimensions=3072
            navigation.manifest_sha256='2'*64;navigation.release_manifest_sha256=pins['navigationSha256']
            navigation.navigation_backend='binary-projected';navigation.assert_unchanged=lambda:None
            @contextmanager
            def open_navigation(*args,**kwargs):
                try:yield navigation
                finally:closed.append('navigation')
            generation=SimpleNamespace(open=open_navigation,assert_unchanged=lambda:None)
            package=SimpleNamespace(sha256=pins['packageSha256'],memberships={'rows':64},
                handoff={'shards':{'chunks':[]}},files={'embedding-inputs/manifest.json':{'sha256':'3'*64},
                    'memberships/manifest.json':{'sha256':'4'*64}})
            vectors=SimpleNamespace(ready=True,count=64,completion_sha256=pins['vectorCompletionSha256'],
                verify_all=lambda:None,assert_unchanged=lambda:None,prepare_random_reads=lambda:None,close=close('vectors'))
            works=SimpleNamespace(manifest_sha256=pins['workIndexSha256'],close=close('works'))
            members=SimpleNamespace(manifest_sha256=pins['membershipSha256'],manifest={
                'package_sha256':pins['packageSha256'],'work_manifest_sha256':pins['workIndexSha256'],
                'vector_completion_sha256':pins['vectorCompletionSha256'],'mapping_manifest_sha256':'3'*64,
                'source_membership_manifest_sha256':'4'*64,'rows':64,'vectors':64})
            profiles=SimpleNamespace(manifest_sha256='5'*64,close=close('profiles'),manifest={
                'package_sha256':pins['packageSha256'],'vector_completion_sha256':pins['vectorCompletionSha256'],
                'vector_identity_sha256':pins['vectorIdentitySha256'],'members':64,'profiles':64})
            sparse=SimpleNamespace(manifest_sha256=pins['sparseSha256'],close=close('sparse'),
                manifest={'profiles_sha256':'5'*64,'members':64,'profiles':64})
            spec={'format':'prepared-numeric-worker-v2','paths':{key:str(root/key) for key in PATHS},
                'profilesSha256':'5'*64,'analyzerSha256':'6'*64,'candidates':50,
                'execution':{'binaryKernel':reference,'sparseKernel':reference,
                    'sourceProjection':{'path':str(root/'sources'),'sha256':'7'*64},
                    'requestWorkers':2,'maxPending':8,'readWorkers':4,'projectionReadWorkers':32,
                    'parallelLanes':True,'rawReadMode':'positioned','membershipPageNavigation':True},
                'release':{'id':'native','environment':'production','capability':'current','configuration':{
                    'backend':'prepared-corpus-v1','navigationBackend':'binary-projected',
                    'embeddingModel':'openai/text-embedding-3-large','dimensions':3072,
                    'evidenceSemantics':'discovery-only','categoryRanking':{'mode':'disabled'},'artifacts':pins}}}
            replacements={'NativeNavigationGeneration':generation,'PreparedPackage':package,'VectorPool':vectors,
                'VectorIdentityIndex':SimpleNamespace(manifest={'rows':64},close=close('identities')),
                'WorkIndex':works,'MembershipIndex':members,'SparseProfiles':profiles,'SparseIndex':sparse}
            with ExitStack() as patches:
                for name,value in replacements.items():patches.enter_context(patch('worker.'+name,return_value=value))
                patches.enter_context(patch('source_projection.SourceProjection',return_value=SimpleNamespace(
                    assert_unchanged=lambda:None,close=close('sources'))))
                with open_worker(spec,lambda:self.fail('native graph connected to postgres')) as service:
                    self.assertIsInstance(service,PreparedNumericService)
                    self.assertIsInstance(service.hybrid,PreparedHybridSearch)
                    self.assertIsInstance(service.hybrid.dense,DenseSearch)
                    self.assertEqual(service.release,spec['release'])
                    self.assertEqual(closed,[])
                self.assertTrue(service.hybrid.dense.closed)
            self.assertEqual(closed,['sparse','profiles','works','identities','vectors','sources','navigation'])

    def test_native_owner_uses_pinned_navigation_and_closes_it_when_vector_admission_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);kernel=root/'kernel.so';kernel.write_bytes(b'fixture kernel identity')
            reference={'path':str(kernel),'sha256':hashlib.sha256(kernel.read_bytes()).hexdigest()}
            execution={'binaryKernel':reference,'sparseKernel':reference,
                'sourceProjection':{'path':str(root/'sources'),'sha256':'c'*64},
                'requestWorkers':2,'maxPending':8,'readWorkers':4,'projectionReadWorkers':32,
                'parallelLanes':True,'rawReadMode':'positioned','membershipPageNavigation':True}
            pins={'navigationSha256':'a'*64,'vectorCompletionSha256':'b'*64,'packageSha256':'c'*64}
            spec={'format':'prepared-numeric-worker-v2','paths':{key:str(root/key) for key in PATHS},
                'release':{'configuration':{'artifacts':pins}},'execution':execution,'candidates':2000}
            closed=[];opened=[]
            @contextmanager
            def navigation(*args,**kwargs):
                opened.append((args,kwargs))
                try:yield SimpleNamespace(assert_unchanged=lambda:None)
                finally:closed.append('navigation')
            generation=SimpleNamespace(open=navigation)
            projection=SimpleNamespace(close=lambda:closed.append('source_projection'))
            def fail():raise ValueError('original_coordinates_corrupt')
            vectors=SimpleNamespace(verify_all=fail,close=lambda:closed.append('vectors'))
            with patch('worker.PgvectorGeneration',side_effect=AssertionError('legacy navigation')),\
                 patch('worker.NativeNavigationGeneration',return_value=generation) as native,\
                 patch('worker.PreparedPackage'),patch('source_projection.SourceProjection',return_value=projection) as sources,\
                 patch('worker.VectorPool',return_value=vectors) as pool:
                with self.assertRaisesRegex(ValueError,'original_coordinates_corrupt'):
                    with open_worker(spec,lambda:self.fail('native path used database')):self.fail('admitted')
                native.assert_called_once_with(str(root/'navigation'),'a'*64,'b'*64,2000)
                self.assertEqual(opened,[((str(kernel),reference['sha256']),{'read_workers':32})])
                self.assertEqual(pool.call_args.kwargs,{'raw_read_mode':'positioned'})
                self.assertEqual(sources.call_args.args[:2],(str(root/'sources'),'c'*64))
            self.assertEqual(closed,['vectors','source_projection','navigation'])
            kernel.write_bytes(b'changed kernel identity')
            with patch('worker.NativeNavigationGeneration',side_effect=AssertionError('opened before kernel check')):
                with self.assertRaisesRegex(ValueError,'kernel_mismatch'):
                    with open_worker(spec,None):self.fail('admitted')

    def test_native_manifest_binds_runtime_policy_and_forbids_unpinned_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            artifact=lambda name:{'path':str(root/name),'sha256':'d'*64}
            execution={'binaryKernel':artifact('binary.so'),'sparseKernel':artifact('sparse.so'),
                'sourceProjection':artifact('sources'),'requestWorkers':2,'maxPending':8,
                'readWorkers':4,'projectionReadWorkers':32,'parallelLanes':True,
                'rawReadMode':'positioned','membershipPageNavigation':True}
            spec={'format':'prepared-numeric-worker-v2','paths':{key:str(root/key) for key in PATHS},
                'release':{'configuration':{'navigationBackend':'binary-projected','artifacts':{key:'a'*64 for key in [
                    'packageSha256','vectorCompletionSha256','vectorIdentitySha256',
                    'membershipSha256','workIndexSha256','navigationSha256','sparseSha256']}}},
                'profilesSha256':'b'*64,'analyzerSha256':'c'*64,'candidates':2000,'execution':execution}
            path=root/'worker.json'
            def read(value):
                raw=json.dumps(value).encode();path.write_bytes(raw)
                return read_worker_manifest(path,hashlib.sha256(raw).hexdigest())
            self.assertEqual(read(spec),spec)
            isolated={**spec,'execution':{**execution,'sparseProcessWorkers':2}}
            self.assertEqual(read(isolated),isolated)
            for key,value in [('requestWorkers',True),('requestWorkers',5),('maxPending',0),
                    ('readWorkers',3),('projectionReadWorkers',64),('parallelLanes',1),
                    ('membershipPageNavigation',None),('rawReadMode','unchecked'),
                    ('sparseProcessWorkers',True),('sparseProcessWorkers',5),
                    ('binaryKernel',{'path':'relative','sha256':'d'*64})]:
                with self.subTest(key=key,value=value),self.assertRaises(ValueError):
                    read({**spec,'execution':{**execution,key:value}})
            with self.assertRaises(ValueError):read({**spec,'probes':1})
            with self.assertRaisesRegex(ValueError,'override'):
                with open_worker(spec,None,sparse_kernel='different.so'):self.fail('admitted override')

    def test_borrowed_readers_share_large_arrays_and_own_sqlite_and_caches(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);path=root/'lexicon.sqlite'
            connection=sqlite3.connect(path)
            connection.execute('CREATE TABLE value (n INTEGER)');connection.execute('INSERT INTO value VALUES(7)');connection.commit()
            vectors=SimpleNamespace(ready=True,completion_sha256='a'*64,count=10,
                assert_unchanged=lambda:None,prepare_random_reads=lambda:None)
            navigation=object.__new__(BinaryNavigation)
            navigation.completion_sha256='a'*64;navigation.count=10;navigation.dimensions=3072
            navigation.assert_unchanged=lambda:None
            reader=SimpleNamespace(path=path,identity=signature(path),root=root,connection=connection,assert_unchanged=lambda:None,trust_prepared=True)
            native=object();sparse=SimpleNamespace(**vars(reader),run=reader,native=native)
            memberships=SimpleNamespace(pages=OrderedDict(original=b'original'),trust_prepared=True)
            hybrid=SimpleNamespace(vectors=vectors,dense=SimpleNamespace(closed=False,navigation=navigation,candidates=10),
                profiles=reader,sparse=sparse,memberships=memberships)
            owner=SimpleNamespace(hybrid=hybrid,catalog=SimpleNamespace(works=reader,memberships=memberships),release={'id':'release'})
            def borrow(parallel):
                with open_worker_reader(owner,parallel_lanes=parallel) as borrowed:
                    self.assertIs(borrowed.hybrid.vectors,vectors)
                    self.assertIs(borrowed.hybrid.dense.navigation,navigation)
                    self.assertIs(borrowed.hybrid.sparse.native,native)
                    for retained in [borrowed.hybrid.profiles,borrowed.hybrid.sparse,borrowed.hybrid.sparse.run,
                                     borrowed.hybrid.memberships,borrowed.catalog.works]:
                        self.assertIs(retained.trust_prepared,True)
                    self.assertIs(borrowed.catalog.memberships,borrowed.hybrid.memberships)
                    self.assertIsNot(borrowed.catalog.works.connection,connection)
                    self.assertEqual(borrowed.catalog.works.connection.execute('SELECT n FROM value').fetchone(),(7,))
                    borrowed.hybrid.memberships.pages['local']=b'local'
                    borrowed.release['id']='local'
                    executor=borrowed.hybrid.dense_executor
                    if parallel:self.assertEqual(executor.submit(lambda:7).result(),7)
                    else:self.assertIsNone(executor)
                self.assertTrue(borrowed.hybrid.dense.closed)
                if parallel:
                    with self.assertRaises(RuntimeError):executor.submit(lambda:7)
                with self.assertRaises(sqlite3.ProgrammingError):borrowed.catalog.works.connection.execute('SELECT 1')
            try:
                with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(borrow,[False,True]))
                self.assertEqual(list(memberships.pages),['original']);self.assertEqual(owner.release,{'id':'release'})
                self.assertEqual(connection.execute('SELECT n FROM value').fetchone(),(7,))
            finally:connection.close()

    def test_parallel_policy_rejects_unsupported_navigation_before_opening_readers(self):
        owner=SimpleNamespace(hybrid=SimpleNamespace(dense=SimpleNamespace(navigation=object())))
        for policy in [1,None,'true']:
            with self.assertRaisesRegex(ValueError,'parallel_policy_invalid'):
                with open_worker_reader(owner,parallel_lanes=policy):self.fail('opened')
        with self.assertRaisesRegex(ValueError,'parallel_navigation_unsupported'):
            with open_worker_reader(owner,parallel_lanes=True):self.fail('opened')

    def test_manifest_pin_and_strict_configuration_are_checked_before_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            spec = {'format': 'prepared-numeric-worker-v1', 'paths': {key: str(root/key) for key in PATHS},
                'release': {'configuration': {'navigationBackend':'pgvector','artifacts': {key: 'a'*64 for key in [
                    'packageSha256', 'vectorCompletionSha256', 'vectorIdentitySha256',
                    'membershipSha256', 'workIndexSha256', 'navigationSha256', 'sparseSha256']}}},
                'profilesSha256': 'b'*64, 'analyzerSha256': 'c'*64, 'probes': 1, 'candidates': 1000}
            path = root/'worker.json'
            def write(value):
                raw = json.dumps(value).encode()
                path.write_bytes(raw)
                return hashlib.sha256(raw).hexdigest()
            pin = write(spec)
            self.assertEqual(read_worker_manifest(path, pin), spec)
            with self.assertRaisesRegex(ValueError, 'manifest_mismatch'):
                read_worker_manifest(path, '0'*64)
            for change in [{'probes': True}, {'candidates': 20001}, {'paths': {**spec['paths'], 'vectors': 'relative'}},
                           {'databasePassword': 'must not be stored here'}]:
                with self.assertRaises(ValueError):
                    read_worker_manifest(path, write({**spec, **change}))

    def test_later_admission_failure_closes_authenticated_original_vector_pool(self):
        fixture = test_vectors.VectorPoolTests()
        fixture.setUp()
        pool = VectorPool(fixture.root, fixture.pin)
        navigation = SimpleNamespace(assert_unchanged=lambda: None)
        generation = SimpleNamespace(manifest={'completion_sha256': fixture.pin}, navigation=lambda *_: navigation)
        pins = {key: 'a'*64 for key in ['navigationSha256', 'packageSha256', 'vectorIdentitySha256']}
        pins['vectorCompletionSha256'] = fixture.pin
        spec = {'paths': {key: str(fixture.root) for key in PATHS}, 'probes': 1,
                'release': {'configuration': {'artifacts': pins}}}
        try:
            with patch('worker.PgvectorGeneration', return_value=generation), patch('worker.PreparedPackage'), \
                 patch('worker.VectorPool', return_value=pool), \
                 patch('worker.VectorIdentityIndex', side_effect=ValueError('identity_corrupt')):
                with self.assertRaisesRegex(ValueError, 'identity_corrupt'):
                    with open_worker(spec, lambda: None):
                        self.fail('worker admitted incomplete reader graph')
                self.assertFalse(pool.ready)
                self.assertEqual(pool.opened, {})
        finally:
            pool.close()
            fixture.tearDown()


if __name__ == '__main__':
    unittest.main()
