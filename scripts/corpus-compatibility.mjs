import assert from "node:assert/strict";
import {lstatSync, readFileSync} from "node:fs";
import {dirname} from "node:path";

/** PrivateTmp in a user service can hide host root from its UID namespace.
 * The privileged deployment hook checks real host ownership; the runtime also
 * rejects mapped application owners and writable paths in its own namespace. */
export function operatorRootUid(uidMap, overflowUid) {
  const ranges = uidMap.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
  assert(ranges.length && ranges.every(row => row.length === 3
    && row.every(value => Number.isSafeInteger(value) && value >= 0) && row[2] > 0));
  const root = ranges.find(([, outside]) => outside === 0);
  if (root) return root[0];
  assert(Number.isSafeInteger(overflowUid) && overflowUid >= 0);
  assert(!ranges.some(([inside, , length]) => overflowUid >= inside && overflowUid < inside + length),
    "Unmapped owner must not identify an application user");
  return overflowUid;
}

export function validateCorpusCompatibility(value, environment, revision) {
  assert.equal(value.version, 1);
  assert(["production", "staging"].includes(environment));
  assert.equal(value.environment, environment);
  assert(/^[a-f0-9]{40}$/.test(revision));
  assert.equal(value.revision, revision);
  assert(/^[a-f0-9]{40}$/.test(value.acceptedRevision));
  assert(/^[a-f0-9]{64}$/.test(value.acceptanceSha256));
  assert(/^[a-f0-9]{64}$/.test(value.reviewSha256));
  return value;
}

/** An exact-revision approval lives outside releases and is issued only by root.
 * Absence retains the original strict product-revision binding. */
export function readCorpusCompatibility(environment, revision) {
  if (process.platform !== "linux" || !["production", "staging"].includes(environment)
    || !/^[a-f0-9]{40}$/.test(revision)) return undefined;
  const file = `/etc/juro/corpus-compatibility/${environment}/${revision}.json`;
  try { lstatSync(file); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  const rootUid = operatorRootUid(readFileSync("/proc/self/uid_map", "utf8"),
    Number(readFileSync("/proc/sys/kernel/overflowuid", "utf8").trim()));
  for (let path = file; path !== "/"; path = dirname(path)) {
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink() && stat.uid === rootUid && (stat.mode & 0o022) === 0,
      "Corpus compatibility must be operator-owned and immutable to application accounts");
  }
  return validateCorpusCompatibility(JSON.parse(readFileSync(file, "utf8")), environment, revision);
}
