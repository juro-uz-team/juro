import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { IssueReconciliation, IssueReviewQuoteError } from "../lib/legal-answer-workflow/issue-reconciliation";
import { ProviderResearchSession } from "../lib/legal-answer-workflow/provider-research-session";
import { researchResponseSchema, type ModelOperation } from "../lib/legal-answer-workflow/contracts";

const law = "Public events require permits. Private gatherings are exempt.";
const issue = { id: "permit", version: "1", content: { title: "Permits", explanation: "Public events require permits.",
  sourceIds: ["s1"], requirementIds: ["r1"], actions: [] } };
const input = { issueWriting: true, publishedIssues: [issue], evidence: [{ identity: "s1", text: law }],
  researchAgent: true, language: "en", interpretation: { requirements: [{ id: "r1" }] } };
const review = { issueId: "permit", version: "1", passages: [{ sourceId: "s1", quote: law, attachmentPage: null,
  ruleAndQualifications: "Public events need permits; private gatherings are exempt." }],
  claims: [{ field: "explanation", actionIndex: null, publicClaim: issue.content.explanation, passageIndices: [0],
    qualifications: [{ qualification: "Public events", treatment: "preserved", publicWording: "Public events", reason: "The public claim is limited to public events." }] }],
  comparison: "The public rule is bounded to public events.", omissionsOrConflicts: [], disposition: "confirmed" };

test("review compares actual public words and cannot confirm missing qualifications or unreviewed actions", () => {
  const state = new IssueReconciliation();
  const claim = review.claims[0];
  const check = (claims: unknown[], pattern: RegExp) => assert.throws(() => state.prepare(input, true).accept({ reviews: [{ ...review, claims }] }), pattern);
  check([{ ...claim, publicClaim: "A claim that was never published" }], /PUBLIC_SPAN_INVALID/);
  check([{ ...claim, passageIndices: [1] }], /PASSAGE_INVALID/);
  check([{ ...claim, passageIndices: [], qualifications: [] }], /CLAIM_SUPPORT_MISSING/);
  check([{ ...claim, qualifications: [{ ...claim.qualifications[0], publicWording: "Unpublished qualification" }] }], /QUALIFICATION_SPAN_INVALID/);
  check([{ ...claim, qualifications: [{ ...claim.qualifications[0], treatment: "missing", publicWording: null }] }], /REVIEW_CONFLICT/);
  const withAction = { ...input, publishedIssues: [{ ...issue, content: { ...issue.content,
    actions: [{ title: "Apply", description: "Apply to the authority.", sourceIds: ["s1"] }] } }] };
  assert.throws(() => state.prepare(withAction, true).accept({ reviews: [review] }), /CLAIM_COVERAGE_MISSING/);
  const unsupportedAction = { field: "action_description", actionIndex: 0, publicClaim: "Apply to the authority.",
    passageIndices: [], qualifications: [] };
  const result = state.prepare(withAction, true).accept({ reviews: [{ ...review, disposition: "research_required",
    claims: [...review.claims, unsupportedAction], omissionsOrConflicts: ["The application procedure has no acquired support."],
    researchQueries: [{ requirementId: "r1", query: "Application procedure" }] }] });
  assert.equal("turn" in result && result.turn?.decision, "research");
  assert.equal(state.prepare(input, true).required, true);
});

test("reconciliation verifies quotes atomically and invalidates on changed law or prose", () => {
  const state = new IssueReconciliation();
  const pending = state.prepare(input, true);
  assert.equal(pending.required, true);
  assert.equal(z.fromJSONSchema(pending.tool.parameters).safeParse({ reviews: [review, { ...review, disposition: "revision_required", omissionsOrConflicts: ["An exception needs correcting."] }] }).success, false);
  assert.equal(z.fromJSONSchema(pending.tool.parameters).safeParse({ reviews: [{ ...review, omissionsOrConflicts: ["An unresolved qualification."] }] }).success, false);
  assert.equal(z.fromJSONSchema(pending.tool.parameters).safeParse({ reviews: [{ ...review, disposition: "revision_required" }] }).success, false);
  assert.throws(() => pending.accept({ reviews: [{ ...review, passages: [{ ...review.passages[0], quote: "invented" }] }] }), /QUOTE_INVALID/);
  assert.throws(() => pending.accept({ reviews: [review, { ...review, issueId: "unknown" }] }), /VERSION_INVALID/);
  assert.equal(state.prepare(input, true).required, true);
  pending.accept({ reviews: [review] });
  assert.equal(state.prepare(structuredClone(input), true).required, false);
  assert.equal(state.prepare({ ...input, evidence: [...input.evidence, { identity: "s2", text: "Later amendment." }] }, true).required, true);
  assert.equal(state.prepare({ ...input, publishedIssues: [{ ...issue, version: "2" }] }, true).required, true);
  pending.accept({ reviews: [{ ...review, disposition: "revision_required", omissionsOrConflicts: ["State the exception."] }] });
  assert.equal(state.prepare(input, true).required, true);
  assert.throws(() => pending.accept({ reviews: [review] }), /PUBLIC_REVISION_REQUIRED/);
  const revised = { ...input, publishedIssues: [{ ...issue, version: "2", content: { ...issue.content, explanation: law } }] };
  const next = state.prepare(revised, true);
  assert.throws(() => next.accept({ reviews: [{ ...review, version: "2", omissionsOrConflicts: ["Missing qualification."] }] }), /REVIEW_CONFLICT/);
  next.accept({ reviews: [{ ...review, version: "2" }] });
  assert.equal(state.prepare(revised, true).required, false);
});

test("attachment review requires an actually attached source and cannot bypass retained-text verification", () => {
  const state = new IssueReconciliation();
  const quoted = { ...review, passages: [{ ...review.passages[0], quote: "Text read from the original PDF.", attachmentPage: 2 }] };
  assert.throws(() => state.prepare(input, true).accept({ reviews: [quoted] }), /QUOTE_INVALID/);
  const attached = { ...input, evidence: [{ identity: "s1", text: "Navigation only.", sourceFile: { attached: true as const } }] };
  state.prepare(attached, true).accept({ reviews: [quoted] });
  assert.equal(state.prepare(attached, true).required, false);
  assert.throws(() => state.prepare(attached, true).accept({ reviews: [{ ...quoted,
    passages: [{ ...quoted.passages[0], attachmentPage: null }] }] }), /QUOTE_INVALID/);
});

test("a material research dependency survives narrower prose and requires acquired law before confirmation", () => {
  const state = new IssueReconciliation();
  const dependency = { ...review, disposition: "research_required", omissionsOrConflicts: ["The filing procedure remains unresearched."],
    researchQueries: [{ requirementId: "r1", query: "Public event permit filing procedure" }] };
  const result = state.prepare(input, true).accept({ reviews: [dependency] });
  assert.deepEqual(result, { turn: { decision: "research", content: null, gaps: [], actions: dependency.researchQueries, coverageUpdates: [] } });
  const narrowed = { ...input, publishedIssues: [{ ...issue, version: "2" }] };
  assert.deepEqual(state.prepare(narrowed, true).freshReviewIds, []);
  assert.throws(() => state.prepare(narrowed, true).accept({ reviews: [{ ...review, version: "2" }] }), /RESEARCH_REQUIRED/);
  assert.equal(state.prepare({ ...input, publishedIssues: [] }, true).required, true);
  const metadataOnly = { ...narrowed, evidence: input.evidence.map(source => ({ ...source, title: "Updated label" })) };
  assert.throws(() => state.prepare(metadataOnly, true).accept({ reviews: [{ ...review, version: "2" }] }), /RESEARCH_SUPPORT_MISSING/);
  const acquired = { ...narrowed, evidence: [...input.evidence, { identity: "s2", text: "File the application with the local authority." }] };
  assert.deepEqual(state.prepare(acquired, true).freshReviewIds, ["permit"]);
  assert.throws(() => state.prepare(acquired, true).accept({ reviews: [{ ...review, version: "2" }] }), /RESEARCH_SUPPORT_MISSING/);
  state.prepare(acquired, true).accept({ reviews: [{ ...review, version: "2", passages: [...review.passages,
    { sourceId: "s2", quote: "File the application with the local authority.", attachmentPage: null, ruleAndQualifications: "Filing procedure." }] }] });
  assert.equal(state.prepare(acquired, true).required, false);
  assert.throws(() => state.prepare({ ...input, canResearch: false }, true).accept({ reviews: [dependency] }), /RESEARCH_CLOSED/);
});

test("shared-requirement confirmations cannot erase a same-batch dependency and invalid batches commit nothing", () => {
  const state = new IssueReconciliation();
  const shared = { ...input, publishedIssues: [issue, { ...issue, id: "filing" }] };
  const dependency = { ...review, issueId: "filing", disposition: "research_required", omissionsOrConflicts: ["Missing filing rule."],
    researchQueries: [{ requirementId: "r1", query: "Public event filing rule" }] };
  assert.throws(() => state.prepare(shared, true).accept({ reviews: [review,
    { ...dependency, researchQueries: [{ requirementId: "unknown", query: "Unknown" }] }] }), /RESEARCH_ARGUMENT_INVALID/);
  assert.equal(state.prepare(input, true).required, true);
  state.prepare(shared, true).accept({ reviews: [dependency, review] });
  assert.equal(state.prepare(input, true).required, true);
  assert.throws(() => state.prepare(input, true).accept({ reviews: [review] }), /RESEARCH_REQUIRED/);
});

test("quote matching ignores layout whitespace but preserves words and intervening text", () => {
  const state = new IssueReconciliation();
  const formatted = { ...input, evidence: [{ identity: "s1", text: "Public events require permits.\n\nPrivate gatherings are exempt." }] };
  state.prepare(formatted, true).accept({ reviews: [review] });
  assert.equal(state.prepare(formatted, true).required, false);
  const annotated = { ...input, evidence: [{ identity: "s1", text: "Public events require permits. Amendment note. Private gatherings are exempt." }] };
  assert.throws(() => state.prepare(annotated, true).accept({ reviews: [review] }), /QUOTE_INVALID/);
  assert.throws(() => state.prepare(input, true).accept({ reviews: [{ ...review,
    passages: [{ ...review.passages[0], quote: "Publicevents require permits." }] }] }), /QUOTE_INVALID/);
  const separate = { ...input, evidence: [...input.evidence, { identity: "s2", text: "Applications go to the local authority." }] };
  assert.throws(() => state.prepare(separate, true).accept({ reviews: [{ ...review,
    passages: [{ ...review.passages[0], quote: "Applications go to the local authority." }] }] }), error => {
    assert.ok(error instanceof IssueReviewQuoteError);
    assert.deepEqual(error.matchingSourceIds, ["s2"]);
    return true;
  });
  assert.equal(state.prepare(separate, true).required, true);
});

test("native reconciliation schedules material dependency queries through the ordinary research turn", async () => {
  const session = new ProviderResearchSession();
  const operation: ModelOperation = { stage: "write", researchSession: true, instruction: "Synthetic fixture",
    signal: new AbortController().signal, schema: z.toJSONSchema(researchResponseSchema(true, true, "en", ["s1"])), input };
  const dependency = { ...review, disposition: "research_required", omissionsOrConflicts: ["Missing filing procedure."],
    researchQueries: [{ requirementId: "r1", query: "Public event filing procedure" }] };
  const prepared = session.prepare(operation, "{}");
  const result = await prepared.accept([{ type: "function_call", name: "reconcile_issues", call_id: "dependency",
    arguments: JSON.stringify({ reviews: [dependency] }) }]);
  assert.deepEqual(result, { turn: { decision: "research", content: null, gaps: [], actions: dependency.researchQueries, coverageUpdates: [] } });
  const next = session.prepare(operation, "{}");
  assert.equal(next.privateReview, false);
  assert.match(next.instruction, /Public event filing procedure/);
  await assert.rejects(() => next.restore({ turn: { decision: "answer" } }), /ISSUE_REVIEW_REQUIRED/);
});

test("native finalization requires review and a revision cannot reuse the prior receipt", async () => {
  const session = new ProviderResearchSession();
  const operation = (value: Record<string, unknown>): ModelOperation => ({ stage: "write", researchSession: true,
    instruction: "Synthetic fixture", signal: new AbortController().signal,
    schema: z.toJSONSchema(researchResponseSchema(true, true, "en", ["s1"])), input: value });
  const first = session.prepare(operation(input), "{}");
  assert.ok(first.tools.some(tool => tool.name === "reconcile_issues"));
  await assert.rejects(() => first.restore({ turn: { decision: "answer" } }), /ISSUE_REVIEW_REQUIRED/);
  await first.accept([{ type: "function_call", name: "reconcile_issues", call_id: "review", arguments: JSON.stringify({ reviews: [review] }) }]);
  const second = session.prepare(operation(input), "{}");
  const decisions = (schema: unknown) => JSON.stringify(schema).includes('"const":"answer"');
  assert.equal(decisions(second.schema), true);
  const changed = session.prepare(operation({ ...input, publishedIssues: [{ ...issue, version: "2" }], canResearch: false }), "{}");
  assert.equal(decisions(changed.schema), false);
  assert.ok(changed.tools.some(tool => tool.name === "reconcile_issues"));
});

test("native review quote errors receive bounded correction feedback without confirming the issue", async () => {
  const session = new ProviderResearchSession();
  const operation: ModelOperation = { stage: "write", researchSession: true, instruction: "Synthetic fixture",
    signal: new AbortController().signal, schema: z.toJSONSchema(researchResponseSchema(true, true, "en", ["s1"])), input };
  const invalid = { type: "function_call", name: "reconcile_issues", call_id: "bad-quote",
    arguments: JSON.stringify({ reviews: [{ ...review, passages: [{ ...review.passages[0], quote: "A stitched or invented quote." }] }] }) };
  for (let index = 0; index < 2; index++) {
    const prepared = session.prepare(operation, "{}");
    await prepared.accept([invalid]);
    const next = session.prepare(operation, "{}");
    assert.match(JSON.stringify(next.input), /ISSUE_REVIEW_QUOTE_INVALID/);
    assert.match(JSON.stringify(next.input), /passageIndex/);
    await assert.rejects(() => next.restore({ turn: { decision: "answer" } }), /ISSUE_REVIEW_REQUIRED/);
  }
  await assert.rejects(() => session.prepare(operation, "{}").accept([invalid]), /PROVIDER_TOOL_CORRECTION_LIMIT/);
});

test("review repair locates an invalid public qualification without accepting or rewriting it", async () => {
  const session = new ProviderResearchSession();
  const operation: ModelOperation = { stage: "write", researchSession: true, instruction: "Fixture",
    signal: new AbortController().signal, schema: z.toJSONSchema(researchResponseSchema(true, true, "en", ["s1"])), input };
  const invalid = { ...review, claims: [{ ...review.claims[0], qualifications: [{ ...review.claims[0].qualifications[0],
    publicWording: "Public ... events" }] }] };
  await session.prepare(operation, "{}").accept([{ type: "function_call", name: "reconcile_issues", call_id: "invalid-span",
    arguments: JSON.stringify({ reviews: [invalid] }) }]);
  const repair = session.prepare(operation, "{}");
  const feedback = JSON.parse(JSON.stringify(repair.input));
  assert.deepEqual(JSON.parse(feedback[0].content[0].text).issueReviewError, {
    code: "ISSUE_REVIEW_QUALIFICATION_SPAN_INVALID", reviewIndex: 0, claimIndex: 0, qualificationIndex: 0,
  });
  await assert.rejects(() => repair.restore({ turn: { decision: "answer" } }), /ISSUE_REVIEW_REQUIRED/);
  await repair.accept([{ type: "function_call", name: "reconcile_issues", call_id: "corrected-span",
    arguments: JSON.stringify({ reviews: [review] }) }]);
  assert.ok(JSON.stringify(session.prepare(operation, "{}").schema).includes('"const":"answer"'));
  assert.equal(issue.content.explanation, "Public events require permits.");
});
