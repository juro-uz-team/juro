import assert from "node:assert/strict";
import test from "node:test";
import { IssueWriting, type IssueUpdate } from "../lib/legal-answer-workflow/issue-writing";
import type { WrittenAnswer } from "../lib/legal-answer-workflow/contracts";
import { legalChatResponseSchema } from "../lib/ai/legal-chat-schema";
import { serializeLegalOutcome } from "../lib/legal-answer-workflow/serialization";

const issue = { title: "Permit", explanation: "A permit is required for public events.", requirementIds: ["r"], sourceIds: ["s1"], actions: [] };
const initial: IssueUpdate = { id: "permit", baseVersion: "0", change: "upsert", reason: "", sourceIds: ["s1"], content: issue };
const sources = new Set(["s1", "s2"]), requirements = new Set(["r"]);
const answer = (issues: WrittenAnswer["issues"]): WrittenAnswer => ({ issues, summary: "Qualified rule.", summarySourceIds: ["s1"],
  assumptions: [], conditionalBranches: [], deadlines: [], risks: [], referenceNotes: [], requiredDocuments: [], clarificationQuestions: [], urgency: "normal" });

test("incomplete research explicitly withdraws shown prose and saves the same explanation", () => {
  const writing = new IssueWriting("en");
  writing.commit([initial], sources, requirements);
  const revision = { ...initial, baseVersion: "1", reason: "An exception changes the earlier explanation." };
  writing.project(revision, [{ key: "issue/permit/title", text: "Revised permit rule" }], sources);
  const withdrawal = writing.withdrawIncomplete()!;
  assert.equal(withdrawal.revision, 2);
  assert.deepEqual(withdrawal.blocks, []);
  assert.match(withdrawal.notices!.at(-1)!, /withdrawn/);
  assert.equal(writing.correctionNotes()[0].note, revision.reason);
  const result = serializeLegalOutcome({ kind: "insufficient_evidence", researchIncomplete: true, checkedEvidence: [],
    gaps: [{ requirementId: "r", description: "Research unfinished." }], clarificationQuestions: [], revisionNotes: writing.correctionNotes() },
  { question: "Synthetic", language: "en", format: "detailed", mode: "fast", actor: { tenantId: "t", userId: "u" },
    history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 30_000 }, { sources: [], legalDatabaseAsOf: "2026-01-01" });
  assert.equal(legalChatResponseSchema.safeParse(result).success, true);
  assert.equal(result.referenceNotes!.at(-1)!.note, withdrawal.notices!.at(-1));
  assert.throws(() => writing.project(initial, [], sources), /ISSUE_WRITING_CLOSED/);
});

test("active issue capacity is enforced before streaming and retraction makes room without losing its version", () => {
  const writing = new IssueWriting("en");
  for (let i = 0; i < 16; i++) writing.commit([{ ...initial, id: `issue_${i}` }], sources, requirements);
  assert.throws(() => writing.project({ ...initial, id: "extra" }, [], sources), /ISSUE_CAPACITY/);
  assert.equal(writing.published().length, 16);
  writing.commit([{ ...initial, id: "issue_0", baseVersion: "1", change: "retract", content: null,
    reason: "This issue is outside the applicable regime." }, { ...initial, id: "extra" }], sources, requirements);
  assert.equal(writing.published().filter(item => item.content).length, 16);
  assert.equal(writing.published()[0].version, "2");
});

test("later contradictory law revises a streamed issue explicitly and preserves the correction on saving", () => {
  const writing = new IssueWriting("en");
  const first = writing.project(initial, [{ key: "issue/permit/title", text: "Permit" }, { key: "issue/permit/explanation", text: "A permit is required" }], sources);
  assert.equal(first.revision, undefined);
  writing.commit([initial], sources, requirements);
  const revised: IssueUpdate = { ...initial, baseVersion: "1", sourceIds: ["s1", "s2"],
    reason: "An additional rule exempts private gatherings from the earlier permit statement.",
    content: { ...issue, explanation: "Public events require a permit; private gatherings are exempt.", sourceIds: ["s1", "s2"] } };
  const draft = writing.project(revised, [{ key: "issue/permit/title", text: "Permit" }, { key: "issue/permit/explanation", text: "Public events require" }], sources);
  assert.equal(draft.revision, 1);
  assert.match(draft.notices![0], /exempts private gatherings/);
  writing.commit([revised], sources, requirements);
  const final = writing.finalize(answer([revised.content!]));
  assert.deepEqual(final.issues, [revised.content]);
  assert.equal(final.referenceNotes[0].note, revised.reason);
  assert.deepEqual(final.referenceNotes[0].sourceIds, ["s1", "s2"]);
  assert.throws(() => writing.finalize(answer([issue])), /ISSUE_FINAL_RECONCILIATION/);
});

test("retraction removes the issue, retains its version and does not allow stale text to return", () => {
  const writing = new IssueWriting("en");
  writing.commit([initial], sources, requirements);
  const removed: IssueUpdate = { ...initial, baseVersion: "1", change: "retract", content: null,
    reason: "The earlier issue concerns a different legal regime." };
  writing.project(removed, [], sources);
  writing.commit([removed], sources, requirements);
  assert.equal(writing.snapshot().blocks.length, 0);
  assert.equal(writing.snapshot().revision, 1);
  assert.deepEqual(writing.published(), [{ id: "permit", version: "2", content: null }]);
  assert.throws(() => writing.commit([initial], sources, requirements), /ISSUE_VERSION_INVALID/);
});

test("issued advice cannot cite unread sources, silently change a streamed prefix or finish pending writing", () => {
  const writing = new IssueWriting("en");
  assert.throws(() => writing.commit([{ ...initial, sourceIds: ["c1"] }], sources, requirements), /ISSUE_SUPPORT_INVALID/);
  writing.project(initial, [{ key: "issue/permit/explanation", text: "Different unsupported rule" }], sources);
  assert.throws(() => writing.commit([initial], sources, requirements), /ISSUE_STREAM_FINAL_MISMATCH/);
  assert.throws(() => writing.finalize(answer([issue])), /ISSUE_WRITING_UNFINISHED/);
});

test("a rejected batch changes no committed issue and cannot rewrite a streamed correction reason", () => {
  const writing = new IssueWriting("en");
  assert.throws(() => writing.commit([initial, { ...initial, id: "other", sourceIds: ["unread"] }], sources, requirements), /ISSUE_SUPPORT_INVALID/);
  assert.deepEqual(writing.published(), []);
  writing.commit([initial], sources, requirements);
  const revision: IssueUpdate = { ...initial, baseVersion: "1", reason: "The applicable exception changes the result." };
  writing.project(revision, [], sources);
  assert.throws(() => writing.commit([{ ...revision, reason: "A different undisclosed correction." }], sources, requirements), /ISSUE_REVISION_CHANGED/);
  assert.equal(writing.published()[0].version, "1");
  assert.throws(() => writing.project({ ...initial, id: "other" }, [{ key: "issue/permit/explanation", text: "Cross-issue replacement" }], sources), /ISSUE_BLOCK_INVALID/);
});

test("an atomic batch returns every revision snapshot and long correction reasons remain saveable", () => {
  const writing = new IssueWriting("en");
  writing.commit([initial, { ...initial, id: "other" }], sources, requirements);
  const reason = "A supported qualification. ".repeat(30);
  const drafts = writing.commit([initial, { ...initial, id: "other" }].map(update => ({ ...update, baseVersion: "1", reason })), sources, requirements);
  assert.deepEqual([...new Set(drafts.map(draft => draft.revision))], [1, 2]);
  const final = writing.finalize(answer([issue, issue]));
  assert.equal(final.referenceNotes.length, 2);
  assert.ok(final.referenceNotes.every(note => note.title.length <= 240 && note.note === reason));
});


test("issue and action citation bindings survive streaming, commit and retraction",()=>{
 const writing=new IssueWriting("en");
 const description="Request the permit.";
 const blocks=[{key:"issue/permit/explanation",text:issue.explanation},{key:"issue/permit/actions/0/description",text:description}];
 assert.throws(()=>writing.project(initial,blocks,sources,{"issue/permit/actions/0/description":["s2"]}),/ISSUE_SUPPORT_INVALID/);
 const projected=writing.project(initial,blocks,sources,{"issue/permit/actions/0/description":["s1"]});
 assert.deepEqual(projected.citations,{"issue/permit/explanation":["s1"],"issue/permit/actions/0/description":["s1"]});
 const content={...issue,actions:[{title:"Apply",description,sourceIds:["s1"]}]};
 writing.commit([{...initial,content}],sources,requirements);
 assert.deepEqual(writing.snapshot().citations,projected.citations);
 writing.commit([{...initial,baseVersion:"1",change:"retract",reason:"Does not apply.",content:null}],sources,requirements);
 assert.equal(writing.snapshot().citations,undefined);
});
