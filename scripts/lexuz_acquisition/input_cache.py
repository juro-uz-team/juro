"""Bounded process-local reuse of validated inputs; each membership stays distinct."""
import asyncio
from collections import OrderedDict

from .store import digest, encoded


def cache_limits(mib):
    if type(mib) is not int or not 1 <= mib <= 4096:
        raise ValueError('input_cache_mib must be an integer between 1 and 4096')
    # Scale both bounds: raising bytes alone leaves the old entry-count ceiling
    # evicting large historical editions before their next reuse.
    return {'max_bytes': mib*1024*1024, 'max_entries': mib*128}


class InputCache:
    def __init__(self, max_bytes=64*1024*1024, max_entries=8192):
        self.entries = OrderedDict()
        self.max_bytes, self.max_entries = max_bytes, max_entries
        self.bytes = self.hits = self.misses = 0
        self.pending = {}
        self.coalesced = 0
        self.evictions = 0

    @staticmethod
    def eligible(identity):
        # Real work IDs are ASCII hashes plus an ordinal. Other callers retain
        # the authoritative Node validator, including its trimming/error rules.
        return identity.isascii() and identity == identity.strip() and 0 < len(identity) <= 300

    def get(self, key, identity):
        entry = self.entries.get(key)
        if entry is None or not self.eligible(identity):
            self.misses += 1
            return None
        self.entries.move_to_end(key)
        self.hits += 1
        return self.reidentify(entry[0], identity)

    @staticmethod
    def reidentify(value, identity):
        chunks = []
        if value.get('error'):
            return dict(value)
        for original in value['chunks']:
            chunk = original['chunk']
            # Same canonical identity recipe as prepareEmbeddingChunks. The
            # cross-runtime equality fixture guards this compatibility seam.
            stamp = digest(encoded({'ordinal': chunk['ordinal'], 'policyVersion': chunk['policyVersion'],
                'snapshotProvisionId': identity, 'targetTokens': chunk['targetTokens'],
                'officialTextSha256': chunk['officialTextSha256']}))
            chunks.append({**original, 'chunk': {**chunk, 'id': chunk['policyVersion']+':'+stamp,
                'snapshotProvisionId': identity, 'hierarchy': list(chunk['hierarchy'])}})
        return {'chunks': chunks}

    def reserve(self, key):
        if key in self.pending:
            self.coalesced += 1
            return self.pending[key], False
        future = asyncio.get_running_loop().create_future()
        self.pending[key] = future
        return future, True

    def complete(self, key, value, future):
        if self.pending.get(key) is not future:
            return
        del self.pending[key]
        # The owner adds work provenance after returning. Waiters must never
        # see those mutations, including when an oversized input isn't cached.
        stable = dict(value) if value.get('error') else {'chunks': [
            {**item, 'chunk': {**item['chunk'], 'hierarchy': list(item['chunk']['hierarchy'])}}
            for item in value['chunks']]}
        future.set_result(stable)

    def put(self, key, result):
        if result.get('error') or 'chunks' not in result:
            return
        chunks = result['chunks']
        # Conservative UTF-32 string accounting and per-chunk container budget;
        # no source text keys or unbounded document objects are retained.
        size = 512 + sum(4096 + 4*(len(item['input']) + len(item.get('compactInput', '')) + sum(len(value) for value in item['chunk'].values() if isinstance(value, str))
            + sum(len(part) for part in item['chunk']['hierarchy'])) for item in chunks)
        if size > self.max_bytes or self.max_entries < 1:
            return
        if key in self.entries:
            self.bytes -= self.entries.pop(key)[1]
        while self.entries and (self.bytes + size > self.max_bytes or len(self.entries) >= self.max_entries):
            self.bytes -= self.entries.popitem(last=False)[1][1]
            self.evictions += 1
        value = {'chunks': [{**item, 'chunk': {**item['chunk'], 'hierarchy': list(item['chunk']['hierarchy'])}}
                            for item in chunks]}
        self.entries[key] = (value, size)
        self.bytes += size
