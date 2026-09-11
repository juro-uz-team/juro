import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {assertCitationEvidenceIdentity, resolveCitationEvidence, fetchCitationEvidence, type CitationEvidenceReceipt} from "../lib/legal-corpus/citation-evidence";
import type {LegalEvidenceBucket} from "../lib/legal-corpus/target-evidence";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const text = `Статья 7. Правило ${"Полный текст официальной нормы. ".repeat(150)}`;
function fixture() {
  const value = {schemaVersion: 1, parser: {name: "parse5", version: "8.0.1", profile: "juro-legal-blocks-v1"},
    source: {sourceKind: "lex", locale: "ru", canonicalId: "lexuz:777", canonicalUrl: "https://lex.uz/ru/docs/777",
      rawContentSha256: "a".repeat(64)}, primarySelector: "lex-document", documentTitle: "Official law",
    blocks: [{index: 0, kind: "heading", semanticRole: "article", text: "Статья 7. Правило"},
      {index: 1, kind: "paragraph", text: "Полный текст официальной нормы. ".repeat(150)},
      {index: 2, kind: "heading", semanticRole: "article", text: "Статья 8. Другая норма"},
      {index: 3, kind: "paragraph", text: "Иной текст нормы."}], plainText: text};
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const receipt: CitationEvidenceReceipt = {version: 1, capability: "current", kind: "normalized-article",
    r2Key: "corpus/normalized/revision:sealed.json", byteCount: bytes.length, sha256: hash(bytes),
    officialUrl: value.source.canonicalUrl, languageTag: "ru", articleNumber: "7", textSha256: hash(text.trim())};
  const keys: string[] = [];
  const bucket: Pick<LegalEvidenceBucket, "get"> = {async get(key) {
    keys.push(key); return {key, size: bytes.length, async bytes() {return bytes;}};
  }};
  return {receipt, bucket, keys};
}

test("citation reopening authenticates complete pinned bytes independent of current activation", async () => {
  const {receipt,bucket,keys} = fixture();
  const first = await resolveCitationEvidence(bucket,receipt);
  const reopened = await resolveCitationEvidence(bucket,receipt);
  assert.equal(first.text,text.trim());
  assert.deepEqual(reopened,first);
  assert.equal(first.fullArticle,true);
  assert.equal(first.truncated,false);
  assert.ok(first.text.length>1200);
  assert.deepEqual(keys,[receipt.r2Key,receipt.r2Key]);
});

test("citation corruption and mismatched article or language cannot substitute another object", async () => {
  const {receipt,bucket} = fixture();
  for (const changed of [{...receipt,sha256:"b".repeat(64)}, {...receipt,textSha256:"c".repeat(64)},
    {...receipt,articleNumber:"8"}, {...receipt,languageTag:"en" as const},
    {...receipt,officialUrl:"https://lex.uz/ru/docs/888"}, {...receipt,byteCount:receipt.byteCount+1}]) {
    await assert.rejects(resolveCitationEvidence(bucket,changed));
  }
  await assert.rejects(resolveCitationEvidence({async get(){return null;}},receipt));
});

test("citation client rejects changed response text even from a successful service response", async () => {
  const {receipt} = fixture();
  const service = {async fetch() {return Response.json({text:"Unrelated current revision",fullArticle:true,truncated:false},
    {headers:{"x-juro-citation-evidence-contract":"1"}});}} as unknown as Fetcher;
  await assert.rejects(fetchCitationEvidence(service,"production",receipt), /CITATION_EVIDENCE_TEXT_MISMATCH/);
});

test("an older citation service cannot imply complete receipt support", async () => {
  const {receipt} = fixture();
  const service = {async fetch() {return Response.json({text:text.trim(),fullArticle:true,truncated:false});}} as unknown as Fetcher;
  await assert.rejects(fetchCitationEvidence(service,"production",receipt), /CITATION_EVIDENCE_CONTRACT_UNAVAILABLE/);
});

test("a receipt must match the stored citation's article, language, URL and pinned hashes", () => {
  const {receipt} = fixture();
  const expected = {officialUrl: receipt.officialUrl, languageTag: "ru", articleNumber: "Статья 7",
    sha256: receipt.sha256, textSha256: receipt.textSha256};
  assert.doesNotThrow(() => assertCitationEvidenceIdentity(receipt, expected));
  for (const changed of [{...expected,languageTag:"en"}, {...expected,articleNumber:"8"},
    {...expected,sha256:"d".repeat(64)}, {...expected,textSha256:"e".repeat(64)},
    {...expected,officialUrl:"https://lex.uz/ru/docs/888"}]) {
    assert.throws(() => assertCitationEvidenceIdentity(receipt,changed), /CITATION_EVIDENCE_IDENTITY_MISMATCH/);
  }
});
