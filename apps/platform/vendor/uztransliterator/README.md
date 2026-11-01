# UzTransliterator

Unmodified runtime files and exception dictionaries from the MIT-licensed
UzTransliterator 2.0.2 Python wheel.

- Upstream: https://github.com/UlugbekSalaev/UzTransliterator
- Distribution: https://pypi.org/project/UzTransliterator/2.0.2/
- Wheel: `uztransliterator-2.0.2-py3-none-any.whl`
- SHA-256: `c4d7d5fe979e3aff13b269903f453c2668db6657c467ecef03f658030d522a72`

Retain LICENSE and both CSV dictionaries when updating or deploying. The query
adapter calls `transliterate(text, from_="lat", to="cyr")`. This is a search
variant, not a spelling validator; original Latin is also searched. No official
source text is passed through the converter.

Requires Python 3 (standard library only). The platform uses `python3` on Linux
and `python` on Windows. No package installation or network access is needed at
runtime. Keep this directory and `scripts/uzbek-query-transliterate.py` with the
platform release.
