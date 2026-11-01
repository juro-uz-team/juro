import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { researchResponseSchema, type ModelOperation } from "../lib/legal-answer-workflow/contracts";
import { ProviderResearchSession } from "../lib/legal-answer-workflow/provider-research-session";
import { createEvidenceCompactor } from "../lib/legal-answer-workflow/model-identities";
import { issuedResearchTurn, IssueWriting, type IssueUpdate } from "../lib/legal-answer-workflow/issue-writing";
import { readProviderResponse } from "../lib/legal-answer-workflow/provider-stream";
import { createResponsesModel } from "../lib/legal-answer-workflow/provider";

const issue = { title: "Permit", explanation: "Public events require a permit.", requirementIds: ["r"], sourceIds: ["s1"], actions: [] };
const update: IssueUpdate = { id: "permit", baseVersion: "0", change: "upsert", reason: "", sourceIds: ["s1"], content: issue };
const nativeUpdate = (value: IssueUpdate) => ({ ...value, content: value.content ? Object.fromEntries(Object.entries(value.content).filter(([key]) => key !== "sourceIds")) : null });
const call = (value: IssueUpdate, id = "call") => ({ type: "function_call", name: "write_issues", call_id: id, arguments: JSON.stringify({ updates: [nativeUpdate(value)] }) });
const law = "Public events require a permit; private gatherings are exempt.";
const reviewCall = (version: string, disposition = "confirmed") => ({ type: "function_call", name: "reconcile_issues", call_id: `review-${version}`,
  arguments: JSON.stringify({ reviews: [{ issueId: "permit", version,
    passages: [{ sourceId: "s1", quote: law, attachmentPage: null, ruleAndQualifications: law }],
    claims: [{ field: "explanation", actionIndex: null, publicClaim: "Public events", passageIndices: [0],
      qualifications: [{ qualification: "Public events", treatment: "preserved", publicWording: "Public events", reason: "The public claim states its scope." }] }],
    comparison: "Compare the public scope and the exception.", omissionsOrConflicts: disposition === "confirmed" ? [] : ["State the exception."], disposition }] }) });
const operation = (input: Record<string, unknown>): ModelOperation => ({ stage: "write", researchSession: true, instruction: "Synthetic fixture",
  signal: new AbortController().signal, schema: z.toJSONSchema(researchResponseSchema(true, true, "en", ["s1"])),
  input: { researchAgent: true, language: "en", issueWriting: true, evidence: [{ identity: "s1", text: law }],
    interpretation: { requirements: [{ id: "r" }] }, ...input } });

test("fresh review retains original conversation and all law/files, then rejoins the unchanged writer history", async () => {
  const session = new ProviderResearchSession();
  const context = { history: [{ role: "user", content: "ORIGINAL_CONVERSATION" }],
    privateDocuments: [{ id: "private", text: "ORIGINAL_PRIVATE_DOCUMENT" }], caseContext: { facts: ["ORIGINAL_FACT"] } };
  const file = { type: "input_file", filename: "original.pdf", detail: "high", file_data: "data:application/pdf;base64,ORIGINAL_FILE" };
  const first = session.prepare(operation(context), [{ type: "input_text", text: "Packet" },
    { type: "input_text", text: "Official source attachment: s1" }, file]);
  await first.accept([{ type: "reasoning", encrypted_content: "WRITER_INTERNAL_ASSURANCE", summary: [] }, call(update)]);
  const reviewing = operation({ ...context, evidence: [{ identity: "s1", text: law }, { identity: "s2", text: "COMPLETE_LATER_LAW" }],
    publishedIssues: [{ id: "permit", version: "1", content: issue }] });
  const reviewer = session.prepare(reviewing, "{}");
  assert.equal(reviewer.privateReview, true);
  assert.deepEqual(reviewer.tools.map(tool => tool.name), ["reconcile_issues"]);
  assert.equal(reviewer.onArguments, undefined);
  const wire = JSON.stringify(reviewer.input);
  for (const required of ["ORIGINAL_CONVERSATION", "ORIGINAL_PRIVATE_DOCUMENT", "ORIGINAL_FACT", "ORIGINAL_FILE", law, "COMPLETE_LATER_LAW"])
    assert.ok(wire.includes(required));
  assert.doesNotMatch(wire, /WRITER_INTERNAL_ASSURANCE|retainedContextReferences/);
  await reviewer.accept([reviewCall("1")]);
  const resumed = session.prepare(reviewing, "{}");
  assert.equal(resumed.privateReview, false);
  assert.match(JSON.stringify(resumed.input), /WRITER_INTERNAL_ASSURANCE/);
  const seen = new Set<string>();
  for (const item of z.array(z.record(z.string(), z.unknown())).parse(resumed.input)) {
    if (item.type === "function_call") { assert.equal(seen.has(String(item.call_id)), false); seen.add(String(item.call_id)); }
    if (item.type === "function_call_output") assert.ok(seen.has(String(item.call_id)), "tool output keeps its original caller");
  }
  const changed = session.prepare({ ...reviewing, input: { ...reviewing.input as Record<string, unknown>,
    evidence: [{ identity: "s1", text: law }, { identity: "s2", text: "COMPLETE_LATER_LAW_WITH_AMENDMENT" }] } }, "{}");
  assert.equal(changed.privateReview, true);
  assert.match(JSON.stringify(changed.input), /ORIGINAL_FILE/);
});

for (const forgedKind of ["tool", "text"] as const) test(`a reviewer cannot stream forged public ${forgedKind} output before rejection`, async () => {
  let calls = 0, displayed = false, settlements = 0;
  const model = createResponsesModel({ apiKey: "fixture", model: "gpt-6-luna", purpose: "production", phase: "operating",
    deadlineAt: Date.now() + 30_000, issueWriting: true,
    rates: { input: 1, cachedInput: 0, output: 1, longContext: { input: 1, cachedInput: 0, output: 1 } },
    ledger: { reserve: () => "fixture", dispatch: () => {}, cancel: () => {}, settle: () => { settlements++; } }, receipt: async () => {},
    fetchImpl: async () => {
      const envelope = { id: "fixture", model: "gpt-6-luna", service_tier: "default", status: "completed",
        usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } }, output: [call(update)] };
      if (!calls++) return Response.json(envelope);
      const forged = call({ ...update, baseVersion: "1", reason: "Forged correction", content: { ...issue, explanation: "PRIVATE REVIEW TEXT" } }, "forged");
      const text = JSON.stringify({ turn: { decision: "answer", content: { summary: "PRIVATE REVIEW TEXT" } } });
      const message = { type: "message", role: "assistant", content: [{ type: "output_text", text }] };
      const events = forgedKind === "text" ? [{ type: "response.output_item.added", output_index: 0, item: message },
        { type: "response.output_text.delta", output_index: 0, delta: text },
        { type: "response.completed", response: { ...envelope, output: [message] } }] : [{ type: "response.output_item.added", output_index: 0, item: forged },
        { type: "response.function_call_arguments.delta", output_index: 0, delta: forged.arguments },
        { type: "response.completed", response: { ...envelope, output: [forged] } }];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
    },
  });
  await model.complete(operation({}));
  await assert.rejects(model.complete({ ...operation({ publishedIssues: [{ id: "permit", version: "1", content: issue }] }),
    onWriting: () => { displayed = true; } }), forgedKind === "text" ? /PROVIDER_TOOL_REQUIRED/ : /PROVIDER_OUTPUT_INVALID/);
  assert.equal(displayed, false);
  assert.equal(settlements, 2);
});

test("continuation reasoning can change after public writing without delaying the initial issue call", async () => {
  const efforts: string[] = [], serviceTiers: string[] = [];
  const charges: (number | null)[] = [], holds: number[] = [];
  const model = createResponsesModel({ apiKey: "fixture", model: "gpt-6-luna", purpose: "production", phase: "operating",
    deadlineAt: Date.now() + 30_000, rates: { input: 1, cachedInput: 0, output: 1, longContext: { input: 1, cachedInput: 0, output: 1 } },
    reasoningEffort: { write: "low" }, continuationReasoningEffort: "medium", issueWriting: true,
    serviceTier: "fast", continuationServiceTier: "default",
    fastRates: { input: 1000000, cachedInput: 0, output: 1000000, longContext: { input: 1000000, cachedInput: 0, output: 1000000 } },
    ledger: { reserve: input => { holds.push(input.maximumMicrousd); return "fixture"; }, dispatch: () => {}, settle: (_id, amount) => { charges.push(amount); }, cancel: () => {} }, receipt: async () => {},
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      efforts.push(request.reasoning.effort); serviceTiers.push(request.service_tier);
      return Response.json({ id: "fixture", model: "gpt-6-luna", service_tier: request.service_tier, status: "completed",
        usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
        output: efforts.length === 1 ? [call(update)] : [reviewCall("1")] });
    } });
  await model.complete(operation({ publishedIssues: [] }));
  await model.complete(operation({ canResearch: false, publishedIssues: [{ id: "permit", version: "1", content: issue }] }));
  assert.deepEqual(efforts, ["low", "medium"]);
  assert.deepEqual(serviceTiers, ["fast", "default"]);
  assert.deepEqual(charges, [110, 1]);
  assert.deepEqual(holds, [2625000, 3]);
});

test("the issue tool enforces Uzbek Latin prose before streaming or accepting it", async () => {
  let shown = false;
  const op = operation({ language: "uz" }); op.onWriting = () => { shown = true; };
  const prepared = new ProviderResearchSession().prepare(op, "{}");
  const invalid = { ...update, content: { ...issue, title: "Рухсат" } };
  assert.equal(z.fromJSONSchema(prepared.tools.find(tool => tool.name === "write_issues")!.parameters).safeParse({ updates: [invalid] }).success, false);
  await assert.rejects(() => prepared.accept([call(invalid)]));
  assert.ok(prepared.onArguments);
  assert.throws(() => prepared.onArguments!("write_issues", call(invalid).arguments, 0));
  assert.equal(shown, false);
});

test("published issues cannot silently erase an unresolved requirement, but an explicit relevance revision can remove it", async () => {
  const op = operation({ interpretation: { requirements: [{ id: "r" }, { id: "other" }] }, coverageRecords: [],
    publishedIssues: [{ id: "permit", version: "1", content: issue }] });
  const firstSession = new ProviderResearchSession();
  const first = firstSession.prepare(op, "{}");
  assert.equal(first.tool_choice, "required");
  await assert.rejects(() => first.accept([]), /PROVIDER_TOOL_REQUIRED/);
  const decisions = (schema: Record<string, unknown>) => z.object({ properties: z.object({ turn: z.object({ anyOf: z.array(
    z.object({ properties: z.object({ decision: z.object({ const: z.string() }) }) })
  ) }) }) }).parse(schema).properties.turn.anyOf.map(branch => branch.properties.decision.const);
  assert.ok(!decisions(first.schema).includes("answer"));
  const dropped = { id: "other", issue: "A different regime", relevance: "The complete law applies this requirement only to a different actor.",
    status: "dropped", sourceIds: ["s1"], dependency: "", nextAction: "" };
  await first.accept([reviewCall("1")]);
  const writer = firstSession.prepare(op, "{}");
  await assert.rejects(() => writer.accept([{ type: "function_call", name: "write_issues", call_id: "blank",
    arguments: JSON.stringify({ updates: [], coverageUpdates: [{ ...dropped, relevance: "  " }] }) }]));
  await writer.accept([{ type: "function_call", name: "write_issues", call_id: "scope", arguments: JSON.stringify({ updates: [], coverageUpdates: [dropped] }) }]);
  const reviewed = new ProviderResearchSession();
  const reviewedOperation = operation({ ...op.input as Record<string, unknown>, coverageRecords: [dropped] });
  await reviewed.prepare(reviewedOperation, "{}").accept([reviewCall("1")]);
  const next = reviewed.prepare(reviewedOperation, "{}");
  assert.ok(decisions(next.schema).includes("answer"));
  assert.equal(next.tool_choice, undefined);
  const closed = new ProviderResearchSession().prepare(operation({ ...op.input as Record<string, unknown>, canResearch: false }), "{}");
  assert.equal(closed.tool_choice, "required");
});

test("native issue tool permits explicit revisions after acquisition closes and final assembly preserves their exact content", async () => {
  const session = new ProviderResearchSession();
  const first = session.prepare(operation({}), "{}");
  assert.ok(first.tools.some(tool => tool.name === "write_issues"));
  assert.equal(z.fromJSONSchema(first.tools.find(tool => tool.name === "write_issues")!.parameters).safeParse({ updates: [nativeUpdate(update)], coverageUpdates: [] }).success, true);
  const accepted = await first.accept([call(update)]);
  assert.ok(accepted && typeof accepted === "object" && issuedResearchTurn in accepted);
  const revised: IssueUpdate = { ...update, baseVersion: "1", reason: "The exception excludes private gatherings.",
    content: { ...issue, explanation: "Public events require a permit; private gatherings are exempt." } };
  const reviewedOperation = operation({ canResearch: false, publishedIssues: [{ id: "permit", version: "1", content: issue }] });
  const review = session.prepare(reviewedOperation, "{}");
  assert.deepEqual(review.tools.map(tool => tool.name), ["reconcile_issues"]);
  await review.accept([reviewCall("1", "revision_required")]);
  const second = session.prepare(reviewedOperation, "{}");
  assert.equal(second.privateReview, false);
  assert.deepEqual(second.tools.map(tool => tool.name), ["write_issues"]);
  await assert.rejects(() => second.accept([call(update)]), /ISSUE_VERSION_INVALID/);
  await second.accept([call(revised, "revision")]);
  const finalOperation = operation({ canResearch: false, issueCorrections: 1,
    publishedIssues: [{ id: "permit", version: "2", content: revised.content }] });
  await session.prepare(finalOperation, "{}").accept([reviewCall("2")]);
  const third = session.prepare(finalOperation, "{}");
  const final = { turn: { decision: "answer", content: { summary: "A qualified permit rule.", summarySourceIds: ["s1"],
    assumptions: [], conditionalBranches: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [],
    clarificationQuestions: [], urgency: "normal" }, gaps: [], actions: [] } };
  assert.equal(z.fromJSONSchema(third.schema).safeParse(final).success, true);
  const restored = await third.restore(final);
  assert.deepEqual(z.object({ turn: z.object({ content: z.object({ issues: z.array(z.unknown()) }) }) }).parse(restored).turn.content.issues, [revised.content]);
  await assert.rejects(() => third.restore({ turn: { ...final.turn, content: { ...final.turn.content, issues: [issue] } } }), /ISSUE_FINAL_RECONCILIATION/);
  assert.equal(z.fromJSONSchema(third.schema).safeParse({ turn: { ...final.turn,
    content: { ...final.turn.content, referenceNotes: Array(8).fill({ title: "Note", note: "Detail", sourceIds: ["s1"] }) } } }).success, false);
});

test("actual function argument SSE binds aliases before workflow projections and never exposes research arguments", async () => {
  const writing = new IssueWriting("en"), compact = createEvidenceCompactor();
  const canonical = "official-current-permit";
  const snapshots: string[] = [];
  const raw = operation({ evidence: [{ identity: canonical }] });
  raw.onWriting = draft => {
    assert.deepEqual(draft.issueUpdate!.sourceIds, [canonical]);
    snapshots.push(JSON.stringify(writing.project(draft.issueUpdate!, draft.blocks, new Set([canonical]))));
  };
  const mapped = compact(raw), session = new ProviderResearchSession().prepare(mapped.operation, "{}");
  const args = call(update).arguments;
  const split = args.indexOf("a permit") + 3;
  const frames = [
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", name: "research_law" } },
    { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"private":"never display"}' },
    { type: "response.output_item.added", output_index: 1, item: call(update) },
    { type: "response.function_call_arguments.delta", output_index: 1, delta: args.slice(0, split) },
    { type: "response.function_call_arguments.delta", output_index: 1, delta: args.slice(split) },
    { type: "response.completed", response: { status: "completed" } },
  ];
  await readProviderResponse(new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } }), raw.signal, undefined, undefined, session.onArguments);
  assert.ok(snapshots.length >= 2);
  assert.ok(!snapshots.join().includes("never display"));
  const result = mapped.restore(await session.accept([call(update)]));
  const updates = z.object({ issueUpdates: z.array(z.unknown()) }).parse(result).issueUpdates as IssueUpdate[];
  writing.commit(updates, new Set([canonical]), new Set(["r"]));
  assert.deepEqual(writing.published()[0].content!.sourceIds, [canonical]);
});

test("one source header binds streamed and restored issue prose without a second citation list", async () => {
  const op = operation({ evidence: [{ identity: "s1", text: law }, { identity: "s2", text: "Permit applications require identification." }] });
  const drafts: string[] = []; op.onWriting = draft => drafts.push(JSON.stringify(draft));
  const prepared = new ProviderResearchSession().prepare(op, "{}");
  const value: IssueUpdate = { ...update, sourceIds: ["s1", "s2"], content: { ...issue, sourceIds: ["s1", "s2"], explanation: "Public events need permits. Applications require identification. [s1] [s2]" } };
  const tool = call(value); const args = JSON.parse(tool.arguments);
  assert.equal(z.fromJSONSchema(prepared.tools.find(tool => tool.name === "write_issues")!.parameters).safeParse({ ...args, coverageUpdates: [] }).success, true);
  assert.equal(z.fromJSONSchema(prepared.tools.find(tool => tool.name === "write_issues")!.parameters).safeParse({ updates: [value], coverageUpdates: [] }).success, false);
  await assert.rejects(() => prepared.accept([{ ...tool, arguments: JSON.stringify({ updates: [{ ...nativeUpdate(value), content: { ...nativeUpdate(value).content, sourceIds: ["s1"] } }] }) }]));
  const invalidAction = { ...value, content: { ...value.content!, actions: [{ title: "Apply", description: "Present identification.", sourceIds: ["unread"] }] } };
  await assert.rejects(() => prepared.accept([call(invalidAction)]), /ISSUE_SUPPORT_INVALID/);
  assert.ok(prepared.onArguments);
  for (const char of tool.arguments) prepared.onArguments("write_issues", char, 0);
  assert.ok(drafts.length > 1);
  const result = z.object({ issueUpdates: z.array(z.object({ content: z.object({ sourceIds: z.array(z.string()), explanation: z.string() }) })) }).parse(await prepared.accept([tool]));
  assert.deepEqual(result.issueUpdates[0].content.sourceIds, ["s1", "s2"]);
  assert.equal(result.issueUpdates[0].content.explanation, "Public events need permits. Applications require identification.");
});

test("the opening offers supported writing or one explicit deferral before further research", async () => {
  const session = new ProviderResearchSession();
  const first = session.prepare(operation({}), "{}");
  assert.deepEqual(first.tools.map(tool => tool.name), ["write_issues", "defer_writing"]);
  await assert.rejects(() => first.accept([{ type: "function_call", name: "research_law", call_id: "hidden", arguments: "{}" }]), /PROVIDER_OUTPUT_INVALID/);
  await assert.rejects(() => first.accept([{ type: "function_call", name: "defer_writing", call_id: "blank", arguments: JSON.stringify({ reason: " " }) }]));
  assert.ok(session.prepare(operation({}), "{}").tools.some(tool => tool.name === "defer_writing"));
  const deferred = await first.accept([{ type: "function_call", name: "defer_writing", call_id: "defer",
    arguments: JSON.stringify({ reason: "The acquired provision concerns a different actor; the governing rule is still needed." }) }]);
  assert.ok(deferred && typeof deferred === "object" && issuedResearchTurn in deferred);
  const next = session.prepare(operation({}), "{}");
  assert.ok(next.tools.some(tool => tool.name === "research_law"));
  assert.ok(!next.tools.some(tool => tool.name === "defer_writing"));
  assert.ok(JSON.stringify(next.input).includes(law));
  await assert.rejects(() => next.accept([{ type: "function_call", name: "defer_writing", call_id: "again", arguments: JSON.stringify({ reason: "Again" }) }]), /PROVIDER_OUTPUT_INVALID/);
  const absent = new ProviderResearchSession().prepare(operation({ evidence: [] }), "{}");
  assert.deepEqual(absent.tools.map(tool => tool.name), ["research_law"]);
  const closed = new ProviderResearchSession().prepare(operation({ canResearch: false }), "{}");
  assert.deepEqual(closed.tools.map(tool => tool.name), ["write_issues"]);
});
