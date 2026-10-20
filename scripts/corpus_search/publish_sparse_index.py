"""Assemble complete authenticated sparse artifacts; activation remains separate."""
from contextlib import ExitStack,closing
import hashlib
import json
import os
import pathlib
import re
import shutil
import sqlite3
from membership import sync_directory
from sparse_postings import PostingRun,merge_posting_runs,write_posting_run,MAX_INTEGER
from works import file_hash,signature

FIELDS=('title','hierarchy','article','text')


def publish_sparse_index(source,tokenization_sha256,root,fan_in=16,checkpoint=None):
    if type(fan_in) is not int or not 2<=fan_in<=32:raise ValueError('sparse_index_merge_bound')
    source=pathlib.Path(source).resolve(strict=True);manifest_path=source/'manifest.json'
    if manifest_path.is_symlink() or manifest_path.stat().st_size>32*1024*1024 or file_hash(manifest_path)!=tokenization_sha256:
        raise ValueError('sparse_index_source_manifest_mismatch')
    m=json.loads(manifest_path.read_bytes())
    if (m.get('format')!='prepared-sparse-tokenization-v1' or m.get('complete') is not True
            or m.get('search_index') is not False or m.get('analyzer')!='word-v1'
            or any(not isinstance(m.get(key),str) or not re.fullmatch('[a-f0-9]{64}',m[key]) for key in ['profiles_sha256','analyzer_sha256'])
            or any(type(m.get(key)) is not int or not 0<=m[key]<=MAX_INTEGER for key in ['profiles','members','postings'])
            or not 0<m['profiles']<=m['members'] or not isinstance(m.get('runs'),list)
            or not isinstance(m.get('weighted_field_lengths'),dict) or set(m['weighted_field_lengths'])!=set(FIELDS)
            or any(type(v) is not int or not 0<=v<=MAX_INTEGER for v in m['weighted_field_lengths'].values())):
        raise ValueError('sparse_index_source_manifest_invalid')
    metadata=source/'profiles.sqlite'
    if metadata.is_symlink() or metadata.stat().st_size!=m['database_bytes'] or file_hash(metadata)!=m['database_sha256']:
        raise ValueError('sparse_index_metadata_mismatch')
    identity=signature(metadata);source_manifest_identity=signature(manifest_path)
    root=pathlib.Path(root).resolve()
    if root==source or source.is_relative_to(root):raise ValueError('sparse_index_output_overlap')
    root.mkdir(parents=True,exist_ok=False)
    current=[];seen=set()
    for receipt in m['runs']:
        name=receipt.get('path');pin=receipt.get('sha256')
        if (not isinstance(name,str) or not re.fullmatch(r'run-[0-9]{6}',name) or name in seen
                or not isinstance(pin,str) or not re.fullmatch('[a-f0-9]{64}',pin)):
            raise ValueError('sparse_index_run_reference_invalid')
        path=source/name
        if path.is_symlink() or path.resolve(strict=True).parent!=source:raise ValueError('sparse_index_run_path_invalid')
        seen.add(name);current.append((path,pin))
    level=0
    if not current:
        path=root/'empty';pin=write_posting_run([],path,m['profiles_sha256']);current=[(path,pin)]
    while True:
        next_level=[]
        for start in range(0,len(current),fan_in):
            group=current[start:start+fan_in];path=root/f'merge-{level:03d}-{start//fan_in:06d}'
            with ExitStack() as stack:
                runs=[stack.enter_context(closing(PostingRun(directory,pin,m['profiles_sha256']))) for directory,pin in group]
                pin=merge_posting_runs(runs,path,m['profiles_sha256'],checkpoint)
            next_level.append((path,pin))
            if checkpoint:checkpoint({'phase':'sparse-merge','level':level,'groups':len(next_level),'total_groups':(len(current)+fan_in-1)//fan_in})
        current=next_level;level+=1
        if len(current)==1:break
    path,pin=current[0];totals=[0]*4;term=None;frequency=0
    with closing(PostingRun(path,pin,m['profiles_sha256'])) as run:
        if run.manifest['rows']!=m['postings']:raise ValueError('sparse_index_posting_population_mismatch')
        stream=run.rows()
        for index,(key,ordinal,frequencies,weight) in enumerate(stream):
            if key!=term:term=key;frequency=0
            frequency+=weight
            if not 0<=ordinal<m['profiles'] or frequency>m['members']:raise ValueError('sparse_index_posting_reference_invalid')
            for field,value in enumerate(frequencies):totals[field]+=value*weight
            if checkpoint and index%100000==0:checkpoint({'phase':'sparse-final-verification','postings':index+1})
        if not stream.verified or dict(zip(FIELDS,totals))!=m['weighted_field_lengths']:
            raise ValueError('sparse_index_field_population_mismatch')
    with closing(sqlite3.connect(metadata.as_uri()+'?mode=ro&immutable=1',uri=True)) as db:
        population=db.execute('SELECT count(*),min(ordinal),max(ordinal),sum(members),sum(title*members),sum(hierarchy*members),sum(article*members),sum(text*members) FROM profiles').fetchone()
        expected=(m['profiles'],0,m['profiles']-1,m['members'],*[m['weighted_field_lengths'][field] for field in FIELDS])
        if population!=expected or db.execute('PRAGMA integrity_check').fetchone()!=('ok',):raise ValueError('sparse_index_metadata_population_mismatch')
    # Independent copy permits temporary run cleanup without aliasing serving metadata.
    destination=root/'profiles.sqlite';shutil.copyfile(metadata,destination)
    with destination.open('r+b') as target:os.fsync(target.fileno())
    if (signature(metadata)!=identity or signature(manifest_path)!=source_manifest_identity
            or file_hash(destination)!=m['database_sha256']):raise ValueError('sparse_index_source_changed')
    result={'format':'prepared-sparse-index-v1','complete':True,'qualification_required':True,
      'tokenization_sha256':tokenization_sha256,'profiles_sha256':m['profiles_sha256'],
      'analyzer_sha256':m['analyzer_sha256'],'analyzer':'word-v1','profiles':m['profiles'],'members':m['members'],
      'weighted_field_lengths':m['weighted_field_lengths'],'postings':m['postings'],
      'run':{'path':path.name,'sha256':pin},'database_bytes':destination.stat().st_size,'database_sha256':m['database_sha256']}
    raw=json.dumps(result,sort_keys=True,separators=(',',':')).encode()
    with (root/'manifest.json').open('xb') as target:target.write(raw);target.flush();os.fsync(target.fileno())
    sync_directory(root);return hashlib.sha256(raw).hexdigest()
