import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { readOfficialProvision } from "../lib/legal-answer-workflow/evidence";
import type { ProvisionLocator } from "../lib/legal-answer-workflow/evidence";

const text = "Artificial complete rule. Exception: written consent changes the result.";
const bytes = Buffer.from(text);
const eligible: ProvisionLocator = {
  identity: "fixture", snapshot: "revision", objectKey: "object",
  sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
  sourceUrl: "https://lex.uz/docs/123#456", privacyClass: "public_official_source",
  quarantined: false, canonicalizationConflict: false,
  temporalState: "current_supported", currentPointerVerified: true,
};

test("stored reads preserve legal-date and safe source-address boundaries", async () => {
  for (const change of [
    { temporalState: "disputed" as const },
    { temporalState: "historical_only" as const },
    { sourceUrl: "https://lex.uz.attacker.example/docs/123" },
    { sourceUrl: "https://user:password@lex.uz/docs/123" },
  ]) {
    await assert.rejects(() => readOfficialProvision({ ...eligible, ...change },
      { get: async () => bytes }), /EVIDENCE_INELIGIBLE/);
  }
  assert.equal((await readOfficialProvision(eligible, { get: async () => bytes })).text, text);
});

test("a missing stored provision remains unavailable", async () => {
  const original = Buffer.from("Artificial provision: notice requires written delivery.");
  await assert.rejects(() => readOfficialProvision({
    identity: "fixture-provision", snapshot: "fixture-revision", objectKey: "fixture-key",
    sha256: createHash("sha256").update(original).digest("hex"),
    byteCount: original.length, sourceUrl: "https://lex.uz/docs/123#456",
    privacyClass: "public_official_source", quarantined: false,
    canonicalizationConflict: false, temporalState: "current_supported",
    currentPointerVerified: true,
  }, { get: async () => null }),
  /OFFICIAL_PROVISION_NOT_FOUND/);
});

test("private objects are rejected before their text is read", async () => {
  let reads = 0;
  await assert.rejects(() => readOfficialProvision({
    identity: "private-provision", snapshot: "fixture-revision", objectKey: "private-key",
    sha256: "0".repeat(64), byteCount: 1, sourceUrl: "https://lex.uz/docs/123",
    privacyClass: "private", quarantined: false, canonicalizationConflict: false,
    temporalState: "current_supported", currentPointerVerified: true,
  }, { get: async () => { reads++; return new Uint8Array([1]); } }), /EVIDENCE_INELIGIBLE/);
  assert.equal(reads, 0);
});

test("historical evidence is admitted only for its authenticated applicability date", async () => {
  const historical = { ...eligible, temporalState: "historical_only" as const,
    currentPointerVerified: false, applicableAt: "2020-04-03" };
  const store = { get: async () => bytes };
  const result = await readOfficialProvision(historical, store,
    { kind: "historical", at: "2020-04-03" });
  assert.equal(result.text, text);
  await assert.rejects(() => readOfficialProvision(historical, store,
    { kind: "historical", at: "2021-04-03" }), /EVIDENCE_INELIGIBLE/);
  await assert.rejects(() => readOfficialProvision(eligible, store,
    { kind: "historical", at: "2020-04-03" }), /EVIDENCE_INELIGIBLE/);
});

test("cancellation reaches an active evidence read and rejects late evidence", async () => {
  const controller = new AbortController();
  let readSignal: AbortSignal | undefined;
  let release: (value: Uint8Array) => void = () => {};
  const pending = readOfficialProvision(eligible, { get: async (_key, signal) => {
    readSignal = signal;
    return new Promise<Uint8Array>(resolve => { release = resolve; });
  } }, { kind: "current" }, controller.signal);
  controller.abort(new Error("CANCELLED"));
  release(bytes);
  await assert.rejects(pending, /CANCELLED/);
  assert.equal(readSignal?.aborted, true);
});

test("invalid evidence metadata and impossible applicability dates fail before storage access", async () => {
  let reads = 0;
  const store = { get: async () => { reads++; return bytes; } };
  for (const change of [
    { identity: "" }, { snapshot: " " }, { objectKey: "" },
    { byteCount: -1 }, { byteCount: 1.5 }, { sha256: "invalid" },
    { sourceUrl: "not a URL" },
  ]) {
    await assert.rejects(() => readOfficialProvision({ ...eligible, ...change }, store), /EVIDENCE_INELIGIBLE/);
  }
  await assert.rejects(() => readOfficialProvision({ ...eligible, applicableAt: "2023-02-29" }, store,
    { kind: "historical", at: "2023-02-29" }), /EVIDENCE_INELIGIBLE/);
  assert.equal(reads, 0);
});
