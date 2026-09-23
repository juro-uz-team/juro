import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { authTurnstileActions, validateAuthTurnstile, validateTurnstile } from "../lib/auth/turnstile";
const authStyles = fs.readFileSync("app/_auth/auth.css", "utf8");

const input = { secretKey: "private-local", token: "private-local", remoteIp: "127.0.0.1",
  expectedHostname: "localhost", expectedActions: [authTurnstileActions.passwordLogin] };

test("private authentication challenge requires an explicit private deployment", async context => {
  const previous = process.env.PRIVATE_DEVELOPMENT;
  context.after(() => { if (previous === undefined) delete process.env.PRIVATE_DEVELOPMENT; else process.env.PRIVATE_DEVELOPMENT = previous; });
  delete process.env.PRIVATE_DEVELOPMENT;
  assert.equal((await validateAuthTurnstile(input)).status, "unavailable");
  process.env.PRIVATE_DEVELOPMENT = "true";
  let networkCalls = 0;
  assert.equal((await validateAuthTurnstile({ ...input, fetcher: async () => { networkCalls++; throw new Error("No network"); } })).status, "verified");
  assert.equal(networkCalls, 0);
  assert.equal((await validateAuthTurnstile({ ...input, expectedHostname: "app.juro.uz" })).status, "invalid");
  assert.equal((await validateAuthTurnstile({ ...input, token: "" })).status, "invalid");
  assert.equal((await validateAuthTurnstile({ ...input, expectedActions: [] })).status, "invalid");
  assert.equal((await validateTurnstile({ ...input, expectedAction: "guest_ai" })).status, "verified");
});

test("auth utilities stay in document flow and retain accessible touch targets", () => {
  assert.match(
    authStyles,
    /\.auth-utilities\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*44px;[^}]*margin-bottom:\s*34px;/s,
  );
  assert.match(
    authStyles,
    /\.auth-language a\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s,
  );
  assert.doesNotMatch(authStyles, /\.auth-(?:language|theme)\s*\{[^}]*position:\s*absolute/s);
});
