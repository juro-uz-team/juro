import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createStoredObservationReader } from "../lib/legal-answer-workflow/stored-observations";

const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const document = Buffer.from(JSON.stringify({ schemaVersion: 1,
    parser: { name: "prepared", version: "1.0.0", profile: "juro-prepared-blocks-v1" },
    source: { sourceKind: "lex", locale: "en", canonicalId: "123", canonicalUrl: "https://lex.uz/docs/123",
      rawContentSha256: "c".repeat(64) }, primarySelector: "lex-document", documentTitle: "Artificial Act",
    blocks: [{ index: 0, kind: "paragraph", text: "Complete artificial rule with its exception." }],
    plainText: "Complete artificial rule with its exception." }));
  const locator = { identity: "stored:one", snapshot: digest(document), objectKey: `legal-evidence/normalized/${digest(document)}.json`,
    sha256: digest(document), byteCount: document.length, sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source",
    quarantined: false, canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true,
    encoding: "normalized-document", editionObservation: { selectedEdition: "01.01.2020", observedAt: "2020-01-01T00:00:00.000Z" } };
  const observation = Buffer.from(JSON.stringify({ version: 1, locator, source: { work: "work:one", position: "456" },
    textSha256: digest(Buffer.from("Artificial Act\n\nComplete artificial rule with its exception.")) }));
  const row = { key: `legal-evidence/observations/${digest(observation)}.json`, bytes: observation };
  const objects = { async get(key: string) { assert.equal(key, locator.objectKey); return document; } };
  return { document, locator, row, objects };
}

test("stored observations recover existing complete-provision receipts without preparing evidence", async () => {
  const { row, objects } = fixture();
  const reader = createStoredObservationReader({ objects, async find(query) {
    assert.deepEqual(query, { work: "work:one", position: "456", scope: { kind: "current" } });
    return [row];
  } });
  const receipt = await reader.lookup({ work: "work:one", position: "456", language: "en", scope: { kind: "current" } },
    new AbortController().signal);
  assert.equal(receipt?.title, "Artificial Act");
  assert.equal(receipt?.language, "en");
  assert.equal(receipt?.locator.editionObservation?.observedAt, "2020-01-01T00:00:00.000Z");
  assert.deepEqual(receipt?.selected, { kind: "normalized-document", articleNumber: null });
});

test("missing stored mappings do not invoke object reads", async () => {
  const reader = createStoredObservationReader({ async find() { return []; },
    objects: { async get() { throw new Error("unexpected object read"); } } });
  assert.equal(await reader.lookup({ work: "unknown", position: "1", language: "en", scope: { kind: "current" } },
    new AbortController().signal), null);
});

test("stored observation lookup rejects corrupt records and mismatched discovery mappings", async () => {
  const { row, objects } = fixture(), signal = new AbortController().signal;
  const request = { work: "work:one", position: "456", language: "en", scope: { kind: "current" as const } };
  const corrupted = createStoredObservationReader({ objects, async find() { return [{ ...row, bytes: Buffer.from("{}")}]; } });
  await assert.rejects(corrupted.lookup(request, signal), /EVIDENCE_INTEGRITY/);
  const wrongMapping = createStoredObservationReader({ objects, async find() { return [row]; } });
  await assert.rejects(wrongMapping.lookup({ ...request, position: "789" }, signal), /STORED_OBSERVATION_MAPPING/);
  await assert.rejects(wrongMapping.lookup({ ...request, language: "ru" }, signal), /CORPUS_SOURCE_IDENTITY/);
});

test("current stored observations cannot substitute for historical evidence", async () => {
  const { row } = fixture();
  const reader = createStoredObservationReader({ async find() { return [row]; },
    objects: { async get() { throw new Error("unexpected current object read"); } } });
  assert.equal(await reader.lookup({ work: "work:one", position: "456", language: "en",
    scope: { kind: "historical", at: "2010-01-01" } }, new AbortController().signal), null);
});

test("equally observed conflicting source identities do not receive an arbitrary tie break", async () => {
  const { row, objects } = fixture();
  const changed = JSON.parse(row.bytes.toString());
  changed.locator.identity = "stored:conflict";
  const bytes = Buffer.from(JSON.stringify(changed));
  const reader = createStoredObservationReader({ objects, async find() {
    return [row, { key: `legal-evidence/observations/${digest(bytes)}.json`, bytes }];
  } });
  await assert.rejects(reader.lookup({ work: "work:one", position: "456", language: "en", scope: { kind: "current" } },
    new AbortController().signal), /STORED_OBSERVATION_AMBIGUOUS/);
});
