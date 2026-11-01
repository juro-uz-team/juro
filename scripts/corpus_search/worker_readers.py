"""Thread-owned cursors over an already admitted immutable reader generation.

The owner must outlive all borrowed readers. Large coordinate, navigation and
sparse metadata allocations stay shared; SQLite cursors and membership caches
never cross threads. This creates no admission or qualification evidence.
"""
from collections import OrderedDict
from contextlib import ExitStack, contextmanager, closing
from concurrent.futures import ThreadPoolExecutor
import copy
import sqlite3

from dense_search import DenseSearch
from binary_navigation import BinaryNavigation
from projected_navigation import ProjectedNavigation
from works import signature


@contextmanager
def open_worker_reader(owner, *, read_workers=4, parallel_lanes=False):
    hybrid=owner.hybrid
    if type(parallel_lanes) is not bool:
        raise ValueError('numeric_reader_parallel_policy_invalid')
    if parallel_lanes and not isinstance(hybrid.dense.navigation,(BinaryNavigation,ProjectedNavigation)):
        raise ValueError('numeric_reader_parallel_navigation_unsupported')
    if hybrid.dense.closed:raise ValueError('numeric_reader_owner_closed')
    hybrid.vectors.assert_unchanged();hybrid.dense.navigation.assert_unchanged()
    hybrid.profiles.assert_unchanged();hybrid.sparse.assert_unchanged()
    works=owner.catalog.works
    if signature(works.path)!=works.identity:raise ValueError('prepared_work_storage_changed')
    with ExitStack() as resources:
        def clone_sqlite(reader,path):
            result=copy.copy(reader)
            connection=sqlite3.connect(path.as_uri()+'?mode=ro&immutable=1',uri=True)
            resources.callback(connection.close)
            connection.execute('PRAGMA query_only=ON')
            connection.execute('PRAGMA cache_size=-8192')
            result.connection=connection
            return result
        local_hybrid=copy.copy(hybrid)
        local_hybrid.memberships=copy.copy(hybrid.memberships)
        local_hybrid.memberships.pages=OrderedDict()
        local_hybrid.profiles=clone_sqlite(hybrid.profiles,hybrid.profiles.path)
        local_hybrid.sparse=clone_sqlite(hybrid.sparse,hybrid.sparse.path)
        local_hybrid.sparse.run=clone_sqlite(hybrid.sparse.run,hybrid.sparse.run.root/'lexicon.sqlite')
        local_hybrid.dense=resources.enter_context(closing(DenseSearch(
            hybrid.dense.navigation,hybrid.vectors,hybrid.dense.candidates,read_workers=read_workers)))
        # Registered after DenseSearch so this executor is drained before the
        # dense reader and its original-coordinate read pool are closed.
        local_hybrid.dense_executor=(resources.enter_context(ThreadPoolExecutor(
            max_workers=1,thread_name_prefix='dense-lane')) if parallel_lanes else None)
        catalog=copy.copy(owner.catalog)
        catalog.memberships=local_hybrid.memberships
        catalog.works=clone_sqlite(works,works.path)
        service=copy.copy(owner)
        service.release=copy.deepcopy(owner.release)
        service.hybrid=local_hybrid;service.catalog=catalog
        if getattr(owner,'source_locations',None) is not None:
            locations=owner.source_locations
            if signature(locations.path)!=locations.identity:raise ValueError('source_location_storage_changed')
            service.source_locations=clone_sqlite(locations,locations.path)
        yield service
