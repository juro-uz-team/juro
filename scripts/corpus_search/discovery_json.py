"""Encode discovery transport, never canonical artifact or receipt bytes."""
import json
import hashlib
import threading
from collections import OrderedDict
from cancellation import check_cancelled

try:
    import orjson as native
except ImportError:
    native = None


def encode_discovery_json(value):
    """Accept native output only after an exact decoded-value comparison.

    In particular, nonfinite numbers must not become null, and oversized
    integers must not lose precision. The strict standard encoder retains
    compatibility when native encoding is unavailable or changes a value.
    Callers still bound the actual returned UTF-8 bytes before publication.
    """
    if native is not None:
        try:
            raw = native.dumps(value)
            if native.loads(raw) == value:
                return raw
        except (TypeError, ValueError):
            pass
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


class ProjectedRecordDecoder:
    """Bounded derived bytes, never a cached source-authentication verdict.

    Call only after authenticating the physical source block on this read.
    Content keys bind every input byte; returned objects are request-owned.
    Sharing this decoder between readers does not share mutable JSON objects.
    """
    def __init__(self,project,*,max_bytes=32*1024*1024,max_entries=128):
        if not callable(project) or type(max_bytes) is not int or max_bytes<1 or type(max_entries) is not int or max_entries<1:
            raise ValueError('discovery_record_cache_configuration')
        self.project=project;self.max_bytes=max_bytes;self.max_entries=max_entries
        self.entries=OrderedDict();self.bytes=0;self.lock=threading.Lock()

    def __call__(self,raw):
        check_cancelled()
        key=hashlib.sha256(raw).digest()
        with self.lock:
            cached=self.entries.get(key)
            if cached is not None:self.entries.move_to_end(key)
        if cached is not None:
            value=json.loads(cached);check_cancelled();return value
        value=json.loads(raw)
        if not isinstance(value,dict):raise ValueError('source_projection_record_invalid')
        projected=self.project(value)
        if projected is value:
            check_cancelled();return value
        value=projected
        encoded=encode_discovery_json(value);cost=len(encoded)+256
        check_cancelled()
        if cost<=self.max_bytes and len(encoded)<len(raw):
            with self.lock:
                previous=self.entries.pop(key,None)
                if previous is not None:self.bytes-=len(previous)+256
                while self.entries and (self.bytes+cost>self.max_bytes or len(self.entries)>=self.max_entries):
                    _,removed=self.entries.popitem(last=False);self.bytes-=len(removed)+256
                self.entries[key]=encoded;self.bytes+=cost
        return value
