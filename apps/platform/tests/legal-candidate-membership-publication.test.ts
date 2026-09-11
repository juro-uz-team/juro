import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {loadCandidateMembershipProjection} from "../lib/legal-corpus/candidate-membership-projection";

test("membership projection publication binds an immutable proof version to the accepted inventory", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE legal_search_releases(id TEXT PRIMARY KEY); INSERT INTO legal_search_releases VALUES ('release');");
    db.exec("CREATE TABLE legal_custom_search_r2_runtime_roots(search_release_id TEXT PRIMARY KEY, mapping_inventory_sha256 TEXT, mapping_count INTEGER);");
    db.prepare("INSERT INTO legal_custom_search_r2_runtime_roots VALUES (?,?,?)").run("release", "a".repeat(64), 3);
    db.exec(readFileSync("legal-drizzle/0031_candidate_membership_projections.sql", "utf8"));
    const insert = db.prepare("INSERT INTO legal_candidate_membership_projections VALUES (?,?,?,?,?,?,?,?)");
    const values = ["release", 1, "a".repeat(64), "proof-manifest", "b".repeat(64), 100, 3, "2026-09-11T00:00:00.000Z"] as const;
    assert.throws(() => insert.run(...values.slice(0, 6), 4, values[7]), /INVENTORY_MISMATCH/u);
    assert.throws(() => insert.run("release", 1, "c".repeat(64), ...values.slice(3)), /INVENTORY_MISMATCH/u);
    assert.throws(() => insert.run(...values.slice(0, 5), 262145, ...values.slice(6)));
    insert.run(...values);
    assert.throws(() => db.prepare("INSERT OR REPLACE INTO legal_candidate_membership_projections VALUES (?,?,?,?,?,?,?,?)")
      .run(...values.slice(0, 3), "replacement-manifest", ...values.slice(4)), /IMMUTABLE/u);
    assert.throws(() => insert.run(...values), /IMMUTABLE/u);
    assert.throws(() => db.exec("UPDATE legal_candidate_membership_projections SET member_count=4"), /IMMUTABLE/u);
    assert.throws(() => db.exec("DELETE FROM legal_candidate_membership_projections"), /IMMUTABLE/u);
  } finally {db.close();}
});

test("runtime loads only the published root and rejects altered projection bytes", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE legal_search_releases(id TEXT PRIMARY KEY); INSERT INTO legal_search_releases VALUES ('release');");
    db.exec("CREATE TABLE legal_custom_search_r2_runtime_roots(search_release_id TEXT PRIMARY KEY, mapping_inventory_sha256 TEXT, mapping_count INTEGER);");
    db.prepare("INSERT INTO legal_custom_search_r2_runtime_roots VALUES (?,?,?)").run("release", "a".repeat(64), 3);
    db.exec(readFileSync("legal-drizzle/0031_candidate_membership_projections.sql", "utf8"));
    const projection = {schemaVersion: 1, releaseId: "release", inventoryReleaseId: "physical-release",
      sourceInventorySha256: "a".repeat(64), memberCount: 3, partitions: [{partition: "00", root: {
        schemaVersion: 1, releaseId: "release", sourceInventorySha256: "a".repeat(64), memberCount: 3, merkleRoot: "b".repeat(64),
      }}]};
    let bytes = new TextEncoder().encode(JSON.stringify(projection));
    let reads = 0;
    const bucket = {async get(key: string) {assert.equal(key, "published-manifest"); reads++;
      return {size: bytes.length, async arrayBuffer() {return bytes.slice().buffer;}};
    }} as unknown as R2Bucket;
    const d1 = {prepare(sql: string) {return {bind(...values: string[]) {return {
      async first() {return db.prepare(sql).get(...values) ?? null;},
    };}};}} as unknown as D1Database;
    assert.equal(await loadCandidateMembershipProjection({db: d1, bucket, releaseId: "release"}), null);
    assert.equal(reads, 0);
    db.prepare("INSERT INTO legal_candidate_membership_projections VALUES (?,?,?,?,?,?,?,?)").run(
      "release", 1, "a".repeat(64), "published-manifest", createHash("sha256").update(bytes).digest("hex"), bytes.length, 3,
      "2026-09-11T00:00:00.000Z");
    assert.deepEqual(await loadCandidateMembershipProjection({db: d1, bucket, releaseId: "release"}), projection);
    bytes = new TextEncoder().encode(JSON.stringify({...projection, sourceInventorySha256: "c".repeat(64)}));
    await assert.rejects(loadCandidateMembershipProjection({db: d1, bucket, releaseId: "release"}), /ARTIFACT_INVALID/u);
  } finally {db.close();}
});
