"""Evidence-preserving publisher parsing; navigation never defines legal scope."""
import re
from functools import lru_cache
import unicodedata
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup, Comment, NavigableString
from .comparison import comparison_navigation
from .html_queries import HtmlIndex

CARDS = ('card1', 'card2', 'basrev', 'revhis', 'correspondents', 'respondents')
TAXONOMY_URL = 'https://lex.uz/ru/ajax_methods_url?action=GetOkozTree&ucId=okoz_1'
SOURCE = re.compile(r'^/(?:ru/|uz/|uzc/|en/)?(?:docs|acts|pdfs)/(-?\d+)/?$')
POSITION = re.compile(r'^-?\d+$')
NON_BASIC_SCRIPT = re.compile(r'[^\x00-\x7f\u0400-\u052f]')
PARSER_VERSION = 'detached-publisher-v5'
PARSER_VERSIONS = {'document': PARSER_VERSION, 'card': 'publisher-card-v3', 'surface': 'publisher-surface-v2',
                   'detail': 'publisher-surface-v2', 'taxonomy': 'publisher-taxonomy-v1',
                   'catalog_search': 'publisher-catalog-v1', 'catalog_export': 'publisher-catalog-v1', 'catalog_page': 'publisher-catalog-v1'}


def soup_of(payload):
    return BeautifulSoup(payload.decode('utf-8-sig', errors='strict'), 'html.parser')


def may_have_pdf_viewer(soup):
    # A serialized /pdffile/ reference must contain this literal word in a
    # decoded text node, tag or attribute. Include comments and list-valued
    # attributes; inspecting raw response bytes alone would miss entities.
    for node in soup.descendants:
        if isinstance(node, NavigableString):
            if 'pdffile' in node:
                return True
        else:
            if 'pdffile' in node.name:
                return True
            for key, value in node.attrs.items():
                if 'pdffile' in key:
                    return True
                values = value if isinstance(value, (list, tuple)) else (value,)
                if any(isinstance(item, str) and 'pdffile' in item for item in values):
                    return True
    return False


def official_url(href, base):
    url = urlsplit(urljoin(base, href))
    if url.hostname not in ('lex.uz', 'www.lex.uz') or url.scheme not in ('http', 'https'):
        return None
    return urlunsplit(('https', 'lex.uz', url.path, url.query, ''))


def document(href, base='https://lex.uz'):
    url = official_url(href, base)
    if not url:
        return None
    parts = urlsplit(url)
    match = SOURCE.fullmatch(parts.path)
    query = parse_qs(parts.query)
    if not match or 'ONDATE2' in query or query.get('action') == ['compare']:
        return None
    token = query.get('ONDATE', [None])[0]
    return {'source': match[1], 'edition': token,
            'url': 'https://lex.uz/' + ('pdfs/' if '/pdfs/' in parts.path else 'docs/') + match[1] + ('?' + urlencode({'ONDATE': token}) if token else '')}


def publisher_navigation(url):
    parts = urlsplit(url)
    return (parts.hostname in ('lex.uz', 'www.lex.uz') and not parts.query
            and parts.path.rstrip('/') in ('', '/ru', '/uz', '/uzc', '/en'))


def supplementary_html_kind(url):
    parts = urlsplit(url)
    if parts.hostname not in ('lex.uz', 'www.lex.uz'):
        return None
    if re.fullmatch(r'/(?:ru/|uz/|uzc/|en/)?doc-passport/-?\d+/?', parts.path):
        return 'document'
    query = parse_qs(parts.query)
    if SOURCE.fullmatch(parts.path) and ('ONDATE2' in query or query.get('action') == ['compare']):
        return 'surface'
    return None


@lru_cache(maxsize=4096)
def supported_character(char):
    if not char.isalpha() or char in 'ʻʼˮµΩºª':
        return True
    if any(script in unicodedata.name(char, '') for script in ('LATIN', 'CYRILLIC')):
        return True
    compatible = unicodedata.normalize('NFKD', char)
    return compatible != char and all(supported_character(part) for part in compatible)


def language(text, declared=None):
    # Attribute each unit; mixed material is retained, never rejected as a whole law.
    cyrl = len(re.findall('[А-Яа-яЁёЎўҚқҒғҲҳ]', text))
    latin = len(re.findall('[A-Za-z]', text))
    # Isolated Greek letters occur as formula variables and publisher homoglyphs
    # inside otherwise supported prose. Greek words still require an unsupported
    # language route. This affects attribution only; source text stays verbatim.
    # Doubled particle symbols also occur in compounds such as αα-потенциалами.
    script_text = re.sub(r'(?<![\u0370-\u03ff])([α-ωΑ-Ω])\1(?=-[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ])', ' ', text)
    # Publisher Roman numerals II/III sometimes use Greek capital iota glyphs.
    script_text = re.sub(r'(?<!\w)Ι{2,3}(?!\w)', ' ', script_text)
    script_text = re.sub(r'(?<![\u0370-\u03ff])[\u0370-\u03ff](?![\u0370-\u03ff])', ' ', script_text)
    # ASCII and the Cyrillic blocks are already qualified by the same Unicode
    # predicate. Check only distinct remaining characters; frequencies above
    # still use the complete, unchanged text.
    if any(not supported_character(char) for char in set(NON_BASIC_SCRIPT.findall(script_text))):
        return {'language': 'unsupported', 'script': 'unsupported', 'evidence': 'unqualified_script'}
    if min(cyrl, latin) >= 20 and min(cyrl, latin) / max(1, cyrl+latin) >= .2:
        return {'language': 'mixed', 'script': 'mixed', 'evidence': {'cyrillic_letters': cyrl, 'latin_letters': latin}}
    if cyrl > latin:
        uzbek = bool(re.search('[ЎўҚқҒғҲҳ]', text)) or declared == 'uz-Cyrl'
        tag, script = ('uz-Cyrl' if uzbek else 'ru'), 'Cyrl'
    elif latin:
        uzbek = bool(re.search(r"[oOgG][‘’ʻʼ']|\b(?:qonun|qaror|modda|hujjat|yil)\b", text))
        tag, script = ('uz-Latn' if uzbek or declared == 'uz-Latn' else 'en'), 'Latn'
    else:
        tag = declared if declared in ('uz-Cyrl', 'uz-Latn', 'ru', 'en') else 'unknown'
        script = 'Cyrl' if tag in ('uz-Cyrl', 'ru') else 'Latn'
    return {'language': tag, 'script': script, 'evidence': {'cyrillic_letters': cyrl, 'latin_letters': latin, 'declared': declared}}


def refresh_rejected_language(result):
    """Reclassify rejected cached text after a supported-character remedy."""
    units = result.get('units', [])
    if result.get('language', {}).get('language') == 'unsupported' and units:
        result['language'] = language(' '.join(unit['text'] for unit in units))
        for item in result.get('discoveries', []):
            if item.get('context', {}).get('language') == 'unsupported':
                item['context']['language'] = result['language']['language']
    for unit in units:
        if unit.get('language') in ('unsupported', 'unknown'):
            unit.update(language(unit['text'], result.get('language', {}).get('language')))
    return attribute_letterless_units(result)


def attribute_letterless_units(result):
    """Use matching adjacent language evidence for standalone numbers/punctuation."""
    units = result.get('units', [])
    for index in range(1, len(units) - 1):
        unit, left, right = units[index], units[index - 1], units[index + 1]
        if unit['language'] != 'unknown' or any(char.isalpha() for char in unit['text']):
            continue
        tag = left['language']
        if tag in ('uz-Cyrl', 'uz-Latn', 'ru', 'en') and tag == right['language']:
            unit.update(language=tag, script=left['script'], evidence={
                'source': 'matching_adjacent_units', 'locators': [left['locator'], right['locator']]})
    return result


def script_segments(unit):
    if unit['language'] != 'mixed':
        return [unit]
    text, parts, start, current = unit['text'], [], 0, None
    for match in re.finditer(r'[A-Za-z]+|[А-Яа-яЁёЎўҚқҒғҲҳ]+', text):
        script = 'Latn' if match[0][0].isascii() else 'Cyrl'
        if current is not None and current != script:
            parts.append(text[start:match.start()])
            start = match.start()
        current = script
    parts.append(text[start:])
    return [{**unit, 'text': part, 'ordinal': f'{unit["ordinal"]}:segment:{index}',
             'mixed_parent': unit['locator'], **language(part)} for index, part in enumerate(parts) if part]


def catalog_form(payload):
    soup = soup_of(payload)
    match = re.search(r'найдено\s*:?\s*([\d\s]+)', soup.get_text(' ', strip=True), re.I)
    if not match:
        raise ValueError('catalog_reported_total_missing')
    form = {item['name']: item.get('value', '') for item in soup.select('form input[type=hidden][name]')}
    if not form:
        raise ValueError('catalog_export_form_missing')
    form.update(__EVENTTARGET='ucFoundActsControl$ctl00', __EVENTARGUMENT='')
    return int(re.sub(r'\s', '', match[1])), form


def catalog_rows(payload):
    soup = soup_of(payload)
    rows = {}
    for link in soup.select('a[href]'):
        ref = document(link['href'])
        if ref:
            row = link.find_parent('tr')
            rows[ref['source']] = {**ref, 'publisher_url': link['href'],
                                   'title': link.get_text(' ', strip=True),
                                   'metadata': row.get_text(' ', strip=True) if row else link.get_text(' ', strip=True)}
    return list(rows.values())


def catalog_page(payload):
    soup = soup_of(payload)
    reported, form = catalog_form(payload)
    next_link = soup.select_one('#ucFoundActsControl_LinkButton1')
    target = None
    if next_link and not next_link.get('disabled') and 'aspNetDisabled' not in next_link.get('class', []):
        match = re.search(r"__doPostBack\('([^']+)'\s*,\s*''\)", next_link.get('href', ''))
        if not match:
            raise ValueError('catalog_pagination_handler_unknown')
        target = match[1]
    if target:
        form['__EVENTTARGET'] = target
    return {'catalog': catalog_rows(payload), 'reported': reported, 'next_form': form if target else None}


def parse_html(payload, url, kind, context=None):
    context = context or {}
    soup = soup_of(payload)
    # These controls are UI, including when nested in numbered publisher text.
    for control in soup.find_all(onclick=True):
        if re.fullmatch(r'lx_(?:sf|pa|cl)\(-?\d+\);?', control.get('onclick', '')):
            control.decompose()
    tree = HtmlIndex(soup)
    markup, detail_route = None, None

    def serialized():
        nonlocal markup
        if markup is None:
            markup = str(soup)
        return markup

    ref = document(url)
    passport = supplementary_html_kind(url) == 'document'
    content = (tree.first_class('lx_lact_passport') if passport else tree.first_id('divCont'))
    comparison = supplementary_html_kind(url) == 'surface'
    if comparison and content is None:
        content = tree.first_name('table')
    gaps, discoveries, relationships, assignments, units = [], [], [], [], []
    source = ref['source'] if ref else context.get('source')
    if passport:
        source = urlsplit(url).path.rstrip('/').rsplit('/', 1)[-1]
    result = {'source': source, 'requested_edition': ref['edition'] if ref else None,
              'units': units, 'discoveries': discoveries, 'relationships': relationships,
              'assignments': assignments, 'gaps': gaps, 'tables': [], 'notices': []}
    if passport:
        result['representation'] = 'publisher_document_passport'
    result['taxonomy'] = []
    for node in tree.classes('stm_item'):
        if 'id' not in node.attrs:
            continue
        label = node.select_one(':scope > .stm_hdr label')
        parent = node.find_parent(class_='stm_item')
        name = label.get_text(' ', strip=True) if label else ''
        code = re.search(r'\b\d{2}(?:\.\d{2}){3}\b', name)
        result['taxonomy'].append({'scheme': 'LBC' if node['id'].startswith('okoz_') else context.get('scheme', 'publisher:' + node['id'].split('_')[0]),
            'node': node['id'].rsplit('_', 1)[-1], 'parent': parent['id'].rsplit('_', 1)[-1] if parent else None,
            'code': code[0] if code else None, 'label': name, 'publisher_locator': node['id'],
            'annotation': str(label), 'retired_annotation': bool(re.search('утрат|кучини йўқот|kuchini yo', name, re.I))})
    if kind == 'taxonomy':
        if not result['taxonomy']:
            gaps.append('taxonomy_tree_unrecognized')
        return result
    if not payload.strip():
        raise ValueError('unexplained_empty_response')
    page_title = tree.first_name('title')
    if tree.first_id('cf-challenge-running') or tree.first_class('g-recaptcha') or re.search(r'Just a moment|Access denied', page_title.get_text() if page_title else '', re.I):
        raise ValueError('publisher_challenge')
    if kind == 'document' and not content:
        # PDF wrappers can put the viewer outside divCont.
        if not re.search(r'/pdffile/|\.pdf|\.zip', serialized(), re.I):
            raise ValueError('legal_body_missing')
    selected = list(dict.fromkeys(re.sub(r'(\d{4})-(\d{2})$', r'\1 \2', x.get_text(' ', strip=True)) for x in tree.classes('lx_date_selected')))
    result['selected_edition'] = selected
    if ref and ref['edition']:
        token = ref['edition']
        warning = tree.first_class('act_warning')
        evidence = warning.get_text(' ', strip=True) if warning else ''
        exact = len(selected) == 1 and selected[0] == token
        alias = len(selected) == 1 and token == selected[0] + ' 00'
        banner = not selected and token in evidence
        if not (exact or alias or banner):
            gaps.append('edition_identity_unverified')
        if alias:
            result['edition_alias'] = {'requested': token, 'displayed': selected[0], 'evidence': str(tree.first_class('lx_date_selected'))}
    title = tree.first_class('ACT_TITLE', 'act_title')
    if title is not None:
        title = title.find(id=POSITION) or title
    else:
        title = page_title
    result['title'] = title.get_text(' ', strip=True) if title else f'Lex.uz {source}'
    form_node = tree.first_class('ACT_FORM')
    result['document_form'] = form_node.get_text(' ', strip=True) if form_node else None
    result['header'] = [x.get_text(' ', strip=True) for x in tree.tags if x.get('id') == 'doc_header' or 'docHeader' in x.get('class', [])]
    result['publisher_fields'] = [x.get_text(' ', strip=True) for x in tree.names['tr']] if kind != 'document' else []
    result['metadata_fields'] = [{'label': cells[0].get_text(' ', strip=True), 'values': [c.get_text(' ', strip=True) for c in cells[1:]],
                                  'evidence': str(row)} for row in tree.names['tr']
                                 if len(cells := row.find_all(['td', 'th'], recursive=False)) >= 2] if kind != 'document' else []
    dimension_labels = {'Вид акта': 'kind', 'Форма акта': 'form', 'Язык акта': 'declared_language',
        'Статус акта': 'status', 'Дата вступления в силу': 'effective_date', 'Дата прекращения действия': 'ended_date',
        'Ҳужжат ҳолати': 'status', 'Кучга кириш санаси': 'effective_date', 'Кучини йўқотган санаси': 'ended_date'}
    result['metadata_dimensions'] = {}
    for label in tree.classes('lbl'):
        if label.name != 'td':
            continue
        value = label.find_next_sibling('td')
        if value is not None:
            name = label.get_text(' ', strip=True)
            dimension = dimension_labels.get(name, 'publisher:' + name)
            result['metadata_dimensions'].setdefault(dimension, []).append({'label': name, 'value': value.get_text(' ', strip=True)})
    columns = [col.get('id') for col in tree.descendants('bodyTab', 'col')]
    result['issuers'] = [{column: cell.get_text(' ', strip=True) for column, cell in zip(columns, row.select(':scope > td'))}
                         for row in tree.children('bodyTBody', 'tr')]
    result['classification_summary'] = []
    scheme = None
    for row in tree.children('idxTBody', 'tr'):
        heading = row.select_one('.otmGrpRow')
        if heading:
            scheme = heading.get_text(' ', strip=True)
            continue
        for index, cell in enumerate(row.select(':scope > td.otmVal')):
            result['classification_summary'].append({'scheme_label': scheme, 'scope': 'document' if index == 0 else 'constituent_summary',
                'labels': cell.get_text('\n', strip=True).splitlines(), 'codes': re.findall(r'\b\d{2}(?:\.\d{2}){3}\b', cell.get_text()),
                'exact_provision_mapping': False, 'evidence': str(cell)})
    html_node = tree.first_name('html')
    html_lang = html_node.get('lang', '') if html_node else ''
    declared = 'uz-Cyrl' if 'Cyrl' in html_lang else None  # UI locale alone is not language evidence.
    body_text = content.get_text(' ', strip=True) if content else ''
    viewer_title_hint = kind == 'document' and not body_text and bool(re.search(r'PDFObject\.embed|/pdffile/', serialized()))
    result['language'] = language(result['title'] if viewer_title_hint else body_text, context.get('language'))
    if viewer_title_hint:
        result['language']['evidence_source'] = 'publisher_title_hint'
    seen = set()

    def discover(href, locator, forced=None, extra=None):
        target = official_url(href, url)
        comparison_link = comparison_navigation(target) if target else None
        if comparison_link:
            relationships.extend({**item, 'locator': locator} for item in comparison_link['relationships'])
            for edition in comparison_link['discoveries']:
                discover(edition['url'], locator)
            return
        if target and publisher_navigation(target):
            relationships.append({'kind': 'publisher_navigation', 'url': target, 'locator': locator})
            return
        linked = document(href, url)
        if linked:
            target, target_kind = linked['url'], 'document'
            detail = linked
        elif target:
            path = urlsplit(target).path
            target_kind = forced or ('surface' if re.match(r'/(?:actinfo|court)/', path) else 'asset')
            detail = {'source': source, 'language': result['language']['language'], 'title': result['title'],
                      'document_form': result['document_form'], 'edition': result['requested_edition']}
        else:
            relationships.append({'kind': 'external_reference', 'url': urljoin(url, href), 'locator': locator})
            return
        key = (target, locator)
        if key not in seen:
            seen.add(key)
            discoveries.append({'kind': target_kind, 'url': target, 'context': {**detail, **(extra or {})}, 'locator': locator})

    for node in tree.tags:
        if not (any(key in node.attrs for key in ('href', 'onclick', 'src', 'data', 'srcset')) or (node.name == 'param' and 'value' in node.attrs)):
            continue
        if any(set(parent.get('class', [])) & {'lx_elem_toolbar', 'lx_elem_controls'} for parent in [node, *node.parents] if getattr(parent, 'attrs', None)):
            continue
        if node.name == 'link':
            continue
        locator = node.get('id') or (node.find_parent(id=POSITION).get('id') if node.find_parent(id=POSITION) else '')
        in_body = content is not None and (node is content or content in node.parents)
        href = node.get('href', '')
        if href and document(href, url):
            discover(href, locator)
            relationships.append({'kind': 'publisher_link', 'href': href, 'locator': locator, 'label': node.get_text(' ', strip=True)})
        elif node.name == 'a' and href and (in_body or (kind != 'document' and not comparison)) and not href.startswith(('#', 'javascript:', 'mailto:')):
            discover(href, locator, 'surface' if kind != 'document' and '/ajax_methods_url' in href else None)
        handler = node.get('onclick', '') or (href if href.startswith('javascript:') else '')
        for target in re.findall(r'lxOpenUrl\([\'"]([^\'"]+)', handler):
            discover(target, locator)
        if 'lx_date_link' in node.get('class', []) and not re.search(r'lxOpenUrl\(', handler) and not document(href, url):
            gaps.append('edition_control_unrecognized')
        for target in re.findall(r'openAct\([\'\"]?(-?\d+)', handler):
            discover('/docs/' + target, locator)
        pair = re.search(r"getCorrespondentList\(['\"](-?\d+)['\"]\s*,\s*['\"](-?\d+)", handler)
        if pair:
            for target in pair.groups():
                discover('/docs/' + target, locator)
            relationships.append({'kind': 'publisher_pair', 'surface': url, 'arguments': list(pair.groups()),
                                  'publisher_parameters': {'p_target_lact_id': pair[1], 'p_source_lact_id': pair[2]},
                                  'label': node.get_text(' ', strip=True), 'row': (node.find_parent('tr') or node.parent).get_text(' ', strip=True), 'locator': locator})
            if detail_route is None:
                detail_route = (re.search(r'action=(pl(?:correspondents|respondents)_target)', serialized()),
                                re.search(r'''url\s*:\s*['"]([^'"]*/ajax_methods_url\?)['"]\s*\+\s*action''', serialized()))
            detail_action, detail_endpoint = detail_route
            if detail_action and detail_endpoint:
                query = urlencode({'action': detail_action[1], 'p_target_lact_id': pair[1], 'p_source_lact_id': pair[2]})
                discover(detail_endpoint[1] + query, locator, 'detail', {'referer': url})
            else:
                gaps.append('relationship_detail_handler_unresolved')
        postback = re.search(r"__doPostBack\('([^']*)'\s*,\s*'([^']*)'\)", handler or href)
        if postback and kind != 'document':
            form = {i['name']: i.get('value', '') for i in soup.select('form input[name]')}
            if form:
                form.update(__EVENTTARGET=postback[1], __EVENTARGUMENT=postback[2])
                discover(url, locator + ':postback:' + postback[2], 'surface', {'form': form})
            else:
                gaps.append('publisher_pagination_form_missing')
        if in_body or node.name in ('embed', 'object', 'param', 'iframe'):
            for name in ('src', 'data', 'value'):
                asset = node.get(name, '')
                if asset.startswith('/img/') or asset == '/image/favicon.gif':
                    continue  # Publisher toolbar icons, not substantive /files/ media.
                if asset and (node.name != 'param' or node.get('name', '').lower() in ('src', 'movie', 'file')):
                    discover(asset, locator)
            for asset in node.get('srcset', '').split(','):
                if asset.strip():
                    discover(asset.strip().split()[0], locator)
    # PDFObject / viewer configuration is data, never execute publisher scripts.
    if markup is not None or may_have_pdf_viewer(soup):
        for asset in re.findall(r"['\"]([^'\"]*/pdffile/-?\d+[^'\"]*)['\"]", serialized()):
            discover(asset, 'pdf-viewer')
    for scope in tree.tags:
        if not re.search(r'^on(?:LBC|LS|TERM)-?\d+$', scope.get('id', '')):
            continue
        for node in scope.find_all(id=re.compile(r'^(LBC|LS|TERM)\d+$')):
            match = re.fullmatch(r'(LBC|LS|TERM)(\d+)', node['id'])
            position = re.sub(r'^on(?:LBC|LS|TERM)', '', scope['id'])
            assignments.append({'scheme': match[1], 'node': match[2], 'label': node.get_text(' ', strip=True),
                                'scope': 'document' if position == source else position, 'inherited': False,
                                'path_labels': [label.strip(' ]') for label in (node.select_one('.iorVal') or node).get_text(' ', strip=True).split(' / ')],
                                'parent': None, 'parent_state': 'not_supplied_in_assignment',
                                'historical_validity': 'not_established', 'evidence': str(node)})
    result['classification_state'] = 'published' if assignments else 'not_observed'
    if kind != 'document':
        result['no_data'] = tree.first_id('result_not_found') is not None
        # Relationship lists are server-rendered into d100. An empty known list
        # is distinct from the unexplained empty response to a pair-detail call.
        relation_list = soup.select_one('#actBody #d100')
        relation_form = soup.select_one('form[action]')
        if (kind == 'card' and re.search(r'/actinfo/(?:correspondents|respondents)/', url)
                and relation_form and re.search(r'/(?:Correspondents|Respondents)\.aspx\?', relation_form.get('action', ''), re.I)
                and relation_list is not None and not relation_list.get_text(strip=True)
                and not relation_list.find(['table', 'a', 'img', 'iframe'])
                and soup.select_one('#actBody h4')):
            result['no_data'] = True
            result['no_data_evidence'] = {'kind': 'empty_publisher_relationship_list', 'html': str(relation_list)}
        result['surface_text'] = soup.get_text(' ', strip=True)
        if not result['surface_text']:
            gaps.append('unexplained_empty_card')
        if not result['no_data'] and not tree.first_name('table') and not discoveries and not result['taxonomy']:
            gaps.append('publisher_surface_shape_unrecognized')
        return result
    if content:
        # The index predates body cleanup, so notice evidence stays exact. Test
        # ancestry by identity: BeautifulSoup equality compares entire subtrees.
        notices = [node for node in tree.classes('lx_text_on_other_lang', 'lx_next_ver')
                   if any(parent is content for parent in node.parents)]
        for notice in notices:
            result['notices'].append({'text': notice.get_text(' ', strip=True), 'html': str(notice)})
        result['availability'] = ('publisher_language_unavailable'
                                  if any('lx_text_on_other_lang' in node.get('class', []) for node in notices)
                                  else 'published')
        hierarchy = []
        # Keep every non-UI text node, including hidden publisher positions. Group
        # by nearest position/block; nested positions and tables never lose lines.
        removable = [node for node in content.find_all(True)
                     if node.name in ('script', 'style') or (not passport and node.name == 'button')
                     or bool(set(node.get('class', [])) & {'lx_elem_toolbar', 'lx_elem_controls', 'dropdown-menu'})
                     or node.get('id', '').startswith(('onLBC', 'onLS', 'onTERM'))]
        for node in removable:
            node.decompose()
        for index, table in enumerate(content.find_all('table')):
            result['tables'].append({'ordinal': index, 'locator': table.get('id'), 'html': str(table),
                'rows': [[{'text': cell.get_text(' ', strip=True), 'rowspan': cell.get('rowspan', '1'),
                          'colspan': cell.get('colspan', '1')} for cell in row.find_all(['td', 'th'], recursive=False)]
                         for row in table.find_all('tr') if row.find_parent('table') is table]})
        last_key = None
        locations = {}
        for node in content.descendants:
            if not isinstance(node, NavigableString):
                continue
            if isinstance(node, Comment) or not node.strip():
                continue
            parent = node.parent
            location = locations.get(id(parent))
            if location is None:
                anchor = parent if POSITION.fullmatch(parent.get('id', '')) else next(
                    (candidate for candidate in parent.parents if POSITION.search(candidate.get('id', ''))), None)
                block = anchor or next((candidate for candidate in parent.parents
                                        if candidate.name in ('p', 'tr', 'div')), None) or parent
                location = locations[id(parent)] = (anchor, block)
            anchor, block = location
            key = id(block)
            value = str(node).strip()
            if key != last_key:
                wrapper = block.find_parent(class_=re.compile(r'HEADER|CHAPTER|SECTION|ANNEX'))
                classes = ' '.join((wrapper or block).get('class', []))
                if re.search('HEADER|CHAPTER|SECTION|ANNEX', classes) and not re.search('ACT_TITLE', classes):
                    heading = block.get_text(' ', strip=True)
                    level = 0 if re.search(r'қисм|часть|part|qism', heading, re.I) else 1 if re.search(r'бўлим|раздел|section|bo‘lim', heading, re.I) else 2
                    hierarchy = hierarchy[:level] + [heading]
                units.append({'locator': anchor.get('id') if anchor else f'block:{len(units)}', 'ordinal': len(units),
                              'text': value, 'hierarchy': list(hierarchy),
                              'method': 'publisher_passport_html' if passport else 'publisher_html'})
            else:
                units[-1]['text'] += ' ' + value
            last_key = key
        for unit in units:
            unit.update(language(unit['text'], result['language']['language']))
        by_locator = {unit['locator']: unit for unit in units}
        for item in discoveries:
            if item['kind'] == 'asset':
                item['context']['hierarchy'] = by_locator.get(item['locator'], {}).get('hierarchy', [])
    body_assets = any(item['kind'] == 'asset' for item in discoveries)
    if not units and not body_assets and result.get('availability') != 'publisher_language_unavailable':
        gaps.append('empty_legal_content')
    return attribute_letterless_units(result)
