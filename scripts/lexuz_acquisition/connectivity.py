"""Shared outage gate; local parsing/OCR never waits on this gate."""
import asyncio
import time


class Connectivity:
    def __init__(self, store, receiver, clock=time.time, sleep=asyncio.sleep):
        self.store, self.receiver = store, receiver
        self.clock, self.sleep = clock, sleep
        self.state = store.setting('connectivity') or {'state': 'online'}
        self.probe = None
        self.waiting_successes = getattr(receiver, 'successful_transfers', 0)

    def recovered_transfer(self):
        if self.state['state'] != 'waiting' or getattr(self.receiver, 'successful_transfers', 0) <= self.waiting_successes:
            return False
        budget = getattr(self.receiver, 'budget', None)
        if budget is not None and budget.pause_until > budget.clock():
            return False
        self.state = {'state': 'online', 'checked_at': self.clock()}
        with self.store.db:
            self.store.set('connectivity', self.state)
            self.store.event(None, 'connectivity', {**self.state, 'recovered': True, 'reason': 'completed_transfer'})
        return True

    async def check(self):
        # All affected workers share one probe instead of probing per identity.
        if self.probe is None or self.probe.done():
            self.probe = asyncio.create_task(self._check())
        return await asyncio.shield(self.probe)

    async def _check(self):
        successful_before = getattr(self.receiver, 'successful_transfers', 0)
        try:
            online, reason = await self.receiver.check_connection()
        except Exception as error:
            # An unavailable probe must not turn an outage into a crashed run.
            online, reason = False, f'probe_internal:{type(error).__name__}:{error}'
        budget = getattr(self.receiver, 'budget', None)
        cooling_down = budget is not None and budget.pause_until > budget.clock()
        if not online and not cooling_down and getattr(self.receiver, 'successful_transfers', 0) > successful_before:
            # The homepage can time out while document endpoints are healthy.
            # A complete retained transfer during this probe disproves a
            # global outage. Header-only, empty and failed responses do not.
            online, reason = True, 'concurrent_transfer_succeeded'
        now = self.clock()
        was_waiting = self.state['state'] == 'waiting'
        if online:
            self.state = {'state': 'online', 'checked_at': now}
        else:
            self.waiting_successes = getattr(self.receiver, 'successful_transfers', 0)
            failures = self.state.get('probe_failures', 0) + 1
            delay = min(120, 30 * 2 ** min(failures-1, 2))
            budget = getattr(self.receiver, 'budget', None)
            if budget is not None:
                # Preserve a publisher cooldown across desktop/PC restarts,
                # when the in-memory request budget itself is recreated.
                delay = max(delay, budget.pause_until-budget.clock())
            self.state = {'state': 'waiting', 'since': self.state.get('since', now),
                          'checked_at': now, 'next_probe_at': now + delay,
                          'probe_failures': failures, 'reason': reason}
            if cooling_down:
                self.state['publisher_cooldown_until'] = now + budget.pause_until-budget.clock()
        with self.store.db:
            self.store.set('connectivity', self.state)
            self.store.event(None, 'connectivity', {**self.state, 'recovered': bool(online and was_waiting)})
        return online

    async def failure_is_outage(self):
        self.recovered_transfer()
        if self.state['state'] == 'waiting':
            return True
        return not await self.check()

    async def allow(self, stopped):
        while not stopped():
            self.recovered_transfer()
            if self.state['state'] != 'waiting':
                # Isolated URL failures are common. Their diagnostic probe
                # must not stall unrelated successful downloads.
                return True
            elif self.probe is not None and not self.probe.done():
                await asyncio.shield(self.probe)
            elif self.clock() >= self.state['next_probe_at']:
                await self.check()
            else:
                await self.sleep(min(.2, max(0, self.state['next_probe_at']-self.clock())))
        return False
