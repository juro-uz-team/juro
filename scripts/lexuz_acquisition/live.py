"""Disposable live telemetry, separate from durable corpus/checkpoint data."""
import asyncio
import contextlib
import json
import os
import shutil
import time


def write_feed(path, report):
    # Telemetry is replaceable; unlike a checkpoint it needs no fsync. A reader
    # sees a complete old or new JSON file, never a half-written snapshot.
    temporary = path.with_suffix('.tmp')
    report = {**report, 'free_bytes': shutil.disk_usage(path.parent).free}
    temporary.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    os.replace(temporary, path)


class LiveProgress:
    def __init__(self, store, status=lambda: 'running', interval=1, metrics=None):
        self.metrics = metrics
        self.scheduler_lag = 0
        self.store, self.status, self.interval = store, status, interval
        self.path = store.root / 'live-progress.json'
        self.task = None
        self.finished = asyncio.Event()
        self.last_error = None
        self.previous_temp_store = store.db.execute('PRAGMA temp_store').fetchone()[0]
        # SQLite TEMP does not imply RAM: its default can journal temporary
        # tables to disk on each transaction. These bounded counters must stay
        # in memory to avoid adding I/O to every acquisition/preparation commit.
        store.db.execute('PRAGMA temp_store=MEMORY')
        # TEMP tables/triggers belong only to this coordinator connection.
        # Counter updates roll back with the original work transaction and add
        # no pages to the durable manifest or its WAL.
        store.db.executescript('''
            CREATE TEMP TABLE live_counts(kind TEXT, state TEXT, count INTEGER,
                                          PRIMARY KEY(kind,state)) WITHOUT ROWID;
            CREATE TEMP TABLE live_receives(observed REAL);
            CREATE INDEX live_receives_time ON live_receives(observed);
            CREATE TEMP TRIGGER live_receive AFTER INSERT ON main.events
            WHEN NEW.stage='receive' AND json_extract(NEW.detail,'$.status')=200
                 AND json_extract(NEW.detail,'$.bytes')>0
            BEGIN INSERT INTO live_receives VALUES (NEW.observed); END;
        ''')
        for table in ('work', 'discovery'):
            if not store.db.execute('SELECT 1 FROM sqlite_master WHERE name=?', (table,)).fetchone():
                continue
            store.db.execute(f'INSERT INTO live_counts SELECT ?,state,count(*) FROM {table} GROUP BY state', (table,))
            store.db.executescript(f'''
                CREATE TEMP TRIGGER live_{table}_insert AFTER INSERT ON main.{table}
                BEGIN
                    INSERT INTO live_counts VALUES ('{table}',NEW.state,1)
                    ON CONFLICT(kind,state) DO UPDATE SET count=count+1;
                END;
                CREATE TEMP TRIGGER live_{table}_update AFTER UPDATE OF state ON main.{table}
                WHEN OLD.state<>NEW.state
                BEGIN
                    UPDATE live_counts SET count=count-1 WHERE kind='{table}' AND state=OLD.state;
                    INSERT INTO live_counts VALUES ('{table}',NEW.state,1)
                    ON CONFLICT(kind,state) DO UPDATE SET count=count+1;
                END;
                CREATE TEMP TRIGGER live_{table}_delete AFTER DELETE ON main.{table}
                BEGIN UPDATE live_counts SET count=count-1 WHERE kind='{table}' AND state=OLD.state; END;
            ''')
        store.db.execute('''INSERT INTO live_receives SELECT observed FROM events
            WHERE stage='receive' AND observed>? AND json_extract(detail,'$.status')=200
            AND json_extract(detail,'$.bytes')>0''', (time.time()-60,))
        store.db.commit()
        self.started = store.setting('started') or time.time()
        self.fixed = {'build_id': store.setting('build_id'),
                      'network_workers': store.setting('network_workers') or 40,
                      'preparation_workers': store.setting('preparation_workers') or 4,
                      'discovery_workers': store.setting('discovery_workers') if store.setting('discovery_workers') is not None else 2}

    def snapshot(self):
        if self.store.db.in_transaction:
            # Never commit another operation or expose its uncommitted state.
            return None
        now = time.time()
        self.store.db.execute('DELETE FROM live_receives WHERE observed<=?', (now-60,))
        self.store.db.commit()
        work = dict(self.store.db.execute("SELECT state,count FROM live_counts WHERE kind='work' AND count>0"))
        discovery = dict(self.store.db.execute("SELECT state,count FROM live_counts WHERE kind='discovery' AND count>0"))
        return {**self.fixed, 'status': self.status(), 'observed_at': now,
                'elapsed_seconds': now-self.started, 'queues': work,
                'discovered_work_total': sum(work.values()), 'discovery_queue': discovery,
                'connectivity': self.store.setting('connectivity') or {'state': 'online'},
                'useful_rps_last_60s': self.store.db.execute('SELECT count(*) FROM live_receives').fetchone()[0]/60,
                'feed_interval_seconds': self.interval,
                'scheduler_lag_seconds': round(self.scheduler_lag, 3),
                **({'transfer_metrics': self.metrics()} if self.metrics is not None else {})}

    async def emit(self):
        try:
            report = self.snapshot()
            if report is not None:
                await asyncio.to_thread(write_feed, self.path, report)
            self.last_error = None
        except Exception as error:
            # A busy/deleted telemetry file cannot stop acquisition. Its
            # old timestamp lets the UI flag stale values and retry later.
            self.last_error = str(error)

    async def publish(self):
        expected = time.monotonic()
        while True:
            self.scheduler_lag = max(0, time.monotonic()-expected)
            await self.emit()
            if self.finished.is_set():
                return
            expected = time.monotonic()+self.interval
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self.finished.wait(), self.interval)

    async def __aenter__(self):
        self.task = asyncio.create_task(self.publish())
        return self

    async def __aexit__(self, *args):
        self.finished.set()
        await self.task
        # Work may have committed while the previous file write was in flight.
        await self.emit()
        self.close()

    def close(self):
        # Allows another coordinator pass on the same connection in fixtures.
        # Never force a pending caller transaction to commit for telemetry.
        if not self.store.db.in_transaction:
            for name in ('live_receive', *(f'live_{table}_{action}' for table in ('work', 'discovery') for action in ('insert', 'update', 'delete'))):
                self.store.db.execute(f'DROP TRIGGER IF EXISTS temp.{name}')
            self.store.db.execute('DROP TABLE IF EXISTS temp.live_counts')
            self.store.db.execute('DROP TABLE IF EXISTS temp.live_receives')
            self.store.db.execute(f'PRAGMA temp_store={self.previous_temp_store}')


def read_feed(root):
    try:
        value = json.loads((root/'live-progress.json').read_text(encoding='utf-8'))
        if not 0 <= time.time()-value['observed_at'] <= max(5, value['feed_interval_seconds']*4):
            return None
        return value
    except (OSError, ValueError, KeyError, TypeError):
        return None
