"""Share context-free empty publisher card parses, retaining each observation."""
import copy
import json
import re

from .store import digest, encoded


EMPTY_FIELDS = ('assignments', 'chunks', 'classification_summary', 'discoveries',
                'header', 'issuers', 'metadata_fields', 'notices', 'publisher_fields',
                'relationships', 'selected_edition', 'tables', 'taxonomy', 'units', 'gaps')
EXPECTED_FIELDS = set(EMPTY_FIELDS) | {
    'classification_state', 'document_form', 'language', 'metadata_dimensions',
    'no_data', 'requested_edition', 'source', 'surface_text', 'title',
}


def classification_template(context, result):
    """Card2 absence summaries contain raw labels/evidence, not bound assignments."""
    if context.get('surface') != 'card2':
        return False
    if any(not isinstance(result.get(field, []), list) for field in
           ('publisher_fields', 'metadata_fields', 'classification_summary')):
        return False
    if not all(isinstance(value, str) for value in result.get('publisher_fields', [])):
        return False
    for field in result.get('metadata_fields', []):
        if (not isinstance(field, dict) or set(field) != {'label', 'values', 'evidence'}
                or not isinstance(field['label'], str) or not isinstance(field['evidence'], str)
                or not isinstance(field['values'], list)
                or not all(isinstance(value, str) for value in field['values'])):
            return False
    summaries = result.get('classification_summary', [])
    if not summaries:
        return False
    for summary in summaries:
        if (not isinstance(summary, dict) or set(summary) != {
                'scheme_label', 'scope', 'labels', 'codes', 'exact_provision_mapping', 'evidence'}
                or summary['codes'] != [] or summary['exact_provision_mapping'] is not False
                or summary['scope'] not in ('document', 'constituent_summary')
                or not isinstance(summary['scheme_label'], (str, type(None)))
                or not isinstance(summary['evidence'], str) or not isinstance(summary['labels'], list)
                or not all(isinstance(label, str) for label in summary['labels'])):
            return False
    return True


def template_key(row, parser_version):
    """Redirects, query variants and noncanonical card contexts never share."""
    if row['kind'] != 'card' or not row['raw_hash']:
        return None
    context = json.loads(row['context'])
    source, surface = context.get('source'), context.get('surface')
    if not isinstance(source, str) or not re.fullmatch(r'-?\d+', source):
        return None
    if surface not in ('card1', 'card2', 'basrev', 'revhis', 'correspondents', 'respondents'):
        return None
    canonical = f'https://lex.uz/actinfo/{surface}/{source}'
    if row['url'] != canonical:
        return None
    receipt = json.loads(row['receipt']) if row['receipt'] else {}
    if receipt.get('final_url') != canonical or receipt.get('status') != 200:
        return None
    return digest(encoded(['empty-card-template-v1', row['raw_hash'], surface, parser_version,
                           {key: value for key, value in context.items() if key != 'source'}]))


def make_template(row, result):
    """Accept only the known empty-card schema; unknown evidence is not erased."""
    if set(result) - EXPECTED_FIELDS:
        return None
    context = json.loads(row['context'])
    raw_fields = {'publisher_fields', 'metadata_fields', 'classification_summary'} if classification_template(context, result) else set()
    if any(result.get(field) for field in EMPTY_FIELDS if field not in raw_fields):
        return None
    if result.get('document_form') is not None or result.get('requested_edition') is not None:
        return None
    if result.get('metadata_dimensions') or result.get('classification_state') != 'not_observed':
        return None
    if not isinstance(result.get('no_data'), bool):
        return None
    if result.get('source') != context.get('source'):
        return None
    if result.get('title') == f'Lex.uz {result["source"]}':
        return None
    template = copy.deepcopy(result)
    template.pop('source')
    return template


def bind_template(template, row):
    result = copy.deepcopy(template)
    result['source'] = json.loads(row['context'])['source']
    return result
