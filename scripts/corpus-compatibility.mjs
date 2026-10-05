import assert from "node:assert/strict";
import {lstatSync, readFileSync} from "node:fs";
import {dirname} from "node:path";

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
  for (let path = file; path !== "/"; path = dirname(path)) {
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o022) === 0,
      "Corpus compatibility must be operator-owned and immutable to application accounts");
  }
  return validateCorpusCompatibility(JSON.parse(readFileSync(file, "utf8")), environment, revision);
}
