"""Build and query a catalogue from the immutable prepared source package."""
import argparse
from collections import Counter
from contextlib import closing, contextmanager
import os
from pathlib import Path
import re
import sqlite3
import tempfile

from package import PreparedPackage, file_hash
from source_references import capture

PAGE_SIZE = 16


def build_catalog(package, destination):
    destination = Path(destination)
    if destination.exists():
        raise FileExistsError(destination)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        path = Path(temporary) / 'catalog.sqlite'
        with closing(sqlite3.connect(path)) as db, db:
            db.executescript("""
                CREATE TABLE generation(package_sha256 TEXT PRIMARY KEY);
                CREATE TABLE documents(work TEXT PRIMARY KEY, source TEXT NOT NULL, url TEXT NOT NULL,
                    edition TEXT, token TEXT, title TEXT, language TEXT, units INTEGER NOT NULL DEFAULT 0);
                CREATE INDEX document_editions ON documents(source, edition);
                CREATE TABLE attachments(work TEXT PRIMARY KEY, source TEXT NOT NULL, token TEXT,
                    url TEXT NOT NULL, language TEXT, units INTEGER NOT NULL DEFAULT 0);
                CREATE INDEX attached_sources ON attachments(source,token);
                CREATE TABLE projected_attachments(document TEXT,work TEXT,PRIMARY KEY(document,work));
                CREATE VIRTUAL TABLE titles USING fts5(title, source, tokenize='unicode61');
                CREATE TABLE categories(work TEXT, category TEXT, label TEXT,
                    PRIMARY KEY(category, work));
            """)
            db.execute('INSERT INTO generation VALUES (?)', (package.sha256,))
            for part in range(len(package.handoff['shards']['inventory'])):
                for _, row in package.records('inventory', part):
                    found = capture(row)
                    if found is None and isinstance(row.get('url'), str) and re.match(
                            r'https://(?:www\.)?lex\.uz/pdfs/-?\d+(?:\?|$)', row['url']):
                        found = capture({**row, 'url': row['url'].replace('/pdfs/', '/docs/', 1)})
                    if found:
                        (source, date), (work, url, token) = found
                        db.execute('INSERT INTO documents(work,source,url,edition,token) VALUES (?,?,?,?,?)',
                                   (work, source, url, date, token))
                    elif row.get('kind') in ('asset', 'member') and row.get('state') == 'done':
                        context = row.get('context') or {}
                        source = context.get('source')
                        if isinstance(source, str) and re.fullmatch(r'-?\d+', source):
                            db.execute('INSERT INTO attachments(work,source,token,url) VALUES (?,?,?,?)',
                                       (row['id'], source, context.get('edition'), row['url']))
            for part in range(len(package.handoff['shards']['prepared'])):
                for _, row in package.records('prepared', part):
                    units = row.get('units', [])
                    languages = Counter(unit['language'] for unit in units
                                        if unit.get('text') and isinstance(unit.get('language'), str))
                    language = languages.most_common(1)[0][0] if languages else None
                    title = row.get('title') or next(iter(row.get('header') or []), None)
                    if not isinstance(title, str) or not title.strip():
                        title = 'Lex.uz · ' + str(row.get('source', ''))
                    work = row['work']
                    updated = db.execute('UPDATE documents SET title=?,language=?,units=? WHERE work=? RETURNING rowid, source',
                                         (title.strip(), language, len(units), work)).fetchone()
                    if updated is None:
                        if language:
                            db.execute('UPDATE attachments SET units=?,language=? WHERE work=?',
                                       (len(units), language, work))
                        continue
                    db.execute('INSERT INTO titles(rowid,title,source) VALUES (?,?,?)', (updated[0], title, updated[1]))
                    db.executemany('INSERT INTO projected_attachments VALUES (?,?)',
                                   ((work, asset) for asset in row.get('projected_attachments', [])))
                    for assignment in row.get('assignments', []):
                        scheme, node, label = (assignment.get(field) for field in ('scheme', 'node', 'label'))
                        if scheme in ('LBC', 'LS', 'TERM') and re.fullmatch(r'\d{1,20}', str(node)) and isinstance(label, str) and label.strip():
                            db.execute('INSERT OR IGNORE INTO categories VALUES (?,?,?)',
                                       (work, f'{scheme}:{node}', label.strip()))
            db.execute("""UPDATE documents SET language=(SELECT a.language FROM attachments a
                WHERE a.source=documents.source AND a.token IS documents.token AND a.units>0
                ORDER BY a.url,a.work LIMIT 1) WHERE language IS NULL""")
            db.execute('DELETE FROM documents WHERE title IS NULL OR language IS NULL')
            db.execute('DELETE FROM categories WHERE work NOT IN (SELECT work FROM documents)')
            db.execute("""CREATE TABLE category_labels AS
                SELECT category,MIN(label) AS label FROM categories GROUP BY category""")
        os.link(path, destination)


class SourceBrowser:
    def __init__(self, path, digest, package_sha256):
        self.path = Path(path).resolve(strict=True)
        if file_hash(self.path) != digest:
            raise ValueError('source_catalog_integrity')
        with self.open() as reader:
            if reader.db.execute('SELECT package_sha256 FROM generation').fetchall() != [(package_sha256,)]:
                raise ValueError('source_catalog_generation')

    @contextmanager
    def open(self):
        with closing(sqlite3.connect(self.path.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
            yield SourceBrowserReader(db)


class SourceBrowserReader:
    def __init__(self, db):
        self.db = db

    def source(self, work):
        row = self.db.execute('SELECT work,title,url,edition,language FROM documents WHERE work=?', (work,)).fetchone()
        return dict(zip(('work', 'title', 'url', 'edition', 'language'), row)) if row else None

    def reading_plan(self, work, offset, limit):
        rows = self.db.execute("""SELECT work,units FROM (
            SELECT work,units,0 AS position,url FROM documents WHERE work=?
            UNION ALL SELECT a.work,a.units,1 AS position,a.url FROM attachments a JOIN documents d
            ON a.source=d.source AND a.token IS d.token WHERE d.work=? AND a.units>0 AND NOT EXISTS (
                SELECT 1 FROM projected_attachments p WHERE p.document=d.work AND p.work=a.work)
            ) ORDER BY position,url,work""", (work, work)).fetchall()
        total = sum(row[1] for row in rows)
        slices = []
        remaining = limit
        for key, size in rows:
            if offset >= size:
                offset -= size
                continue
            count = min(size - offset, remaining)
            slices.append((key, offset, count))
            remaining -= count
            if not remaining:
                break
            offset = 0
        return slices, total

    def search(self, query, language, category, page):
        if (not isinstance(query, str) or len(query) > 120
                or language not in ('', 'ru', 'uz', 'uz-Latn', 'uz-Cyrl', 'uzc', 'en')
                or not isinstance(category, str) or not re.fullmatch(r'(?:(?:LBC|LS|TERM):\d{1,20})?', category)
                or type(page) is not int or not 0 <= page <= 100000):
            raise ValueError('source_catalog_request')
        terms = re.findall(r'[^\W_]+', query, re.UNICODE)
        joins, predicates, values = [], [], []
        if terms:
            joins.append('JOIN titles ON titles.rowid=d.rowid')
            predicates.append('titles MATCH ?')
            values.append(' '.join(f'"{term}"*' for term in terms))
        if language:
            aliases = {'uz': 'uz-Latn', 'uzc': 'uz-Cyrl'}
            predicates.append('d.language IN (?,?)')
            values.extend((language, aliases.get(language, language)))
        if category:
            joins.append('JOIN categories c ON c.work=d.work')
            predicates.append('c.category=?')
            values.append(category)
        condition = ' WHERE ' + ' AND '.join(predicates) if predicates else ''
        ordering = 'rank, d.work' if terms else 'd.rowid'
        rows = self.db.execute(f'SELECT d.work,d.title,d.url,d.edition,d.language FROM documents d '
                               f'{" ".join(joins)}{condition} ORDER BY {ordering} LIMIT ? OFFSET ?',
                               (*values, PAGE_SIZE + 1, page * PAGE_SIZE)).fetchall()
        categories = self.db.execute('SELECT category,label FROM category_labels ORDER BY label').fetchall()
        return {'entries': [dict(zip(('work', 'title', 'url', 'edition', 'language'), row)) for row in rows[:PAGE_SIZE]],
                'categories': [{'id': key, 'label': label} for key, label in categories],
                'hasMore': len(rows) > PAGE_SIZE}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package')
    parser.add_argument('package_sha256')
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    build_catalog(PreparedPackage(args.package, args.package_sha256), args.destination)
    print(file_hash(args.destination))
