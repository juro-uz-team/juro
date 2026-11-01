import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceInventory } from "../lib/legal-answer-workflow/inventory";

test("inventory retains complete UTF-8 evidence including metadata", () => {
  const inventory = new EvidenceInventory<{ identity: string; text: string; note?: string }>();
  const original = { identity: "rule", text: "ж".repeat(60_000), note: "Publisher metadata" };
  inventory.retain(original);
  inventory.retain(original);
  inventory.retain({ identity: "other", text: "Rule", note: "m".repeat(400_000) });
  assert.deepEqual(inventory.select(["rule"]), [original]);
  assert.equal(inventory.all().length, 2);
});

test("thirteen complete provisions remain available without dropping an operative rule", () => {
  const inventory = new EvidenceInventory<{ identity: string; text: string }>();
  const identities = Array.from({ length: 13 }, (_, index) => `provision-${index}`);
  for (const identity of identities) inventory.retain({ identity, text: `Complete artificial rule ${identity}.` });
  assert.equal(inventory.select(identities).length, 13);
  assert.equal(inventory.select(identities.slice(0, 1)).length, 1);
  assert.equal(inventory.all().length, 13);
});

test("complete large documents remain selectable together", () => {
  const inventory = new EvidenceInventory<{ identity: string; text: string }>();
  inventory.retain({ identity: "long", text: "ж".repeat(180_000) });
  assert.equal(inventory.select(["long"])[0].text.length, 180_000);
  inventory.retain({ identity: "overflow", text: "ж".repeat(80_000) });
  assert.equal(inventory.all().length, 2);
});

test("selection preserves every requested source beyond former ceiling", () => {
  const inventory = new EvidenceInventory<{ identity: string; text: string }>();
  for (let index = 0; index < 25; index++) inventory.retain({ identity: `${index}`, text: "Rule." });
  assert.equal(inventory.select(inventory.all().map(item => item.identity)).length, 25);
  assert.equal(inventory.all().length, 25);
});

test("a conflicting immutable evidence identity cannot replace an earlier read", () => {
  const inventory = new EvidenceInventory<{ identity: string; text: string }>();
  inventory.retain({ identity: "rule", text: "Complete original rule." });
  assert.throws(() => inventory.retain({ identity: "rule", text: "Changed rule." }), /EVIDENCE_IDENTITY_CONFLICT/);
  assert.equal(inventory.select(["rule"])[0].text, "Complete original rule.");
});
