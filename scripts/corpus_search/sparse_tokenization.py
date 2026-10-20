"""Bounded offline bridge from authenticated profiles to production tokenization."""
import concurrent.futures
import hashlib
import json
import os
import pathlib
import sqlite3
import subprocess
from membership import sync_directory
from sparse_postings import write_posting_run,MAX_INTEGER
from works import file_hash

FIELDS=('title','hierarchy','article','text')


class ProductionTokenizer:
    def __init__(self,command,timeout=30):
        if not command or not 0<timeout<=120:raise ValueError('sparse_tokenizer_configuration_invalid')
        self.timeout=timeout;self.executor=concurrent.futures.ThreadPoolExecutor(max_workers=1)
        self.process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        self.closed=False

    def tokenize(self,row):
        if self.closed:raise ValueError('sparse_tokenizer_closed')
        request=json.dumps({key:row[key] for key in ['id','members','fields']},ensure_ascii=False,separators=(',',':')).encode()+b'\n'
        if len(request)>8*1024*1024:raise ValueError('sparse_tokenizer_request_bound')
        def exchange():
            self.process.stdin.write(request);self.process.stdin.flush()
            raw=self.process.stdout.readline(32*1024*1024+1)
            if not raw.endswith(b'\n') or len(raw)>32*1024*1024:raise ValueError('sparse_tokenizer_response_bound')
            return json.loads(raw)
        try:return self.executor.submit(exchange).result(timeout=self.timeout)
        except BaseException:
            self.close();raise

    def close(self):
        if self.closed:return
        self.closed=True
        if self.process.poll() is None:self.process.kill()
        self.process.wait();self.executor.shutdown(wait=True,cancel_futures=True)
        self.process.stdin.close();self.process.stdout.close()


def tokenize_profiles(profiles,tokenize,root,analyzer_sha256,run_rows=100000,checkpoint=None):
    """Publish intermediate runs and metadata only after complete source checks.

    tokenize must call the pinned production analyzer. Publication records its
    resulting field lengths and membership-weighted corpus statistics. It does
    not itself authorize a search index or candidate release.
    """
    if type(run_rows) is not int or not 1<=run_rows<=250000:raise ValueError('sparse_tokenization_bound')
    if not isinstance(analyzer_sha256,str) or len(analyzer_sha256)!=64 or any(c not in '0123456789abcdef' for c in analyzer_sha256):
        raise ValueError('sparse_analyzer_pin_invalid')
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=False)
    db=sqlite3.connect(root/'profiles.sqlite');runs=[];buffer=[];totals=[0]*4;members=count=postings=0
    try:
        db.execute('PRAGMA journal_mode=DELETE');db.execute('PRAGMA synchronous=FULL');db.execute('PRAGMA cache_size=-16384')
        db.execute('''CREATE TABLE profiles(ordinal INTEGER PRIMARY KEY,original BLOB UNIQUE NOT NULL,
            vector INTEGER NOT NULL,first_membership INTEGER NOT NULL,members INTEGER NOT NULL,
            title INTEGER NOT NULL,hierarchy INTEGER NOT NULL,article INTEGER NOT NULL,text INTEGER NOT NULL)''')
        def flush():
            if not buffer:return
            name=f'run-{len(runs):06d}';buffer.sort(key=lambda row:row[:2])
            pin=write_posting_run(buffer,root/name,profiles.manifest_sha256)
            runs.append({'path':name,'sha256':pin});buffer.clear()
            if checkpoint:checkpoint({'phase':'sparse-tokenization','profiles':count,'postings':postings,'runs':len(runs)})
        stream=profiles.rows()
        for row in stream:
            result=tokenize(row)
            identity=hashlib.sha256(json.dumps(['prepared-sparse-profile-v1',*[row['fields'][field] for field in FIELDS]],
                ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
            if (not isinstance(result,dict) or result.get('id')!=row['id'] or result.get('members')!=row['members']
                    or result.get('identity')!=identity or not isinstance(result.get('postings'),list)):
                raise ValueError('sparse_tokenizer_identity_mismatch')
            lengths=result.get('fieldLengths');weighted=result.get('weightedFieldLengths')
            if (not isinstance(lengths,dict) or set(lengths)!=set(FIELDS)
                    or any(type(lengths[field]) is not int or not 0<=lengths[field]<=MAX_INTEGER for field in FIELDS)
                    or weighted!={field:lengths[field]*row['members'] for field in FIELDS}):
                raise ValueError('sparse_tokenizer_statistics_invalid')
            previous=None;frequency_sums=[0]*4
            for posting in result['postings']:
                term=posting.get('termHash');frequencies=posting.get('termFrequencies')
                if (not isinstance(term,str) or len(term)!=64 or any(c not in '0123456789abcdef' for c in term)
                        or previous is not None and term<=previous or posting.get('documentFrequencyContribution')!=row['members']
                        or not isinstance(frequencies,dict) or set(frequencies)!=set(FIELDS)
                        or any(type(frequencies[field]) is not int or not 0<=frequencies[field]<=lengths[field] for field in FIELDS)
                        or not any(frequencies.values())):
                    raise ValueError('sparse_tokenizer_posting_invalid')
                values=tuple(frequencies[field] for field in FIELDS)
                for index,value in enumerate(values):frequency_sums[index]+=value
                buffer.append((bytes.fromhex(term),count,values,row['members']));postings+=1;previous=term
                if len(buffer)>=run_rows:flush()
            if frequency_sums!=[lengths[field] for field in FIELDS]:raise ValueError('sparse_tokenizer_frequency_mismatch')
            for index,field in enumerate(FIELDS):
                totals[index]+=weighted[field]
                if totals[index]>MAX_INTEGER:raise ValueError('sparse_tokenizer_statistics_overflow')
            db.execute('INSERT INTO profiles VALUES(?,?,?,?,?,?,?,?,?)',
                       (count,bytes.fromhex(row['id']),row['vector_ordinal'],row['first_membership'],row['members'],*[lengths[field] for field in FIELDS]))
            count+=1;members+=row['members']
            if count%1024==0:db.commit()
        if (not stream.verified or count!=profiles.manifest['profiles'] or members!=profiles.manifest['members']):
            raise ValueError('sparse_tokenization_population_mismatch')
        flush();db.commit();profiles.assert_unchanged()
        if db.execute('PRAGMA integrity_check').fetchone()!=('ok',):raise ValueError('sparse_tokenization_database_invalid')
        db.close();path=root/'profiles.sqlite'
        with path.open('r+b') as target:os.fsync(target.fileno())
        manifest={'format':'prepared-sparse-tokenization-v1','complete':True,'search_index':False,
          'profiles_sha256':profiles.manifest_sha256,'profiles':count,'members':members,'postings':postings,
          'analyzer_sha256':analyzer_sha256,'analyzer':'word-v1',
          'weighted_field_lengths':dict(zip(FIELDS,totals)),'runs':runs,
          'database_bytes':path.stat().st_size,'database_sha256':file_hash(path)}
        raw=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()
        with (root/'manifest.json').open('xb') as target:target.write(raw);target.flush();os.fsync(target.fileno())
        sync_directory(root);return hashlib.sha256(raw).hexdigest()
    finally:db.close()
