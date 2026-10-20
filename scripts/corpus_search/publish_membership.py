"""Complete authenticated source-to-vector membership publication.

All intermediate state is private to a fresh output directory. A failed or
interrupted build has no manifest and cannot be opened as a published index.
"""
from collections import OrderedDict
import hashlib
import json
import os
import pathlib
import sqlite3
from membership import RECORD,PAGE_ROWS,sync_directory
from membership_sort import sort_membership_part
from works import work_key


def publish_memberships(package,works,vectors,root,checkpoint=None):
    if not vectors.ready or works.manifest['package_sha256']!=package.sha256:
        raise ValueError('membership_publication_unverified_dependencies')
    root=pathlib.Path(root).resolve();root.mkdir(parents=True,exist_ok=False)
    staging=root/'staging';staging.mkdir()
    database=staging/'joins.sqlite';db=sqlite3.connect(database)
    db.execute('PRAGMA journal_mode=DELETE');db.execute('PRAGMA synchronous=FULL')
    db.execute('PRAGMA cache_size=-131072');db.execute('PRAGMA temp_store=FILE')
    db.execute('CREATE TABLE vectors (compact BLOB PRIMARY KEY CHECK(length(compact)=32),seen INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID')
    db.execute('CREATE TABLE mapping (original BLOB PRIMARY KEY CHECK(length(original)=32),compact BLOB NOT NULL CHECK(length(compact)=32)) WITHOUT ROWID')
    handles={};known_works=OrderedDict();counts={};total=0;mapping_count=0
    def progress(phase,**values):
        if checkpoint:checkpoint({'phase':phase,**values})
    def emit(row):
        prefix=row[0][0]
        if prefix not in handles:
            # There are exactly 256 byte prefixes. Retain their bounded file
            # handles: an LRU smaller than the prefix population would fsync
            # nearly every row when adjacent hashes have unrelated prefixes.
            handles[prefix]=(staging/f'{prefix:02x}.unsorted').open('ab')
        handles[prefix].write(RECORD.pack(*row))
        counts[prefix]=counts.get(prefix,0)+1
    try:
        for start in range(0,vectors.count,4096):
            hashes=vectors.input_hashes(list(range(start,min(start+4096,vectors.count))))
            with db:db.executemany('INSERT INTO vectors(compact) VALUES(?)',[(value,) for value in hashes])
            progress('vector-identities',rows=min(start+4096,vectors.count))
        for part in range(len(package.embeddings['mapping_receipts'])):
            stream=package.mapping_rows(part);batch=[]
            with db:
                for original,compact,_ in stream:
                    batch.append((original,compact));mapping_count+=1
                    if len(batch)==4096:db.executemany('INSERT INTO mapping VALUES(?,?)',batch);batch=[]
                if batch:db.executemany('INSERT INTO mapping VALUES(?,?)',batch)
                if not stream.verified:raise ValueError('membership_mapping_unverified')
            progress('mapping',parts=part+1,rows=mapping_count)
        if db.execute('SELECT 1 FROM mapping m LEFT JOIN vectors v ON v.compact=m.compact WHERE v.compact IS NULL LIMIT 1').fetchone():
            raise ValueError('membership_mapping_vector_missing')
        def join(batch):
            nonlocal total
            originals=list({row[2] for row in batch})
            bindings=dict(db.execute('SELECT original,compact FROM mapping WHERE original IN ('+','.join('?' for _ in originals)+')',originals))
            if len(bindings)!=len(originals):raise ValueError('membership_original_mapping_missing')
            pending={work_key(row[3]):row[3] for row in batch if row[3] not in known_works}
            locations=works.lookup(list(pending))
            for (key,work),location in zip(pending.items(),locations):
                if location is None or location['work']!=work:raise ValueError('membership_work_missing')
                known_works[work]=key
            for ordinal,chunk,original,work in batch:
                if ordinal!=total:raise ValueError('membership_source_ordinal_mismatch')
                emit((bindings[original],original,chunk,known_works[work],ordinal));total+=1
            with db:db.executemany('UPDATE vectors SET seen=1 WHERE compact=? AND seen=0',[(compact,) for compact in set(bindings.values())])
            while len(known_works)>65536:known_works.popitem(last=False)
        for part in range(len(package.memberships['receipts'])):
            stream=package.membership_rows(part);batch=[]
            for row in stream:
                batch.append(row)
                if len(batch)==1024:join(batch);batch=[]
            if batch:join(batch)
            if not stream.verified:raise ValueError('membership_source_unverified')
            progress('memberships',parts=part+1,rows=total)
        if total!=package.memberships['rows'] or db.execute('SELECT 1 FROM vectors WHERE seen=0 LIMIT 1').fetchone():
            raise ValueError('membership_population_incomplete')
        for handle in handles.values():handle.flush();os.fsync(handle.fileno());handle.close()
        handles.clear();db.close()
        # The join state is reproducible; remove only this stage's own database
        # after complete source authentication, before allocating sort runs.
        database.unlink()
        parts=[]
        for prefix,count in sorted(counts.items()):
            source=staging/f'{prefix:02x}.unsorted'
            receipt=sort_membership_part(source,root,prefix,staging/f'sort-{prefix:02x}',checkpoint=checkpoint)
            if receipt['rows']!=count:raise ValueError('membership_sorted_count_mismatch')
            parts.append(receipt);source.unlink();progress('sorted',parts=len(parts),rows=sum(p['rows'] for p in parts))
        staging.rmdir()
        works.lookup([]);vectors.assert_unchanged()
        manifest={'format':'prepared-membership-pages-v1','complete':True,'record_bytes':RECORD.size,'page_rows':PAGE_ROWS,
          'rows':total,'parts':parts,'work_key_format':'sha256-utf8-work-id-v1','work_manifest_sha256':works.manifest_sha256,
          'package_sha256':package.sha256,'mapping_manifest_sha256':package.files['embedding-inputs/manifest.json']['sha256'],
          'source_membership_manifest_sha256':package.files['memberships/manifest.json']['sha256'],
          'vector_completion_sha256':vectors.completion_sha256,'vectors':vectors.count,'original_inputs':mapping_count}
        raw=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
        with (root/'manifest.json').open('xb') as target:target.write(raw);target.flush();os.fsync(target.fileno())
        sync_directory(root)
        return hashlib.sha256(raw).hexdigest()
    finally:
        for handle in handles.values():handle.close()
        db.close()
