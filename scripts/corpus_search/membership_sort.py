"""Bounded external sorting for complete, potentially skewed membership parts.

This stage does not authenticate a join or publish a complete corpus manifest.
The publication coordinator must bind authenticated package/mapping/work roots.
"""
import heapq
import os
import pathlib
from contextlib import ExitStack
from membership import RECORD,write_part


def read_rows(source):
    while raw:=source.read(RECORD.size):
        if len(raw)!=RECORD.size:raise ValueError('membership_sort_truncated_record')
        yield RECORD.unpack(raw)


def key(row):return row[0],row[4]


def merge(paths):
    with ExitStack() as stack:
        streams=[read_rows(stack.enter_context(path.open('rb'))) for path in paths]
        yield from heapq.merge(*streams,key=key)


def save(path,rows):
    with path.open('xb') as target:
        for row in rows:target.write(RECORD.pack(*row))
        target.flush();os.fsync(target.fileno())


def sort_membership_part(source,output_root,prefix,scratch,run_rows=100000,fan_in=16,checkpoint=None):
    """Sort an arbitrarily skewed partition without whole-part memory growth.

    Source and prior published parts are never removed. Scratch must be a fresh
    owned directory; only files created here are removed after replacement is
    flushed. A failed stage remains unpublished and inspectable for a retry.
    checkpoint allows the coordinator to enforce disk floors and cancellation.
    """
    if (type(run_rows) is not int or not 1<=run_rows<=250000 or type(fan_in) is not int or not 2<=fan_in<=32
            or type(prefix) is not int or not 0<=prefix<256):raise ValueError('membership_sort_bound_invalid')
    source=pathlib.Path(source).resolve(strict=True)
    scratch=pathlib.Path(scratch).resolve();output_root=pathlib.Path(output_root).resolve()
    if source.is_relative_to(scratch) or output_root==scratch or output_root.is_relative_to(scratch):
        raise ValueError('membership_sort_path_overlap')
    scratch.mkdir(parents=True,exist_ok=False)
    signature=lambda p:(p.stat().st_dev,p.stat().st_ino,p.stat().st_size,p.stat().st_mtime_ns,p.stat().st_ctime_ns)
    before=signature(source);runs=[];count=0
    with source.open('rb') as file:
        stream=read_rows(file)
        while True:
            batch=[]
            for _ in range(run_rows):
                row=next(stream,None)
                if row is None:break
                if row[0][0]!=prefix:raise ValueError('membership_sort_wrong_partition')
                batch.append(row)
            if not batch:break
            batch.sort(key=key);path=scratch/f'run-0-{len(runs):08d}.bin';save(path,batch);runs.append(path)
            count+=len(batch)
            if checkpoint:checkpoint({'phase':'runs','rows':count,'runs':len(runs)})
    if signature(source)!=before:raise ValueError('membership_sort_source_changed')
    level=0
    while len(runs)>fan_in:
        level+=1;next_runs=[]
        for start in range(0,len(runs),fan_in):
            group=runs[start:start+fan_in];path=scratch/f'run-{level}-{len(next_runs):08d}.bin'
            save(path,merge(group));next_runs.append(path)
            for old in group:old.unlink()
            if checkpoint:checkpoint({'phase':'merge','level':level,'runs':len(next_runs)})
        runs=next_runs
    # write_part rejects duplicate compact/ordinal identities even when they
    # were separated by several runs and merges in the original unsorted file.
    receipt=write_part(output_root,prefix,merge(runs))
    if receipt['rows']!=count:raise ValueError('membership_sort_count_mismatch')
    for path in runs:path.unlink()
    scratch.rmdir()
    return receipt
