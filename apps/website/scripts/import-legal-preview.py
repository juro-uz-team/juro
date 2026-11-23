#!/usr/bin/env python3
"""Create the test-only public legal corpus from the supplied Web-Ready ZIP.

The source package stays outside the repository.  This importer intentionally
keeps only documents marked public, resolves only confirmed operational values,
and omits individual Markdown blocks that require an unconfirmed legal value.
It is a preview safeguard: it must never emit a literal {{PLACEHOLDER}}.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path


ROOT = "JURO_Website_Legal_Package_Web_Ready"
TOKEN = re.compile(r"\{\{[A-Z0-9_]+\}\}")

CONFIRMED = {
    "{{DOMAIN}}": "juro.uz",
    "{{APP_DOMAIN}}": "app.juro.uz",
    "{{PRIVACY_EMAIL}}": "admin@juro.uz",
    "{{LEGAL_EMAIL}}": "admin@juro.uz",
    "{{SUPPORT_EMAIL}}": "admin@juro.uz",
}


def front_matter(source: str) -> tuple[dict[str, str], str]:
    if not source.startswith("---\n"):
        raise ValueError("Each legal document must begin with front matter")
    _, raw, body = source.split("---\n", 2)
    parsed: dict[str, str] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        parsed[key.strip()] = value.strip().strip('"')
    return parsed, body.strip()


def resolved(text: str) -> str | None:
    tokens = TOKEN.findall(text)
    if any(token not in CONFIRMED for token in tokens):
        return None
    for token in tokens:
        text = text.replace(token, CONFIRMED[token])
    return text.strip()


def parse_table(lines: list[str]) -> dict[str, object] | None:
    rows: list[list[str]] = []
    for index, line in enumerate(lines):
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if index == 1 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        if any(resolved(cell) is None for cell in cells):
            continue
        rows.append([resolved(cell) or "" for cell in cells])
    if len(rows) < 2:
        return None
    return {"type": "table", "headers": rows[0], "rows": rows[1:]}


def flush(lines: list[str], blocks: list[dict[str, object]]) -> None:
    if not lines:
        return
    if all(line.startswith("|") for line in lines):
        table = parse_table(lines)
        if table:
            blocks.append(table)
        return

    bullet = all(re.match(r"^[-*] ", line) for line in lines)
    ordered = all(re.match(r"^\d+[.)] ", line) for line in lines)
    if bullet or ordered:
        items = []
        for line in lines:
            item = re.sub(r"^(?:[-*]|\d+[.)])\s+", "", line)
            value = resolved(item)
            if value:
                items.append(value)
        if items:
            blocks.append({"type": "ordered_list" if ordered else "bullet_list", "items": items})
        return

    value = resolved(" ".join(line.strip() for line in lines))
    if value:
        blocks.append({"type": "paragraph", "text": value})


def blocks_and_sections(body: str) -> tuple[str, list[dict[str, object]]]:
    title = ""
    sections: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    pending: list[str] = []

    def push_pending() -> None:
        nonlocal pending
        if current is not None:
            flush(pending, current["blocks"])  # type: ignore[arg-type]
        pending = []

    for raw in body.splitlines():
        line = raw.strip()
        if line.startswith("# "):
            title = line[2:].strip()
            continue
        if line.startswith("## "):
            push_pending()
            current = {"heading": line[3:].strip(), "blocks": []}
            sections.append(current)
            continue
        if line.startswith("### "):
            push_pending()
            if current is not None:
                current["blocks"].append({"type": "heading3", "text": line[4:].strip()})  # type: ignore[index]
            continue
        if not line:
            push_pending()
            continue
        pending.append(line)
    push_pending()

    usable = [section for section in sections if section["blocks"]]
    return title, usable


def description(sections: list[dict[str, object]], fallback: str) -> str:
    for section in sections:
        for block in section["blocks"]:  # type: ignore[index]
            if block["type"] == "paragraph":
                return str(block["text"])
    return fallback


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: import-legal-preview.py INPUT.zip OUTPUT.json")
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    package_hash = hashlib.sha256(input_path.read_bytes()).hexdigest()
    with zipfile.ZipFile(input_path) as archive:
        manifest = json.loads(archive.read(f"{ROOT}/manifest.json"))
        documents = []
        for item in manifest["documents"]:
            if not item["public"]:
                continue
            localized: dict[str, object] = {}
            for locale, key in (("ru", "ru"), ("uz", "uz")):
                entry = item[key]
                metadata, body = front_matter(archive.read(f"{ROOT}/{entry['file']}").decode("utf-8"))
                title, sections = blocks_and_sections(body)
                localized[locale] = {
                    "title": title or entry["title"],
                    "description": description(sections, entry["title"]),
                    "sections": sections,
                }
            documents.append({"id": item["id"], "slug": item["slug"], "version": item["ru"]["file"] and "1.0", "locales": localized})

    result = {
        "source": {"packageVersion": manifest["version"], "sha256": package_hash},
        "mode": "PRE_INCORPORATION_PREVIEW",
        "contacts": {
            "privacyEmail": CONFIRMED["{{PRIVACY_EMAIL}}"],
            "legalEmail": CONFIRMED["{{LEGAL_EMAIL}}"],
            "supportEmail": CONFIRMED["{{SUPPORT_EMAIL}}"],
        },
        "documents": documents,
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if TOKEN.search(rendered):
        raise RuntimeError("Unresolved placeholder would be emitted")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
