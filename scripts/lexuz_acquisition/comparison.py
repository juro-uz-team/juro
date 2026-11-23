"""Preserve comparison controls as links to canonical legal editions."""
import re
from datetime import datetime
from urllib.parse import parse_qs, urlencode, urlsplit


def comparison_navigation(url):
    parts = urlsplit(url)
    match = re.fullmatch(r'/(?:ru/|uz/|uzc/|en/)?(docs|acts|pdfs)/(-?\d+)/?', parts.path)
    query = parse_qs(parts.query, keep_blank_values=True)
    if parts.hostname not in ('lex.uz', 'www.lex.uz') or not match:
        return None
    if 'ONDATE2' not in query and query.get('action') != ['compare']:
        return None
    # Unknown query semantics must remain visible through ordinary acquisition.
    if set(query) - {'ONDATE', 'ONDATE2', 'action'} or any(len(v) != 1 for v in query.values()):
        return None
    if 'action' in query and query['action'] != ['compare']:
        return None
    dates = [query.get('ONDATE', [None])[0], query.get('ONDATE2', [None])[0]]
    if any(date is not None and not re.fullmatch(r'\d{2}\.\d{2}\.\d{4}(?: 00)?', date) for date in dates):
        return None
    try:
        for date in dates:
            if date is not None:
                datetime.strptime(date.split(' ')[0], '%d.%m.%Y')
    except ValueError:
        return None
    source = match[2]
    base = 'https://lex.uz/' + ('pdfs/' if match[1] == 'pdfs' else 'docs/') + source
    discoveries = []
    for date in dict.fromkeys(dates):
        target = base + ('?' + urlencode({'ONDATE': date}) if date else '')
        discoveries.append({'kind': 'document', 'url': target,
                            'context': {'source': source, 'edition': date, 'url': target},
                            'locator': 'comparison:' + (date or 'current')})
    return {'units': [], 'chunks': [], 'gaps': [], 'discoveries': discoveries,
            'relationships': [{'kind': 'publisher_edition_comparison', 'url': url,
                               'source': source, 'editions': dates}],
            'scope_exclusion': {'reason': 'publisher_comparison_navigation', 'url': url,
                                'canonical_editions': [d['url'] for d in discoveries]}}
