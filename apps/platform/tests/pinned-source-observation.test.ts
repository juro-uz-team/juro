import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {createPinnedSourceVerifier} from "../lib/legal-corpus/pinned-source-observation";
import {normalizeLegalSourceHtml} from "../lib/legal/source-parser";
import {publisherTextFingerprint} from "../lib/legal/lex-document-status";
import {isCurrentSourceObservation} from "../lib/legal/source-observation";
import {parseResolvedOfficialEvidence} from "../lib/legal-corpus/target-evidence";

test("current verification compares the live publisher with the exact sealed parent revision", async () => {
  const url = "https://lex.uz/ru/docs/777";
  const snapshot = normalizeLegalSourceHtml({reference: {sourceKind: "lex", locale: "ru", canonicalId: "777", canonicalUrl: url},
    rawContentSha256: "a".repeat(64), html: `<title>Official law</title><main><h1>Official law</h1><p>${"This operative provision applies to the parties and defines their obligations. ".repeat(6)}</p></main>`});
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const now = Date.parse("2026-09-11T00:00:00.000Z");
  const observation = {version: 2 as const, officialUrl: url, observedAt: new Date(now).toISOString(), current: true,
    rawContentSha256: "b".repeat(64), normalizedTextSha256: await publisherTextFingerprint(snapshot)};
  let reads = 0;
  const verify = createPinnedSourceVerifier({bucket: {async get(key) {reads++;
    assert.equal(key, "corpus/normalized/original-revision.json");
    return {key, size: bytes.length, async bytes() {return bytes.slice();}};
  }}, observe: async () => observation});
  const evidence = parseResolvedOfficialEvidence({legalInstrumentId: "instrument", officialExpressionId: "expression",
    textRevisionId: "remapped-revision", provisionConceptId: "concept", provisionRenditionId: "rendition",
    languageTag: "ru", script: "Cyrl", textualAuthority: "official_translation", provisionText: snapshot.plainText,
    officialCitation: {url, label: "Official law"}, evidence: {provisionRenditionId: "rendition", r2Key: "sealed",
      byteCount: 100, sha256: "c".repeat(64), sourceNormalizedSha256: hash, sourceRevisionId: "original-revision", schemaVersion: 1}});
  for (let index = 0; index < 2; index++) {
    const checked = await verify(evidence);
    assert.equal(isCurrentSourceObservation(checked.observation,
      {officialUrl: url, normalizedTextSha256: checked.pinnedTextSha256, now}), true);
  }
  assert.equal(reads, 1, "Provisions sharing an authenticated revision share its fingerprint read");
  observation.normalizedTextSha256 = "d".repeat(64);
  const changed = await verify(evidence);
  assert.equal(isCurrentSourceObservation(changed.observation,
    {officialUrl: url, normalizedTextSha256: changed.pinnedTextSha256, now}), false);
  await assert.rejects(verify({...evidence, evidence: {...evidence.evidence, sourceNormalizedSha256: "e".repeat(64)}}));
  await assert.rejects(verify({...evidence, languageTag: "en"}));
});
