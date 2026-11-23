"""Shared pacing including redirects, catalog posts, assets and retry requests."""
import asyncio
import email.utils
import hashlib
import math
import os
import random
import shutil
import time
import uuid
from collections import deque
from urllib.parse import urljoin, urlsplit

import aiohttp
from .compression import writer
from .store import ResourcePause
from .transfer_metrics import TransferMetrics


class RequestFailure(Exception):
    def __init__(self, reason, transient=False, retry_after=0):
        super().__init__(reason)
        self.transient, self.retry_after = transient, retry_after


def retry_after(value, now=None):
    if not value:
        return 0
    try:
        return max(0, float(value))
    except ValueError:
        try:
            return max(0, email.utils.parsedate_to_datetime(value).timestamp() - (now or time.time()))
        except (ValueError, TypeError):
            return 0


class Budget:
    def __init__(self, clock=time.monotonic, sleep=asyncio.sleep, adaptive=True):
        self.clock, self.sleep = clock, sleep
        self.adaptive = adaptive
        self.rate, self.ceiling = 150.0, 150.0
        self.pause_until = self.last_change = clock()
        self.lock = asyncio.Lock()
        self.admissions = deque()
        self.observations = deque()
        self.failures = self.throttled = self.slow_responses = 0
        self.baseline = None
        self.requests = 0

    async def acquire(self):
        while True:
            async with self.lock:
                now = self.clock()
                while self.admissions and self.admissions[0] <= now-1:
                    self.admissions.popleft()
                delay = max(0, self.pause_until-now)
                if len(self.admissions) >= max(1, int(self.rate)):
                    delay = max(delay, self.admissions[0]+1-now)
                if delay <= 0:
                    self.admissions.append(now)
                    self.requests += 1
                    return
            # A delayed event loop must not serialize allowed requests behind
            # tiny timer wakes. The rolling window still enforces the shared
            # ceiling, and the connector bounds bursts to its configured limit.
            await self.sleep(delay)

    def observe(self, status, latency, pause=0):
        now = self.clock()
        self.observations.append((now, status, latency))
        self.failures += status == 0 or status >= 500
        self.throttled += status == 429
        if self.baseline is not None:
            self.slow_responses += latency > self.baseline * 2
        while self.observations and self.observations[0][0] < now - 60:
            _, expired_status, expired_latency = self.observations.popleft()
            self.failures -= expired_status == 0 or expired_status >= 500
            self.throttled -= expired_status == 429
            if self.baseline is not None:
                self.slow_responses -= expired_latency > self.baseline * 2
        failures = self.failures
        # Use header latency; a lone slow large-body download cannot halve rate.
        slow = len(self.observations) >= 40 and self.baseline is not None and self.slow_responses > len(self.observations) * .75
        degraded = status == 429 or failures >= 5 or slow
        if pause:
            self.pause_until = max(self.pause_until, now + pause)
        if not self.adaptive:
            return
        if failures >= 10 and failures > len(self.observations)/2:
            self.pause_until = max(self.pause_until, now + 30)
        if degraded and (self.rate == 150 or status == 429 or now-self.last_change >= 60):
            if now-self.last_change >= 1 or self.rate == 150:
                self.rate = max(1, self.rate / 2)
                self.last_change = now
        elif now-self.last_change >= 60 and not failures and not self.throttled:
            self.rate = min(self.ceiling, self.rate * 1.1)
            self.last_change = now
        if len(self.observations) >= 40 and self.baseline is None:
            self.baseline = sorted(t for _, _, t in self.observations)[len(self.observations)//2]
            self.slow_responses = sum(t > self.baseline * 2 for _, _, t in self.observations)


def acquisition_timeouts(store, connect=None, read_idle=None):
    settings = {'connect_timeout': 15.0, 'read_idle_timeout': 90.0,
                **(store.setting('acquisition_timeouts') or {})}
    for name, value in (('connect_timeout', connect), ('read_idle_timeout', read_idle)):
        if value is not None:
            settings[name] = value
    if any(not math.isfinite(value) or value <= 0 for value in settings.values()):
        raise ValueError('Connect and read-idle timeouts must be finite positive seconds')
    store.set('acquisition_timeouts', settings)
    return settings


async def file_work(function, *args):
    # A cancelled await cannot stop an active filesystem call. Wait for that
    # call before cleanup so a thread never writes into a closed/deleted file.
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    cancellation = None
    while True:
        try:
            result = await asyncio.shield(task)
            break
        except asyncio.CancelledError as error:
            if task.cancelled():
                raise
            cancellation = cancellation or error
        except BaseException:
            if cancellation is not None:
                raise cancellation
            raise
    if cancellation is not None:
        raise cancellation
    return result


async def response_chunks(content, size=131072):
    """Coalesce short network reads with at most one bounded pending block.

    iter_chunked sets a maximum, not a minimum: TCP fragmentation must not
    cause a filesystem thread dispatch and disk-space query for every packet.
    Yielding retains backpressure; an incomplete tail is only emitted at EOF.
    """
    pending = bytearray()
    async for chunk in content.iter_chunked(size):
        if not pending and len(chunk) == size:
            yield chunk
            continue
        offset = 0
        while offset < len(chunk):
            take = min(size - len(pending), len(chunk) - offset)
            pending.extend(chunk[offset:offset + take])
            offset += take
            if len(pending) == size:
                block = bytes(pending)
                pending.clear()
                yield block
    if pending:
        yield bytes(pending)


class ResponseObject:
    """One backpressured response stream; SQLite is never accessed here."""
    def __init__(self, store, check_space, base=None):
        self.store, self.check_space = store, check_space
        self.base, self.storage = base, {}
        self.temporary = store.root / 'temporary' / (uuid.uuid4().hex + '.partial')
        self.target = self.compressed = None
        self.sha, self.size = hashlib.sha256(), 0

    def open(self):
        self.check_space()
        self.target = self.temporary.open('wb')
        self.compressed = writer(self.target)

    def write(self, chunk):
        self.check_space()
        self.sha.update(chunk)
        self.size += len(chunk)
        self.compressed.write(chunk)

    def finish(self):
        self.compressed.close()
        self.compressed = None
        self.target.flush()
        os.fsync(self.target.fileno())
        self.target.close()
        self.target = None
        sha = self.sha.hexdigest()
        key = self.store.publish(self.temporary, sha, self.size, base=self.base, storage=self.storage)
        return sha, key, self.size

    def close(self):
        try:
            if self.compressed is not None:
                self.compressed.close()
        finally:
            try:
                if self.target is not None:
                    self.target.close()
            finally:
                if self.temporary.exists():
                    self.temporary.unlink()


class Receiver:
    def __init__(self, store, budget, reserve=10 * 1024**3):
        self.metrics = TransferMetrics()
        self.successful_transfers = 0
        self.store, self.budget, self.reserve = store, budget, reserve
        self.probe_url = store.setting('connectivity_probe_url')
        self.probe_url_saved = False
        settings = acquisition_timeouts(store)
        self.timeout = aiohttp.ClientTimeout(total=None,
            connect=settings['connect_timeout'],
            sock_connect=settings['connect_timeout'], sock_read=settings['read_idle_timeout'])
        self.session = None
        self.catalog_session = None
        self.probe_session = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            timeout=self.timeout,
            connector=aiohttp.TCPConnector(limit=self.store.setting('network_workers') or 40),
            cookie_jar=aiohttp.DummyCookieJar(),
            headers={'User-Agent': 'JURO-Detached-Legal-Acquisition/1.0 (+https://juro.uz)'})
        # Public PDF endpoints issue ASP.NET session cookies. Sharing one across
        # unrelated GETs allows a slow request to serialize the entire corpus.
        # Form-driven catalog navigation retains its original cookie continuity,
        # with both sessions sharing the same connection limit and request budget.
        self.catalog_session = aiohttp.ClientSession(
            timeout=self.timeout, connector=self.session.connector, connector_owner=False,
            headers={'User-Agent': 'JURO-Detached-Legal-Acquisition/1.0 (+https://juro.uz)'})
        # Diagnostic traffic must not time out waiting for a download slot.
        # Connectivity coalesces callers; there is at most one active probe.
        self.probe_session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(limit=1),
            cookie_jar=aiohttp.DummyCookieJar(),
            headers={'User-Agent': 'JURO-Detached-Legal-Acquisition/1.0 (+https://juro.uz)'})
        return self

    async def __aexit__(self, *args):
        if self.catalog_session is not None:
            await self.catalog_session.close()
        await self.session.close()
        if self.probe_session is not None:
            await self.probe_session.close()

    def request_session(self, row, method):
        if self.catalog_session is not None and (row['kind'].startswith('catalog_') or method == 'POST'):
            return self.catalog_session
        return self.session

    def space(self):
        if shutil.disk_usage(self.store.root).free < self.reserve:
            raise ResourcePause('disk_reserve_breach: add capacity; no originals deleted')

    async def check_connection(self):
        """Bounded publisher probe, sharing normal pacing and Retry-After.

        Read a small body prefix as well as headers: successful DNS/TCP alone
        does not show that content transfers have recovered. Never publish a
        probe as a document receipt.
        """
        reasons = []
        try:
            async with asyncio.timeout(10):
                urls = list(dict.fromkeys(filter(None, ('https://lex.uz/', self.probe_url))))
                for url in urls:
                    healthy, reason = await self.probe_endpoint(url, 4 if len(urls) > 1 else 8)
                    if healthy:
                        return True, reason
                    reasons.append(reason)
                    if self.budget.pause_until > self.budget.clock():
                        break
                return False, ';'.join(reasons)
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            self.budget.observe(0, 10)
            return False, f'probe_transport:{type(error).__name__}'

    async def probe_endpoint(self, url, timeout):
        start = time.monotonic()
        try:
            async with asyncio.timeout(timeout):
                for _ in range(4):
                    if urlsplit(url).hostname not in ('lex.uz', 'www.lex.uz'):
                        return False, 'probe_external_redirect'
                    await self.budget.acquire()
                    session = self.probe_session or self.session
                    async with session.get(url, allow_redirects=False,
                            timeout=aiohttp.ClientTimeout(total=timeout, connect=timeout, sock_read=timeout)) as response:
                        self.budget.observe(response.status, time.monotonic()-start,
                                            retry_after(response.headers.get('Retry-After')))
                        if response.status in (301, 302, 303, 307, 308) and response.headers.get('Location'):
                            url = urljoin(url, response.headers['Location'])
                            continue
                        prefix = await response.content.read(1024)
                        return response.status == 200 and bool(prefix), f'probe_http_{response.status}' if prefix else 'probe_empty_response'
                return False, 'probe_redirect_limit'
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            self.budget.observe(0, time.monotonic()-start)
            return False, f'probe_transport:{type(error).__name__}'

    async def fetch(self, row, method='GET', data=None):
        successful = False
        self.metrics.phase(row['id'], 'space')
        try:
            result = await self._fetch(row, method, data)
            successful = True
            return result
        finally:
            self.metrics.finish(row['id'], successful)

    async def _fetch(self, row, method='GET', data=None):
        await file_work(self.space)
        session = self.request_session(row, method)
        url, chain = row['url'], []
        for _ in range(11):
            if urlsplit(url).hostname not in ('lex.uz', 'www.lex.uz'):
                raise RequestFailure('external_redirect_requires_source_reconciliation')
            self.metrics.phase(row['id'], 'budget')
            await self.budget.acquire()
            start = time.monotonic()
            context = __import__('json').loads(row['context'])
            headers = {'Referer': context['referer'], 'X-Requested-With': 'XMLHttpRequest'} if 'referer' in context else {}
            try:
                self.metrics.phase(row['id'], 'headers')
                async with session.request(method, url, data=data, headers=headers, allow_redirects=False) as response:
                    self.metrics.phase(row['id'], 'metadata')
                    pause = retry_after(response.headers.get('Retry-After'))
                    self.budget.observe(response.status, time.monotonic()-start, pause)
                    observation = {'url': url, 'status': response.status, 'headers': dict(response.headers)}
                    chain.append(observation)
                    if response.status in (301, 302, 303, 307, 308):
                        if 'Location' not in response.headers:
                            raise RequestFailure('redirect_location_missing')
                        url = urljoin(url, response.headers['Location'])
                        if response.status in (301, 302, 303):
                            method, data = 'GET', None
                        continue
                    base = self.store.edition_base(row) if response.status == 200 else None
                    writer = ResponseObject(self.store, self.space, base)
                    try:
                        self.metrics.phase(row['id'], 'open')
                        await file_work(writer.open)
                        self.metrics.phase(row['id'], 'body')
                        async for chunk in response_chunks(response.content):
                            self.metrics.phase(row['id'], 'write')
                            await file_work(writer.write, chunk)
                            self.metrics.phase(row['id'], 'body')
                        # aiohttp validates framing and compressed-stream completion.
                        self.metrics.phase(row['id'], 'publish')
                        sha, key, size = await file_work(writer.finish)
                        self.metrics.phase(row['id'], 'receipt')
                        receipt = {'requested_url': row['url'], 'final_url': url, 'chain': chain,
                                   'status': response.status, 'content_type': response.headers.get('Content-Type', '')}
                        if writer.storage:
                            receipt['storage'] = writer.storage
                        # Until the worker distinguishes outage from an item
                        # failure, retain an unfinished lease. A crash in that
                        # interval must not turn a temporary 503 into a final gap.
                        self.store.receipt(row['id'], sha, key, size, receipt,
                                           pending_failure=response.status in (408, 429) or response.status >= 500,
                                           row=row, base=base if not writer.storage.get('delta_fallback') else None)
                    finally:
                        self.metrics.phase(row['id'], 'close')
                        await file_work(writer.close)
                    if response.status != 200:
                        raise RequestFailure(f'http_{response.status}', response.status in (408, 429) or response.status >= 500, pause)
                    if not size:
                        # Attachment generation can temporarily return an empty
                        # 200. Retry within the existing five-attempt limit;
                        # unresolved relationship panels remain deterministic.
                        raise RequestFailure('unexplained_empty_response', row['kind'] == 'asset')
                    self.successful_transfers += 1
                    if method == 'GET' and row['kind'] in ('document', 'card') and 'html' in receipt['content_type'].lower():
                        self.probe_url = url
                        if not self.probe_url_saved:
                            self.store.set('connectivity_probe_url', url)
                            self.probe_url_saved = True
                    return self.store.get(row['id'])
            except (aiohttp.ClientError, asyncio.TimeoutError) as error:
                self.budget.observe(0, time.monotonic()-start)
                raise RequestFailure(f'transport:{type(error).__name__}:{error}', True) from error
        raise RequestFailure('redirect_limit')


def retry_delay(attempt, pause=0):
    return max(pause, random.uniform(0, min(60, 2 ** max(0, attempt-1))))
