"""Resume a daily Lex.uz acquisition against the pinned prepared corpus inventory."""
import argparse
import asyncio
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import re
import signal
import sqlite3
import sys
import time

from .media import Media, OCR_CONFIG
from .publisher import TAXONOMY_URL, document
from .runner import Coordinator, exclusive
from .store import Store, atomic_json, digest, encoded

DAY = 86_400
WEEK = 7 * DAY
TASHKENT = timezone(timedelta(hours=5))


def content_identity(record):
    return digest(encoded({field: record.get(field) for field in (
        'title', 'units', 'selected_edition', 'assignments', 'notices', 'tables', 'status', 'document_form',
    )}))


def asset_identity(row):
    context = row['context']
    return digest(encoded([row['kind'], row['url'], context.get('source'),
                           context.get('edition'), context.get('member')]))


def edition_on_or_after(token, observed):
    try:
        return datetime.strptime(token.split(' ', 1)[0], '%d.%m.%Y').date() >= (
            datetime.fromtimestamp(observed, TASHKENT).date())
    except (AttributeError, ValueError):
        return False


class SourceObservations:
    def __init__(self, db):
        self.db = db
        db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS baseline (pin TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS baseline_sources (source TEXT PRIMARY KEY, checked REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS baseline_inventory (source TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS observations (
                url TEXT PRIMARY KEY, source TEXT NOT NULL, edition TEXT, checked REAL NOT NULL,
                raw_hash TEXT NOT NULL, work TEXT NOT NULL, title TEXT, language TEXT, content_hash TEXT
            );
            CREATE INDEX IF NOT EXISTS observation_due ON observations(checked,url) WHERE edition IS NULL;
            CREATE TABLE IF NOT EXISTS attempted_sources (url TEXT PRIMARY KEY, attempted REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS catalog (
                language INTEGER NOT NULL, source TEXT NOT NULL, url TEXT NOT NULL, signature TEXT NOT NULL,
                PRIMARY KEY(language,source)
            );
            CREATE TABLE IF NOT EXISTS runs (
                day TEXT PRIMARY KEY, started REAL NOT NULL, catchup INTEGER NOT NULL,
                completed REAL, report TEXT
            );
            CREATE TABLE IF NOT EXISTS updates (
                id TEXT PRIMARY KEY, day TEXT NOT NULL, source TEXT NOT NULL, url TEXT NOT NULL,
                observed REAL NOT NULL, title TEXT NOT NULL, language TEXT,
                kind TEXT NOT NULL, edition TEXT, work TEXT
            );
            CREATE TABLE IF NOT EXISTS changed_works (day TEXT NOT NULL, work TEXT NOT NULL, PRIMARY KEY(day,work));
            CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, digest TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS catchup_handoff (id INTEGER PRIMARY KEY CHECK(id=1), activated REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS material_repairs (day TEXT PRIMARY KEY, attempted REAL NOT NULL);
        """)

    def seed(self, package):
        existing = self.db.execute('SELECT pin FROM baseline').fetchone()
        if existing:
            if existing[0] != package.sha256:
                raise ValueError('maintenance_baseline_changed')
            return
        with self.db:
            for part in range(len(package.handoff['shards']['inventory'])):
                for _, row in package.records('inventory', part):
                    self.observe_baseline(row)
                    ref = document(row['url']) if row.get('kind') == 'document' else None
                    if ref:
                        self.db.execute('INSERT OR IGNORE INTO baseline_inventory VALUES (?)', (ref['source'],))
                    if row.get('kind') in ('asset', 'member', 'card') and row.get('state') == 'done' and row.get('raw_hash'):
                        self.db.execute('INSERT OR IGNORE INTO attachments VALUES (?,?)',
                                        (asset_identity(row), row['raw_hash']))
            self.db.execute('CREATE INDEX IF NOT EXISTS observation_work ON observations(work)')
            self.db.execute("""INSERT INTO baseline_sources
                SELECT source, min(checked) FROM observations WHERE edition IS NULL GROUP BY source""")
            for part in range(len(package.handoff['shards']['prepared'])):
                for _, row in package.records('prepared', part):
                    self.db.execute('UPDATE observations SET content_hash=? WHERE work=?',
                                    (content_identity(row), row['work']))
            self.db.execute('INSERT INTO baseline VALUES (?)', (package.sha256,))

    def observe_baseline(self, row):
        if row.get('kind') != 'document' or row.get('state') != 'done':
            return
        ref = document(row['url'])
        receipt = row.get('receipt') or {}
        observed = receipt.get('observed')
        if (not ref or receipt.get('status') != 200 or not row.get('raw_hash')
                or not isinstance(observed, (int, float)) or not math.isfinite(observed) or observed <= 0):
            return
        self.db.execute("""
            INSERT INTO observations VALUES (?,?,?,?,?,?,NULL,NULL,NULL)
            ON CONFLICT(url) DO UPDATE SET checked=excluded.checked,raw_hash=excluded.raw_hash,work=excluded.work
            WHERE observations.checked<excluded.checked
        """, (ref['url'], ref['source'], ref['edition'], observed, row['raw_hash'], row['id']))

    def planned(self, catchup):
        if catchup:
            return {row[0] for row in self.db.execute('SELECT url FROM observations WHERE edition IS NULL')}
        count = self.db.execute('SELECT count(*) FROM observations WHERE edition IS NULL').fetchone()[0]
        return {row[0] for row in self.db.execute("""
            SELECT o.url FROM observations o LEFT JOIN attempted_sources a ON a.url=o.url
            WHERE o.edition IS NULL ORDER BY max(o.checked,coalesce(a.attempted,0)),o.url LIMIT ?
        """, (math.ceil(count / 7),))}

    def catalogue_change(self, language, item):
        prior = self.db.execute('SELECT signature FROM catalog WHERE language=? AND source=?',
                                (language, item['source'])).fetchone()
        return prior is None or prior[0] != digest(item['metadata'])

    def has(self, url):
        return self.db.execute('SELECT 1 FROM observations WHERE url=?', (url,)).fetchone() is not None

    def begin(self, now):
        day = datetime.fromtimestamp(now, TASHKENT).date().isoformat()
        incomplete = self.db.execute("""SELECT day,started,catchup FROM runs
            WHERE completed IS NULL AND (report IS NULL OR day=?) ORDER BY day LIMIT 1""", (day,)).fetchone()
        if incomplete:
            return incomplete
        if self.db.execute('SELECT 1 FROM runs WHERE day=?', (day,)).fetchone():
            return None
        catchup = not self.db.execute('SELECT 1 FROM runs WHERE catchup=1 AND completed IS NOT NULL').fetchone()
        with self.db:
            self.db.execute('INSERT INTO runs(day,started,catchup) VALUES (?,?,?)', (day, now, catchup))
        return day, now, catchup


class MaintenanceCoordinator(Coordinator):
    def __init__(self, store, media, observations, day, catchup):
        super().__init__(store, media)
        self.observations = observations
        self.day = day
        self.catchup = catchup
        self.planned = observations.planned(catchup)
        self.first_baseline = observations.db.execute('SELECT min(checked) FROM baseline_sources').fetchone()[0]

    def export_result(self, bounded):
        unresolved = self.store.db.execute("SELECT count(*) FROM work WHERE state NOT IN ('done','excluded')").fetchone()[0]
        material = self.store.db.execute("""SELECT count(*) FROM work WHERE state NOT IN ('done','excluded')
            AND kind IN ('document','asset','member')""").fetchone()[0]
        return {'state': 'blocked' if unresolved else 'observed', 'unresolved_count': unresolved,
                'unresolved_material': material}

    async def record_catalog(self, row, context, rows):
        for offset in range(0, len(rows), 100):
            with self.store.batch():
                for item in rows[offset:offset+100]:
                    signature = digest(item['metadata'])
                    initial = self.store.db.execute("""SELECT signature FROM catalog
                        WHERE phase='initial' AND language=? AND source=?""",
                        (context['language'], item['source'])).fetchone()
                    self.store.db.execute('INSERT OR REPLACE INTO catalog VALUES (?,?,?,?,?)',
                        (context['phase'], context['language'], item['source'], item['url'], signature))
                    known = self.observations.has(item['url'])
                    corrected = self.observations.catalogue_change(context['language'], item)
                    if item['url'] in self.planned or not known or corrected:
                        work = self.discover({'kind': 'document', 'url': item['url'], 'context': {
                            'source': item['source'], 'catalog_metadata': item['metadata']}},
                            row['id'], item['publisher_url'])
                        if not self.catchup and (not known or corrected):
                            self._catalogue_update(item, signature, work, known)
                        if context['phase'] == 'final' and initial and initial[0] != signature:
                            self.store.enqueue('document', item['url'], {'source': item['source'], 'change_evidence': signature},
                                               row['id'], 'closing_inventory_change',
                                               identity=digest(encoded([work, signature])))
            await asyncio.sleep(0)

    def _catalogue_update(self, item, signature, work, known):
        kind = 'metadata_changed' if known else 'new_act'
        identity = digest(encoded([item['url'], signature, self.day])) if known else digest(encoded([item['url'], 'new_act']))
        db = self.observations.db
        with db:
            db.execute('INSERT OR IGNORE INTO updates VALUES (?,?,?,?,?,?,?,?,?,?)', (
                identity, self.day, item['source'], f"https://lex.uz/docs/{item['source']}", time.time(),
                item.get('title') or f"Lex.uz · {item['source']}", None, kind, item['edition'],
                work,
            ))

    def schedule(self):
        if not self.store.setting('inventory_started'):
            self.catalogs('initial')
            self.store.enqueue('taxonomy', TAXONOMY_URL, {'scheme': 'LBC', 'provenance': 'publisher advanced-search selector'})
            # Include previously held records even if they disappear from a new catalogue.
            for url in sorted(self.planned):
                ref = document(url)
                self.store.enqueue('document', url, {'source': ref['source']})
            self.store.set('inventory_started', True)

    def finish(self, report):
        if report['state'] in ('paused_resource', 'interrupted'):
            return report
        saved = self.store.db.execute("SELECT phase,language,reported,count FROM partitions").fetchall()
        complete = {(row[0], row[1]) for row in saved if row[2] == row[3]} == {
            (phase, lang) for phase in ('initial', 'final') for lang in range(1, 5)
        }
        if not complete:
            result = {**report, 'state': 'inventory_incomplete'}
            with self.observations.db:
                self.observations.db.execute('UPDATE runs SET report=? WHERE day=?',
                                             (encoded({'state': result['state']}), self.day))
            return result
        now = time.time()
        db = self.observations.db
        with db:
            for (url,) in self.store.db.execute("SELECT DISTINCT url FROM work WHERE kind='document' AND attempts>0"):
                ref = document(url)
                if ref and not ref['edition']:
                    db.execute('INSERT OR REPLACE INTO attempted_sources VALUES (?,?)', (ref['url'], now))
            changed_attachments = set()
            corrected_records = set()
            for row in self.store.db.execute("""SELECT * FROM work WHERE kind IN ('asset','member','card')
                    AND raw_hash IS NOT NULL AND (state='done' OR
                    (kind IN ('asset','member') AND state='blocked' AND prepared_key IS NOT NULL))"""):
                context = json.loads(row['context'])
                identity = asset_identity({**dict(row), 'context': context})
                stored = db.execute('SELECT digest FROM attachments WHERE id=?', (identity,)).fetchone()
                if stored and stored[0] != row['raw_hash']:
                    changes = corrected_records if row['kind'] == 'card' else changed_attachments
                    changes.add((context.get('source'), context.get('edition')))
                db.execute('INSERT OR REPLACE INTO attachments VALUES (?,?)', (identity, row['raw_hash']))
            for row in self.store.db.execute("""SELECT * FROM work
                    WHERE kind='document' AND state='done' AND raw_hash IS NOT NULL
                    ORDER BY json_extract(receipt,'$.observed'), id"""):
                self.record_observation(row, changed_attachments, corrected_records)
            missing = db.execute("""SELECT count(*) FROM observations WHERE edition IS NULL AND checked <= ?""",
                                 (now - WEEK,)).fetchone()[0]
            summary = {
                'state': 'observed', 'acquisitionState': report['state'], 'day': self.day, 'catchup': bool(self.catchup),
                'overdue': missing, 'unresolved': report['unresolved_count'],
                'unresolvedMaterial': report['unresolved_material'], 'endedAt': now,
            }
            db.execute('DELETE FROM catalog')
            db.executemany('INSERT INTO catalog VALUES (?,?,?,?)',
                           self.store.db.execute("SELECT language,source,url,signature FROM catalog WHERE phase='final'"))
            db.execute('UPDATE runs SET completed=?,report=? WHERE day=?', (now, encoded(summary), self.day))
        atomic_json(self.store.root / 'maintenance.json', summary)
        return summary

    def record_observation(self, row, changed_attachments, corrected_records):
        receipt = json.loads(row['receipt'] or '{}')
        ref = document(row['url'])
        if not ref or receipt.get('status') != 200 or not receipt.get('observed') or not row['prepared_key']:
            return
        db = self.observations.db
        old = db.execute('SELECT checked,raw_hash,content_hash FROM observations WHERE url=?', (ref['url'],)).fetchone()
        observed = receipt['observed']
        if old and observed <= old[0]:
            return
        prepared = json.loads(self.store.read_object(row['prepared_key']))
        if prepared.get('publisher_alias') or str(prepared.get('source')) != ref['source']:
            return
        title = prepared.get('title') or f"Lex.uz · {ref['source']}"
        language = prepared.get('content_language') or next((unit.get('language') for unit in prepared.get('units', [])
                                                             if unit.get('language')), None)
        checked = db.execute('SELECT checked FROM baseline_sources WHERE source=?', (ref['source'],)).fetchone()
        content_hash = content_identity(prepared)
        update = None
        attachment_changed = (ref['source'], ref['edition']) in changed_attachments
        catalog_event = db.execute("SELECT 1 FROM updates WHERE day=? AND work=? AND kind='metadata_changed'",
                                   (self.day, row['id'])).fetchone()
        record_changed = (ref['source'], ref['edition']) in corrected_records or catalog_event is not None
        text_changed = old is not None and old[1] != row['raw_hash'] and old[2] != content_hash
        changed = not old or attachment_changed or text_changed or record_changed
        if changed:
            db.execute('INSERT OR IGNORE INTO changed_works VALUES (?,?)', (self.day, row['id']))
        if not old:
            held = db.execute('SELECT 1 FROM baseline_inventory WHERE source=?', (ref['source'],)).fetchone()
            editions = prepared.get('selected_edition', [])
            if not ref['edition'] and (not self.catchup or not held and (not editions or any(
                    edition_on_or_after(token, self.first_baseline or observed) for token in editions))):
                update = 'new_act'
            elif ref['edition'] and edition_on_or_after(ref['edition'], checked[0] if checked else self.first_baseline or observed):
                update = 'edition'
        elif attachment_changed or (old[2] is not None and text_changed):
            update = 'edition'
        elif record_changed and not catalog_event:
            update = 'metadata_changed'
        if update:
            identity = digest(encoded([ref['url'], 'new_act'])) if update == 'new_act' else (
                digest(encoded([ref['url'], update, content_hash, observed])))
            public_url = ref['url'].replace('/pdfs/', '/docs/', 1)
            db.execute('INSERT OR IGNORE INTO updates VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (identity, self.day, ref['source'], public_url, observed, title, language,
                        update, ref['edition'], row['id']))
        db.execute("""INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(url) DO UPDATE SET checked=excluded.checked,raw_hash=excluded.raw_hash,
             work=excluded.work,title=excluded.title,language=excluded.language,content_hash=excluded.content_hash""",
                   (ref['url'], ref['source'], ref['edition'], observed, row['raw_hash'], row['id'],
                    title, language, content_hash))


class MaintenanceStore(Store):
    def enqueue(self, kind, url, context=None, parent=None, locator='', identity=None):
        if identity is None and kind in ('document', 'card'):
            identity = digest(encoded([self.root.name, kind, url]))
        if kind == 'asset' and identity is not None and self.get(identity) is None:
            identity = digest(encoded([self.root.name, identity]))
        return super().enqueue(kind, url, context, parent, locator, identity)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--package-sha256', required=True)
    parser.add_argument('--model-root', type=Path, required=True)
    parser.add_argument('--tessdata', type=Path, required=True)
    parser.add_argument('--tesseract', default='tesseract')
    parser.add_argument('--ocr-device', choices=('cpu', 'cuda'), default='cpu')
    parser.add_argument('--repair-day', help='Resume the original captures for unresolved material from this day')
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'corpus_search'))
    from package import PreparedPackage
    with exclusive(args.root), closing(sqlite3.connect(args.root / 'maintenance.sqlite')) as db:
        observations = SourceObservations(db)
        observations.seed(PreparedPackage(args.package, args.package_sha256))
        if args.repair_day and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.repair_day):
            parser.error('Expected an acquisition day (YYYY-MM-DD)')
        run = (db.execute('SELECT day,started,catchup FROM runs WHERE day=? AND completed IS NOT NULL',
                          (args.repair_day,)).fetchone() if args.repair_day else observations.begin(time.time()))
        if not run:
            return
        day, _, catchup = run
        root = args.root / day
        with MaintenanceStore(root) as store:
            OCR_CONFIG['device'] = args.ocr_device
            runner = MaintenanceCoordinator(store, Media(root, args.model_root, args.tessdata, args.tesseract, device=args.ocr_device),
                                            observations, day, catchup)
            runner.schedule()

            def stop(*_):
                runner.status, runner.stop = 'interrupted', True

            signal.signal(signal.SIGINT, stop)
            signal.signal(signal.SIGTERM, stop)
            if args.repair_day:
                retry = [row[0] for row in store.db.execute("""SELECT id FROM work WHERE state IN ('blocked','deferred')
                    AND kind IN ('document','asset','member') ORDER BY id""")]
                if retry:
                    store.retry(retry, 'Retry retained material on the scheduled maintenance pass')
                report = asyncio.run(runner.run(bounded=True))
                if report['state'] not in ('paused_resource', 'interrupted'):
                    prior = json.loads(db.execute('SELECT report FROM runs WHERE day=?', (day,)).fetchone()[0])
                    prior.update(unresolved=report['unresolved_count'], unresolvedMaterial=report['unresolved_material'])
                    with db:
                        db.execute('UPDATE runs SET report=? WHERE day=?', (encoded(prior), day))
                        db.execute('INSERT OR REPLACE INTO material_repairs VALUES (?,?)', (day, time.time()))
                    report = prior
            else:
                report = runner.finish(asyncio.run(runner.run()))
            print(encoded(report), flush=True)
            if report['state'] != 'observed':
                raise SystemExit(1)


if __name__ == '__main__':
    main()
