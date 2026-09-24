import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {buildCustomMembershipLookup, createCustomMembershipLookupReader, resolveCustomMembershipLookup} from "../lib/legal-corpus/custom-membership-lookup";

test("historical membership pages produce bounded point reads without changing identities", async () => {
  const objects = new Map<string, Uint8Array>();
  const reads: string[] = [];
  const releaseId = "release:historical-lookup";
  const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const members = ["0010", "001f"].map((prefix, ordinal) => ({
    itemKey: `retrieval-chunk-v1:${prefix}${"a".repeat(60)}`, ordinal,
    legalIdentitySha256: "b".repeat(64),
  }));
  // Historical source pages exceed the old 16 MiB build limit. Whitespace keeps
  // this fixture cheap to parse while exercising authentication of every byte.
  const source = new TextEncoder().encode(JSON.stringify({schemaVersion: 1, releaseId,
    partition: "00", items: members}) + " ".repeat(17 * 1024 * 1024));
  objects.set("original", source);
  const root = bytes({schemaVersion: 1, releaseId, partitions: [{partition: "00", count: 2,
    key: "original", sha256: hash(source), sizeBytes: source.length}]});
  const sourceInventorySha256 = hash(root);
  objects.set(`search-releases/${releaseId}/runtime/mappings-${sourceInventorySha256}.json`, root);
  const bucket = {async get(key: string) {
    reads.push(key);
    const value = objects.get(key);
    return value ? {size: value.length, async arrayBuffer() {return value.slice().buffer;}} : null;
  }} as unknown as R2Bucket;
  const layout = await buildCustomMembershipLookup({bucket, releaseId, sourceInventorySha256,
    write: async (reference, value) => {objects.set(reference.key, value);}});
  reads.length = 0;
  const result = await resolveCustomMembershipLookup({bucket, releaseId, sourceInventorySha256,
    reference: layout.reference, itemKeys: [members[0]!.itemKey]});
  assert.deepEqual([...result], [[members[0]!.itemKey, {ordinal: 0, legalIdentitySha256: "b".repeat(64)}]]);
  assert.equal(reads.includes("original"), false);
  const leaf = JSON.parse(new TextDecoder().decode(objects.get(reads.find(key => key.includes("/leaf-"))!)!));
  assert.deepEqual(leaf.items, [members[0]], "adjacent fourth-nibble partitions remain separate bounded reads");
  assert.equal(objects.get("original"), source, "original evidence inventory remains untouched");
});

test("registered lookup roots are append-only and require bounded hashes and sizes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE legal_search_releases(id TEXT PRIMARY KEY); INSERT INTO legal_search_releases VALUES ('release');");
    db.exec(readFileSync("legal-drizzle/0029_custom_membership_lookup.sql", "utf8"));
    const insert = db.prepare("INSERT INTO legal_custom_search_membership_lookups VALUES (?,?,?,?,?,?,?)");
    assert.throws(() => insert.run("release", "a".repeat(64), "lookup", "b".repeat(64), 262145, 1, "2026-09-10"));
    assert.throws(() => insert.run("release", "invalid", "lookup", "b".repeat(64), 100, 1, "2026-09-10"));
    insert.run("release", "a".repeat(64), "lookup", "b".repeat(64), 100, 1, "2026-09-10");
    assert.throws(() => db.exec("UPDATE legal_custom_search_membership_lookups SET member_count=2"), /IMMUTABLE/u);
    assert.throws(() => db.exec("DELETE FROM legal_custom_search_membership_lookups"), /IMMUTABLE/u);
  } finally { db.close(); }
});

test("existing three-nibble membership roots remain readable", async () => {
  const objects = new Map<string, Uint8Array>();
  const store = (key: string, value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    objects.set(key, bytes);
    return {key, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
  };
  const releaseId = "release:legacy";
  const sourceInventorySha256 = "a".repeat(64);
  const itemKey = `retrieval-chunk-v1:001${"a".repeat(61)}`;
  const leaf = store("legacy-leaf", {schemaVersion: 2, releaseId, partition: "001",
    items: [{itemKey, ordinal: 7, legalIdentitySha256: "b".repeat(64)}]});
  const directory = store("legacy-directory", {schemaVersion: 2, releaseId, partition: "00",
    pages: [{...leaf, partition: "001", count: 1}]});
  const reference = store("legacy-root", {schemaVersion: 2, releaseId, sourceInventorySha256,
    memberCount: 1, partitions: [{...directory, partition: "00", count: 1}]});
  const bucket = {async get(key: string) {
    const value = objects.get(key);
    return value ? {size: value.length, async arrayBuffer() {return value.slice().buffer;}} : null;
  }} as unknown as R2Bucket;
  const result = await resolveCustomMembershipLookup({bucket, releaseId, sourceInventorySha256, reference, itemKeys: [itemKey]});
  assert.deepEqual([...result], [[itemKey, {ordinal: 7, legalIdentitySha256: "b".repeat(64)}]]);
});

test("fine membership layout preserves every accepted identity and reads only requested leaves", async () => {
  const objects = new Map<string, Uint8Array>();
  const reads: string[] = [];
  let activeBodies = 0;
  let maximumBodies = 0;
  const releaseId = "release:lookup-test";
  const bytes = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  const members = Array.from({length: 64}, (_, ordinal) => ({
    itemKey: `retrieval-chunk-v1:${ordinal.toString(16).padStart(3, "0")}${"a".repeat(61)}`,
    ordinal, legalIdentitySha256: hash(bytes(ordinal)),
  }));
  const originalPage = bytes({schemaVersion: 1, releaseId, partition: "00", items: members});
  const pageKey = "original-page";
  objects.set(pageKey, originalPage);
  const rootBytes = bytes({schemaVersion: 1, releaseId, partitions: [{partition: "00", count: members.length,
    key: pageKey, sha256: hash(originalPage), sizeBytes: originalPage.byteLength}]});
  const sourceInventorySha256 = hash(rootBytes);
  objects.set(`search-releases/${releaseId}/runtime/mappings-${sourceInventorySha256}.json`, rootBytes);
  const bucket = {async get(key: string) {
    reads.push(key);
    const value = objects.get(key);
    return value ? {size: value.length, async arrayBuffer() {
      activeBodies += 1;
      maximumBodies = Math.max(maximumBodies, activeBodies);
      try { await new Promise(resolve => setTimeout(resolve, 1)); return value.slice().buffer; }
      finally { activeBodies -= 1; }
    }} : null;
  }} as unknown as R2Bucket;
  const layout = await buildCustomMembershipLookup({bucket, releaseId, sourceInventorySha256,
    write: async (reference, value) => {objects.set(reference.key, value);}});
  assert.equal(layout.memberCount, members.length);
  const lookup = (itemKeys: string[]) => resolveCustomMembershipLookup({bucket, releaseId,
    sourceInventorySha256, reference: layout.reference, itemKeys});
  const all = await lookup(members.map(member => member.itemKey));
  assert.ok(maximumBodies > 6 && maximumBodies <= 16, "small bodies overlap within the fixed memory bound");
  assert.deepEqual([...all].sort(), members.map(({itemKey, ...member}) => [itemKey, member]).sort());
  reads.length = 0;
  assert.equal((await lookup([members[17]!.itemKey])).get(members[17]!.itemKey)?.ordinal, 17);
  assert.equal(reads.filter(key => key.includes("/leaf-")).length, 1);
  assert.equal(reads.includes(pageKey), false);
  const leafKey = reads.find(key => key.includes("/leaf-"))!;
  assert.ok(objects.get(leafKey)!.length < originalPage.length / 10);
  const requestReader = createCustomMembershipLookupReader(bucket);
  await requestReader({releaseId, sourceInventorySha256, reference: layout.reference, itemKeys: [members[17]!.itemKey]});
  reads.length = 0;
  await requestReader({releaseId, sourceInventorySha256, reference: layout.reference, itemKeys: [members[18]!.itemKey]});
  assert.equal(reads.length, 1, "repair authenticates its new leaf while reusing verified directory metadata");
  assert.ok(reads[0]!.includes("/leaf-"));
  await assert.rejects(resolveCustomMembershipLookup({bucket, releaseId, reference: layout.reference,
    sourceInventorySha256: "f".repeat(64), itemKeys: [members[17]!.itemKey]}));
  const corrupt = objects.get(leafKey)!.slice();
  corrupt[corrupt.length - 1] ^= 1;
  objects.set(leafKey, corrupt);
  await assert.rejects(lookup([members[17]!.itemKey]), /CORRUPT/u);
  await assert.rejects(lookup(members.map(member => member.itemKey)), /CORRUPT/u);
  assert.equal(activeBodies, 0, "failed validation drains in-flight readers before returning");
  objects.set(pageKey, new Uint8Array(originalPage.length));
  await assert.rejects(buildCustomMembershipLookup({bucket, releaseId, sourceInventorySha256,
    write: async () => assert.fail("corrupt source must not produce lookup artifacts")}), /CORRUPT/u);
});
