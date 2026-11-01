import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyEvidenceStoreRegistration } from "../lib/legal-answer-workflow/evidence-registration";

test("evidence registration requires the exact immutable manifest, namespace and append privilege", () => {
  const manifest = Buffer.from(JSON.stringify({ format: "prepared-postgres-evidence-store-v1", identity: "artificial-generation" }));
  const hash = createHash("sha256").update(manifest).digest("hex");
  const registration = { namespace: `legal-prepared-${hash}`, manifest, canAppend: true };
  assert.equal(verifyEvidenceStoreRegistration(registration, hash), registration.namespace);
  assert.throws(() => verifyEvidenceStoreRegistration(null, hash), /REGISTRATION_INVALID/);
  assert.throws(() => verifyEvidenceStoreRegistration({ ...registration, canAppend: false }, hash), /REGISTRATION_INVALID/);
  assert.equal(verifyEvidenceStoreRegistration({ ...registration, canAppend: false }, hash, { readOnly: true }), registration.namespace);
  assert.throws(() => verifyEvidenceStoreRegistration({ ...registration, manifest: Buffer.from("Changed manifest") },
    hash, { readOnly: true }), /REGISTRATION_INVALID/);
  assert.throws(() => verifyEvidenceStoreRegistration({ ...registration, namespace: `legal-prepared-${"b".repeat(64)}` }, hash), /REGISTRATION_INVALID/);
  assert.throws(() => verifyEvidenceStoreRegistration({ ...registration, manifest: Buffer.from("Changed manifest") }, hash), /REGISTRATION_INVALID/);
  const wrongFormat = Buffer.from('{"format":"other-store"}');
  const otherHash = createHash("sha256").update(wrongFormat).digest("hex");
  assert.throws(() => verifyEvidenceStoreRegistration({ ...registration, namespace: `legal-prepared-${otherHash}`, manifest: wrongFormat }, otherHash), /REGISTRATION_INVALID/);
});
