import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { googleTagBootstrap } from "./google-tag.mjs";

function initialize({ choice = null, doNotTrack = "0", blockedStorage = false } = {}) {
  const listeners = new Map();
  const existing = { event: "existing_event" };
  const window = {
    dataLayer: [existing],
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  const localStorage = { getItem: () => {
    if (blockedStorage) throw new Error("Storage blocked");
    return choice;
  } };
  runInNewContext(googleTagBootstrap, { window, localStorage, navigator: { doNotTrack } });
  return {
    commands: () => window.dataLayer.slice(1).map(value => Array.from(value)),
    dispatch: (name, event) => listeners.get(name)(event),
    save: value => { choice = value; },
    existing: window.dataLayer[0],
  };
}

test("Google consent defaults precede initialization and preserve queued events", () => {
  const tag = initialize();
  assert.equal(tag.existing.event, "existing_event");
  const [consent, initialization] = tag.commands();
  assert.deepEqual(consent.slice(0, 2), ["consent", "default"]);
  assert.equal(consent[2].analytics_storage, "denied");
  for (const field of ["ad_storage", "ad_user_data", "ad_personalization"]) {
    assert.equal(consent[2][field], "denied");
  }
  assert.equal(initialization[0], "js");
  assert.ok(Number.isFinite(initialization[1].getTime()));
});

test("Google analytics consent follows the saved preference and Do Not Track", () => {
  assert.equal(initialize({ choice: "analytics" }).commands()[0][2].analytics_storage, "granted");
  assert.equal(initialize({ choice: "analytics", doNotTrack: "1" }).commands()[0][2].analytics_storage, "denied");
  assert.equal(initialize({ blockedStorage: true }).commands()[0][2].analytics_storage, "denied");
});

for (const event of ["juro-cookie-consent-changed", "juro-consent-changed"]) {
  test(`Google consent follows ${event} even when browser storage is blocked`, () => {
    const tag = initialize({ blockedStorage: true });
    tag.dispatch(event, { detail: "analytics" });
    assert.equal(tag.commands().at(-1)[2].analytics_storage, "granted");
    tag.dispatch(event, { detail: "necessary" });
    assert.equal(tag.commands().at(-1)[2].analytics_storage, "denied");
  });
}

test("Google consent follows cross-tab preference changes and storage clearing", () => {
  const tag = initialize();
  tag.save("analytics");
  tag.dispatch("storage", { key: "unrelated" });
  assert.equal(tag.commands().length, 2);
  tag.dispatch("storage", { key: "juro-cookie-consent" });
  assert.equal(tag.commands().at(-1)[2].analytics_storage, "granted");
  tag.save(null);
  tag.dispatch("storage", { key: null });
  assert.equal(tag.commands().at(-1)[2].analytics_storage, "denied");
});
