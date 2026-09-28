import assert from "node:assert/strict";
import test from "node:test";
import { createResendDelivery, emailDeliveryConfiguration } from "../lib/runtime/email-delivery";

test("capture is private-only and public configuration cannot silently capture account emails", () => {
  assert.equal(emailDeliveryConfiguration({ PRIVATE_DEVELOPMENT: "true" }).mode, "capture");
  assert.throws(() => emailDeliveryConfiguration({ EMAIL_DELIVERY_MODE: "capture" }), /private deployment/);
  assert.throws(() => emailDeliveryConfiguration({}), /Resend API key/);
  assert.throws(() => emailDeliveryConfiguration({ EMAIL_DELIVERY_MODE: "unknown" }), /Unsupported/);
});

test("Resend requires credentials and a non-local sender, and can be explicitly tested in private mode", () => {
  for (const from of ["", "noreply@localhost", "JURO <noreply@localhost>", "JURO <no-reply@juro.uz>\r\nBcc:other@example.com"]) {
    assert.throws(() => emailDeliveryConfiguration({ RESEND_API_KEY: "re_test", EMAIL_FROM: from }), /sender/);
  }
  const configuration = emailDeliveryConfiguration({ PRIVATE_DEVELOPMENT: "true", EMAIL_DELIVERY_MODE: "resend",
    RESEND_API_KEY: "re_test", EMAIL_FROM: "JURO <no-reply@juro.uz>" });
  assert.equal(configuration.mode, "resend");
  assert.equal(configuration.from, "JURO <no-reply@juro.uz>");
});

test("delivery preserves message, idempotency, cancellation and provider status without following redirects", async () => {
  const controller = new AbortController();
  let calls = 0;
  const message = JSON.stringify({ from: "JURO <no-reply@juro.uz>", to: ["test@example.com"], text: "verification" });
  const transport = createResendDelivery("re_server", async input => {
    calls++;
    assert.ok(input instanceof Request);
    assert.equal(input.url, "https://api.resend.com/emails");
    assert.equal(input.headers.get("authorization"), "Bearer re_server");
    assert.equal(input.headers.get("idempotency-key"), "registration-test");
    assert.equal(input.redirect, "error");
    assert.equal(await input.text(), message);
    controller.abort();
    assert.equal(input.signal.aborted, true);
    return new Response(null, { status: 429 });
  });
  const response = await transport.fetch("https://api.resend.com/emails", { method: "POST", body: message,
    headers: { authorization: "Bearer untrusted", "idempotency-key": "registration-test" }, signal: controller.signal });
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
});

test("delivery refuses alternate destinations before exposing credentials", async () => {
  const transport = createResendDelivery("re_server", async () => { assert.fail("must not fetch"); });
  for (const destination of ["https://example.com/emails", "http://api.resend.com/emails", "https://api.resend.com/emails?redirect=1"]) {
    await assert.rejects(transport.fetch(destination, { method: "POST", body: "{}" }), /Unsupported/);
  }
  await assert.rejects(transport.fetch("https://api.resend.com/emails"), /Unsupported/);
});
