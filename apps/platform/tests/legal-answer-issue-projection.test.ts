import assert from "node:assert/strict";
import test from "node:test";
import { createIssueWritingProjection } from "../lib/legal-answer-workflow/issue-writing-stream";
import type { WritingDraft } from "../lib/legal-answer-workflow/writing-stream";
import { citationProseNormalizer } from "../lib/legal-answer-workflow/citation-prose";

test("tool prose streams only after complete acquired-source headers and excludes private fields", () => {
  const drafts: WritingDraft[] = [];
  const project = createIssueWritingProjection(draft => drafts.push(draft), new Set(["s1"]));
  project('{"updates":[{"id":"permit","baseVersion":"0","change":"upsert","reason":"","sourceIds":["s1"');
  assert.equal(drafts.length, 0);
  project('],"content":{"title":"Permit","explanation":"Public events require a permit');
  assert.equal(drafts.at(-1)?.blocks.at(-1)?.text, "Public events require a permit");
  assert.equal(drafts.at(-1)?.issueUpdate?.id, "permit");
  project('. [s1]","requirementIds":["private-plan"],"actions":[]}}]}');
  assert.equal(drafts.at(-1)?.blocks.at(-1)?.text, "Public events require a permit.");
  assert.ok(!JSON.stringify(drafts.flatMap(draft => draft.blocks)).includes("private-plan"));
});

test("unread support cannot reach the writing callback", () => {
  const drafts: WritingDraft[] = [];
  const project = createIssueWritingProjection(draft => drafts.push(draft), new Set(["s1"]));
  assert.throws(() => project(JSON.stringify({ updates: [{ id: "permit", baseVersion: "0", change: "upsert",
    reason: "", sourceIds: ["unread"], content: { title: "Never displayed" } }] })), /ISSUE_SUPPORT_INVALID/);
  assert.deepEqual(drafts, []);
});

test("citation annotations after parenthetical references agree in streamed and saved prose", () => {
  for (const literal of [false, true]) {
    const drafts: WritingDraft[] = [];
    const normalize = citationProseNormalizer(literal ? "[s1]" : undefined);
    const project = createIssueWritingProjection(draft => drafts.push(draft), new Set(["s1"]), normalize);
    const prose = "A permit is required (Article 12). The authority grants it (Article 13)";
    for (const char of JSON.stringify({ updates: [{ id: "permit", baseVersion: "0", change: "upsert", reason: "", sourceIds: ["s1"],
      content: { title: "Permit", explanation: `${prose} [s1]` } }] })) project(char);
    assert.equal(drafts.at(-1)!.blocks.at(-1)!.text, literal ? `${prose} [s1]` : prose);
    assert.equal(normalize(`${prose} [s1]`, ["s1"]), drafts.at(-1)!.blocks.at(-1)!.text);
    assert.ok(drafts.every((draft, index) => !index || drafts[index - 1].blocks.every(block =>
      draft.blocks.find(next => next.key === block.key)?.text.startsWith(block.text))));
  }
});

test("issue-wide source headers do not remove an annotation unattached to an action", () => {
  const drafts: WritingDraft[] = [];
  const project = createIssueWritingProjection(draft => drafts.push(draft), new Set(["s1", "s2"]));
  for (const char of JSON.stringify({ updates: [{ id: "permit", baseVersion: "0", change: "upsert", reason: "", sourceIds: ["s1", "s2"],
    content: { title: "Permit", explanation: "A supported rule.", actions: [
      { title: "Apply", description: "A step. [s1]", sourceIds: ["s2"] },
    ] } }] })) project(char);
  assert.equal(drafts.at(-1)!.blocks.at(-1)!.text, "A step. [s1]");
});
