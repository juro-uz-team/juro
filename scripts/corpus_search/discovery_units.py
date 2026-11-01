"""Resolve prepared source identities without changing retained source text."""
import re


def unit_ordinal_key(value):
    if type(value) is int and 0 <= value <= 2**53-1:
        return str(value)
    if isinstance(value,str) and 0 < len(value) <= 512:
        return value
    raise ValueError('discovery_catalog_units_invalid')


def segment_parent(ordinal):
    match=re.fullmatch(r'(.+):segment:(0|[1-9][0-9]{0,15})',ordinal)
    return (match[1],int(match[2])) if match else None


def resolve_unit(ordinal,by_ordinal,chunk,work):
    """Replay the producer's mixed-script segmentation over authenticated text.

    Chunk language attribution is already bound by its original and compact
    input hashes. The original parent's attribution remains unchanged. The
    derived segment retains an explicit source parent and exact character range.
    """
    if ordinal in by_ordinal:return by_ordinal[ordinal],None
    identity=segment_parent(ordinal)
    if identity is None:return None,None
    parent_key,index=identity
    parent=by_ordinal.get(parent_key)
    if parent is None or parent.get('language')!='mixed' or not isinstance(parent.get('text'),str):
        return None,None
    text=parent['text'];ranges=[];start=0;current=None
    for match in re.finditer(r'[A-Za-z]+|[А-Яа-яЁёЎўҚқҒғҲҳ]+',text):
        script='Latn' if match[0][0].isascii() else 'Cyrl'
        if current is not None and current!=script:
            ranges.append((start,match.start()));start=match.start()
        current=script
    ranges.append((start,len(text)))
    if index>=len(ranges):return None,None
    start,end=ranges[index]
    if start==end:return None,None
    derived={**parent,'ordinal':ordinal,'text':text[start:end],
        'language':chunk['language'],'script':chunk['script'],
        'mixed_parent':parent.get('locator'),
        'derivation':{'policy':'prepared-script-segment-v1','parent':work+':'+parent_key,
                      'start':start,'end':end}}
    return derived,(work+':'+parent_key,parent)
