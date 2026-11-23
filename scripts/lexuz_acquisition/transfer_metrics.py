"""Bounded, in-memory transfer stage timings; never part of corpus receipts."""
import time
from collections import Counter, deque


class TransferMetrics:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.active = {}
        self.finished = deque(maxlen=12000)

    def phase(self, identity, phase):
        now = self.clock()
        item = self.active.get(identity)
        if item is None:
            item = self.active[identity] = {'phase': phase, 'since': now, 'totals': {}}
        else:
            previous = item['phase']
            item['totals'][previous] = item['totals'].get(previous, 0) + now-item['since']
            item.update(phase=phase, since=now)

    def finish(self, identity, successful):
        self.phase(identity, 'finished')
        item = self.active.pop(identity)
        self.finished.append((self.clock(), successful, item['totals']))

    def snapshot(self):
        now = self.clock()
        while self.finished and self.finished[0][0] < now-60:
            self.finished.popleft()
        totals, active, oldest = Counter(), Counter(), {}
        for _, _, stages in self.finished:
            totals.update(stages)
        for item in self.active.values():
            phase = item['phase']
            active[phase] += 1
            oldest[phase] = max(oldest.get(phase, 0), now-item['since'])
        count = len(self.finished)
        return {'completed_attempts_60s': count,
                'successful_attempts_60s': sum(ok for _, ok, _ in self.finished),
                'active_by_phase': dict(active),
                'oldest_phase_seconds': {k: round(v, 3) for k, v in oldest.items()},
                'mean_stage_seconds': {k: round(v/max(1, count), 4) for k, v in totals.items()}}
