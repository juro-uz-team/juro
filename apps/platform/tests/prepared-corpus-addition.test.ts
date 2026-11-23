import assert from "node:assert/strict";
import test from "node:test";
import { partitionedDiscovery } from "../lib/legal-answer-workflow/prepared-addition";
import type { StoredDiscovery } from "../lib/legal-answer-workflow/stored-corpus";

const signal = new AbortController().signal;

function sources(values: Record<string, string>): StoredDiscovery {
  return {
    async search() {
      return { candidates: Object.keys(values), sparseAvailable: true, denseAvailable: true };
    },
    async readCandidate(work) {
      return { work, source: { inventory: { url: values[work] }, prepared: null }, unitMetadata: {} };
    },
  };
}

test("a prepared addition replaces the same signed source while leaving unrelated documents discoverable", async () => {
  const routed = new Map<string, number>();
  const discovery = partitionedDiscovery([
    { discovery: sources({ before: "https://lex.uz/docs/-154", other: "https://lex.uz/docs/154" }),
      replacements: new Set() },
    { discovery: sources({ after: "https://lex.uz/docs/-154" }), replacements: new Set(['["-154",null]']) },
  ], (work, partition) => routed.set(work, partition));
  const current = await discovery.search("article", { kind: "current" }, signal);
  assert.deepEqual(current.candidates, ["after", "other"]);
  assert.equal((await discovery.readCandidate("after", signal)).work, "after");
  assert.equal(routed.get("after"), 1);
});

test("a new current capture does not hide a retained historical edition", async () => {
  const discovery = partitionedDiscovery([
    { discovery: sources({ before: "https://lex.uz/docs/-154?ONDATE=01.07.2026" }), replacements: new Set() },
    { discovery: sources({ after: "https://lex.uz/docs/-154" }), replacements: new Set(['["-154",null]']) },
  ], () => {});
  const history = await discovery.search("article", { kind: "historical", at: "2026-07-01" }, signal);
  assert.ok(history.candidates.includes("before"));
});
