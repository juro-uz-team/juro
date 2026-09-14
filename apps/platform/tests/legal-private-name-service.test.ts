import assert from "node:assert/strict";
import test from "node:test";
import { classifyTargetPrivateNames, handleTargetReasoningServiceRequest, TARGET_PRIVATE_NAME_CLASSIFICATION_PATH } from "../lib/legal-corpus/target-reasoning-service";

test("private-name service retains its authenticated transport without chat reasoning routes", async () => {
  const text = "Companies Act protects John.";
  const body = JSON.stringify({ text, formulationSha256: await computeFormulationSha256(text), legalTitleSpans: ["Companies Act"] });
  const headers = { "content-type": "application/json", "x-juro-service-binding": "target-retrieval-runtime-v1", "x-juro-legal-environment": "staging" };
  const request = (host: string, route = TARGET_PRIVATE_NAME_CLASSIFICATION_PATH) => new Request(`http://${host}${route}`, { method: "POST", headers, body });
  const response = await handleTargetReasoningServiceRequest(request("legal-corpus.internal"), { APP_ENV: "staging" });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { privateNameSpans: string[] }).privateNameSpans, ["John"]);
  assert.equal((await handleTargetReasoningServiceRequest(request("app.juro.uz"), { APP_ENV: "staging" })).status, 404);
  assert.equal((await handleTargetReasoningServiceRequest(request("legal-corpus.internal", "/internal/legal-corpus/reasoning/select"), { APP_ENV: "staging" })).status, 404);
});

async function computeFormulationSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode([
    "juro.private-name-classification.v1",
    text.normalize("NFC"),
  ].join("\n")));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

test("local PII attestation is hash-bound and preserves only declared legal titles", async () => {
  const text = "Companies Act protects John and Иван Петров.";
  const formulationSha256 = await computeFormulationSha256(text);
  const result = await classifyTargetPrivateNames({
    text,
    formulationSha256,
    legalTitleSpans: ["Companies Act"],
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.privateNameSpans, ["John", "Иван Петров"]);
  assert.equal(result.privateNameSpans.includes("Companies Act"), false);

  const mismatch = await classifyTargetPrivateNames({
    text,
    formulationSha256: "0".repeat(64),
    legalTitleSpans: ["Companies Act"],
  });
  assert.equal(mismatch.status, "uncertain");
});
