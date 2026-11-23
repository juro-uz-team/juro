"""Durable HTML discovery ahead of expensive content preparation.

This queue never changes content readiness. The normal preparation path remains
authoritative and can finish a document even if this optional advance pass fails.
"""
from .store import PREPARATION_LANE


class DiscoveryQueue:
    def __init__(self, store, parser_version):
        self.store = store
        self.claim_turn = 0
        store.db.executescript('''
            CREATE TABLE IF NOT EXISTS discovery(
                work TEXT PRIMARY KEY, state TEXT NOT NULL, priority INTEGER NOT NULL,
                generation INTEGER NOT NULL DEFAULT 0, error TEXT,
                byte_size INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS discovery_queue ON discovery(state,priority);
        ''')
        previous = store.setting('discovery_parser_version')
        with store.db:
            # One transactional metadata upgrade; never reread source objects or
            # invalidate successful preparation to change scheduling order.
            columns = {row[1] for row in store.db.execute('PRAGMA table_info(discovery)')}
            if 'byte_size' not in columns:
                if not store.db.in_transaction:
                    store.db.execute('BEGIN')
                store.db.execute('ALTER TABLE discovery ADD COLUMN byte_size INTEGER NOT NULL DEFAULT 0')
                store.db.execute("""UPDATE discovery SET byte_size=coalesce(
                    (SELECT bytes FROM work WHERE id=discovery.work),0)
                    WHERE state IN ('pending','active')""")
            store.db.execute("""CREATE INDEX IF NOT EXISTS discovery_small_pending
                ON discovery(priority,byte_size) WHERE state='pending'""")
            if previous is not None and previous != parser_version:
                store.db.execute('DELETE FROM discovery')
            store.db.execute("UPDATE discovery SET state='pending' WHERE state='active'")
        store.set('discovery_parser_version', parser_version)

    def seed(self):
        # Existing successful preparation has already expanded its links. Use
        # the lane index to avoid revisiting the entire corpus on every resume.
        with self.store.db:
            self.store.db.execute(f"""INSERT OR IGNORE INTO discovery(work,state,priority,byte_size)
                SELECT id,'pending',CASE WHEN instr(upper(url),'ONDATE')=0 THEN 0 ELSE 1 END,coalesce(bytes,0)
                FROM work INDEXED BY work_preparation_lane
                WHERE state IN ('acquired','preparing') AND ({PREPARATION_LANE})=0""")

    def schedule(self, identity):
        # Called inside the source receipt/context transaction, never committed
        # independently of the work that made discovery necessary.
        self.store.db.execute("""INSERT INTO discovery(work,state,priority,byte_size)
            SELECT id,'pending',CASE WHEN instr(upper(url),'ONDATE')=0 THEN 0 ELSE 1 END,coalesce(bytes,0)
            FROM work WHERE id=? AND kind='document' AND state IN ('acquired','preparing')
            ON CONFLICT(work) DO UPDATE SET state='pending',generation=generation+1,error=NULL,
                byte_size=excluded.byte_size""", (identity,))

    def claim(self):
        # Current pages always lead. Three size-ordered turns reach new sources
        # quickly; every fourth turn advances the oldest work within a priority
        # so large editions cannot be indefinitely displaced by small pages.
        small = self.claim_turn % 4 != 0
        index = 'discovery_small_pending' if small else 'discovery_queue'
        order = 'd.priority,d.byte_size,d.rowid' if small else 'd.priority,d.rowid'
        with self.store.db:
            row = self.store.db.execute(f"""SELECT w.*,d.generation AS discovery_generation
                FROM discovery d INDEXED BY {index} CROSS JOIN work w ON w.id=d.work
                WHERE d.state='pending' ORDER BY {order} LIMIT 1""").fetchone()
            if row is None:
                return None
            if row['state'] not in ('acquired', 'preparing'):
                self.store.db.execute("UPDATE discovery SET state='superseded' WHERE work=?", (row['id'],))
                return None
            self.store.db.execute("UPDATE discovery SET state='active' WHERE work=?", (row['id'],))
            self.claim_turn += 1
            return dict(row)

    def current(self, row):
        latest = self.store.get(row['id'])
        return latest['raw_hash'] == row['raw_hash'] and latest['context'] == row['context']

    def expanded(self, row):
        done = self.store.db.execute("SELECT 1 FROM discovery WHERE work=? AND state='done'", (row['id'],)).fetchone()
        return bool(done) and self.current(row)

    def finish(self, row, error=None):
        if not self.current(row):
            with self.store.db:
                self.store.db.execute("UPDATE discovery SET state='superseded' WHERE work=? AND generation=? AND state='active'",
                                      (row['id'], row['discovery_generation']))
            return False
        with self.store.db:
            changed = self.store.db.execute("""UPDATE discovery SET state=?,error=?
                WHERE work=? AND generation=? AND state='active'""",
                ('failed' if error else 'done', error, row['id'], row['discovery_generation'])).rowcount
            if changed:
                self.store.event(row['id'], 'discovery_failure' if error else 'discovery',
                                 {'raw_hash': row['raw_hash'], 'error': error})
        return bool(changed)

    def prepared(self, identity):
        # The normal preparation pass also records all links before its receipt.
        self.store.db.execute("UPDATE discovery SET state='done',error=NULL WHERE work=?", (identity,))
