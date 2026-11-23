"""Run the durable nightly acquisition, embedding, and release build."""
import argparse
from contextlib import closing
from itertools import chain
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import sys
import time

from .maintenance_package import cumulative_works, receipt, write_package
from .runner import exclusive
from .store import atomic_json, digest, encoded

REPOSITORY = Path(__file__).resolve().parents[2]


def command(module, *args):
    subprocess.run([sys.executable, '-m', module, *map(str, args)], cwd=REPOSITORY, check=True)


def serve_candidate(candidate, pin, settings, target):
    if (target/'activated.json').exists() or not settings:
        return
    if sys.platform != 'linux' or os.geteuid() == 0:
        raise ValueError('maintenance_serving_configuration')
    environment = Path(settings['workerEnvironment']).resolve(strict=True)
    if not environment.is_file():
        raise ValueError('maintenance_serving_configuration')
    if receipt(candidate.parent, candidate)['sha256'] != pin:
        raise ValueError('maintenance_candidate_integrity')
    spec = json.loads(candidate.read_bytes())
    bindings = target/'workers.json'
    if not bindings.exists():
        # Each immutable source listener retains a distinct address for saved Citations.
        with socket.socket() as current, socket.socket() as history, socket.socket() as sources:
            for listener in (current, history, sources):
                listener.bind(('127.0.0.1', 0))
            atomic_json(bindings, {name: listener.getsockname()[1] for name, listener in
                                  zip(('current', 'history', 'sources'), (current, history, sources))})
    ports = json.loads(bindings.read_bytes())
    if set(ports) != {'current', 'history', 'sources'} or len(set(ports.values())) != 3 or any(
            type(port) is not int or not 1024 < port < 65536 for port in ports.values()):
        raise ValueError('maintenance_serving_ports')
    for name, port in ports.items():
        unit = target/f'juro-corpus-{target.name}-{name}.service'
        if not unit.exists():
            path = REPOSITORY/'scripts/corpus_search'/('source_worker.py' if name == 'sources' else 'worker.py')
            args = [sys.executable, path, spec[name]['path'], spec[name]['sha256'], port]
            if name != 'sources':
                projection = json.loads(Path(spec['sources']['path']).read_bytes())['sourceProjection']
                args.extend(['--source-projection', projection['path'], '--source-projection-sha256', projection['sha256']])
            command_line = ' '.join(json.dumps(str(arg).replace('%', '%%')) for arg in args)
            unit.write_text(f'[Unit]\nDescription=JURO Lex.uz corpus {name}\nAfter=network-online.target\n'
                f'[Service]\nWorkingDirectory={REPOSITORY}\nEnvironmentFile={environment}\n'
                f'Environment="PYTHONPATH={REPOSITORY}"\n'
                f'ExecStart=:{command_line}\nRestart=on-failure\n'
                '[Install]\nWantedBy=default.target\n', encoding='utf8')
        subprocess.run(['systemctl', '--user', 'enable', '--now', str(unit)], check=True)
    deadline = time.monotonic() + 240
    for port in ports.values():
        while True:
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=1):
                    break
            except OSError:
                if time.monotonic() >= deadline:
                    raise ValueError('maintenance_source_worker_unavailable')
                time.sleep(2)
    activate = ['node', '--import', 'tsx', 'scripts/activate-lexuz-maintenance.mts',
                str(candidate), pin, settings['runtimeConfig'],
                *(f'http://127.0.0.1:{ports[name]}' for name in ('current', 'history', 'sources'))]
    generation = subprocess.run(activate, cwd=REPOSITORY/'apps/platform', stdout=subprocess.PIPE,
                                text=True, check=True).stdout.strip()
    if not re.fullmatch('[a-f0-9]{64}', generation):
        raise ValueError('maintenance_activation_response')
    atomic_json(target/'activated.json', {'generation': generation, 'release': pin})


def record_handoff(root, target):
    if not (target/'activated.json').exists():
        return
    provenance = json.loads((target/'package/provenance/handoff-manifest.json').read_bytes())
    if provenance['unresolved_works']:
        return
    with closing(sqlite3.connect(root/'maintenance.sqlite')) as journal, journal:
        last = journal.execute("""SELECT report FROM runs WHERE completed IS NOT NULL ORDER BY day DESC LIMIT 1""").fetchone()
        report = json.loads(last[0]) if last else {}
        pending = journal.execute("""SELECT 1 FROM runs WHERE catchup=1 AND completed IS NOT NULL
            AND json_extract(report,'$.unresolvedMaterial')>0 LIMIT 1""").fetchone()
        if report.get('overdue') == 0 and report.get('unresolvedMaterial') == 0 and not pending:
            journal.execute('INSERT OR IGNORE INTO catchup_handoff VALUES (1,?)', (time.time(),))


def run(config):
    root = Path(config['root']).resolve()
    baseline = config['baseline']
    vectors = config['baseVectors']
    models = config['ocr']
    root.mkdir(parents=True, exist_ok=True)
    with exclusive(root/'nightly'):
        command('scripts.lexuz_acquisition.maintenance',
                '--root', root, '--package', baseline['path'], '--package-sha256', baseline['sha256'],
                '--model-root', models['models'], '--tessdata', models['tessdata'], '--tesseract', models['tesseract'],
                '--ocr-device', models.get('device', 'cpu'))
        journal_path = (root/'maintenance.sqlite').as_uri()
        with closing(sqlite3.connect(journal_path+'?mode=ro', uri=True)) as journal:
            repair = journal.execute("""SELECT r.day FROM runs r LEFT JOIN material_repairs m ON m.day=r.day
                WHERE r.completed IS NOT NULL AND json_extract(r.report,'$.unresolvedMaterial')>0
                  AND r.day < (SELECT max(day) FROM runs WHERE completed IS NOT NULL)
                  AND coalesce(m.attempted,0) <= ? ORDER BY coalesce(m.attempted,0),r.day LIMIT 1""",
                (time.time() - 86400,)).fetchone()
        if repair:
            command('scripts.lexuz_acquisition.maintenance', '--root', root, '--package', baseline['path'],
                    '--package-sha256', baseline['sha256'], '--model-root', models['models'],
                    '--tessdata', models['tessdata'], '--tesseract', models['tesseract'],
                    '--ocr-device', models.get('device', 'cpu'), '--repair-day', repair[0])
        with closing(sqlite3.connect(journal_path+'?mode=ro', uri=True)) as journal:
            runs = journal.execute('SELECT day,completed FROM runs WHERE completed IS NOT NULL ORDER BY day').fetchall()
            if not runs:
                return
            added = journal.execute('SELECT day,work FROM changed_works ORDER BY day,work').fetchall()
            if not added:
                return
            days = sorted({day for day, _ in added})
            receipts = [(day, (root/day/'manifest.sqlite').stat().st_mtime_ns) for day in days]
            identity = digest(encoded(['attachment-origin-url-v1', baseline['sha256'], added, receipts]))[:32]
            target = root/'releases'/identity
            target.mkdir(parents=True, exist_ok=True)
            ready = target/'ready-for-qualification.json'
            if ready.exists():
                selected = json.loads(ready.read_bytes())
                serve_candidate(Path(selected['release']), selected['sha256'], config.get('serving'), target)
                record_handoff(root, target)
                return
            package = target/'package'
            if not package.exists():
                unresolved = []
                rows = cumulative_works(root, journal, unresolved)
                first = next(rows, None)
                if first is None:
                    atomic_json(target/'source-status.json', {'prepared': 0, 'unresolved': unresolved})
                    return
                try:
                    write_package(None, chain([first], rows), unresolved, package,
                        {'build_id': identity, 'baseline_sha256': baseline['sha256'],
                         'last_observed_run': runs[-1][0]})
                finally:
                    rows.close()
        package_pin = receipt(package, package/'package-manifest.json')['sha256']
        token_limit = config.get('dailyNewInputTokens')
        budget = ['--daily-new-input-tokens', token_limit] if token_limit is not None else []
        command('scripts.lexuz_acquisition.maintenance_vectors', package, package_pin, target/'vectors',
                '--cache', root/'embedding-cache', '--base', vectors['path'], '--base-sha256', vectors['sha256'],
                '--identities', vectors['identitiesPath'], '--identities-sha256', vectors['identitiesSha256'],
                *budget)
        vector_pin = receipt(target/'vectors', target/'vectors/completion.json')['sha256']
        # A failed build can leave unselected material for diagnosis. Each
        # subsequent attempt builds to a different immutable worker path.
        attempt = target/f"build-{1 + len(list(target.glob('build-*'))):03d}"
        subprocess.run([sys.executable, str(REPOSITORY/'scripts/corpus_search/maintenance_release.py'), str(package),
                        package_pin, str(target/'vectors'), vector_pin, config['releaseTemplate'], str(attempt),
                        '--reader-role', config['readerRole']], cwd=REPOSITORY, check=True)
        candidate = attempt/'release-candidate.json'
        candidate_pin = receipt(attempt, candidate)['sha256']
        atomic_json(target/'ready-for-qualification.json', {'release': str(candidate), 'sha256': candidate_pin})
        serve_candidate(candidate, candidate_pin, config.get('serving'), target)
        record_handoff(root, target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    args = parser.parse_args()
    run(json.loads(args.config.read_bytes()))
