"""Bounded stdin/stdout bridge to the pinned, unmodified query transliterator."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "vendor/uztransliterator"))
from UzTransliterator import UzTransliterator

raw = sys.stdin.buffer.read(32769)
if len(raw) > 32768:
    raise ValueError("query_input_bound")
queries = json.loads(raw)
if (not isinstance(queries, list) or not 1 <= len(queries) <= 4
        or any(not isinstance(q, str) or not 1 <= len(q) <= 2000 for q in queries)):
    raise ValueError("query_input_invalid")
converter = UzTransliterator()
result = [converter.transliterate(query, from_="lat", to="cyr") for query in queries]
sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
