"""Reversible metadata compaction; changes no legal/context string."""
import json, hashlib
VERSION='legal-embedding-input-compact-v2'
FIELDS={'articleNumber','articleTitle','documentTitle','documentType','hierarchy','language','officialText','schemaVersion','script'}

def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n'

def encode(original):
    d=json.loads(original)
    if not isinstance(d,dict) or set(d)!=FIELDS: raise ValueError('unknown_input_schema')
    if d['schemaVersion']!='legal-embedding-input-v1':raise ValueError('unknown_input_version')
    for k in FIELDS-{'hierarchy','articleTitle'}:
        if not isinstance(d[k],str):raise ValueError('invalid_string:'+k)
    if d['articleTitle'] is not None and not isinstance(d['articleTitle'],str):raise ValueError('invalid_article_title')
    if not isinstance(d['hierarchy'],list) or not all(isinstance(v,str) for v in d['hierarchy']):raise ValueError('invalid_hierarchy')
    if not d['officialText']:raise ValueError('empty_official_text')
    if canonical(d)!=original:raise ValueError('noncanonical_original')
    target=dict(d); locator=target.pop('articleNumber');target.pop('schemaVersion')
    if target['articleTitle'] is None:target.pop('articleTitle')
    if target['hierarchy']==[]:target.pop('hierarchy')
    text=canonical(target)
    restored=decode(text,locator)
    if restored!=original:raise ValueError('roundtrip_mismatch')
    return text,locator

def decode(text,locator):
    d=json.loads(text)
    if not isinstance(d,dict):raise ValueError('invalid_candidate_object')
    if not isinstance(locator,str):raise ValueError('invalid_locator')
    if canonical(d)!=text:raise ValueError('noncanonical_candidate')
    if 'articleNumber' in d or 'schemaVersion' in d:raise ValueError('reserved_field')
    if 'articleTitle' in d and (d['articleTitle'] is None or not isinstance(d['articleTitle'],str)):raise ValueError('invalid_compact_article_title')
    if 'hierarchy' in d and (not isinstance(d['hierarchy'],list) or not d['hierarchy'] or not all(isinstance(v,str) for v in d['hierarchy'])):raise ValueError('invalid_compact_hierarchy')
    for k in ['documentTitle','documentType','language','officialText','script']:
        if k not in d or not isinstance(d[k],str):raise ValueError('invalid_compact_string:'+k)
    if not d['officialText']:raise ValueError('empty_official_text')
    d.update(articleNumber=locator,schemaVersion='legal-embedding-input-v1')
    d.setdefault('articleTitle',None);d.setdefault('hierarchy',[])
    if set(d)!=FIELDS:raise ValueError('invalid_candidate_schema')
    return canonical(d)
