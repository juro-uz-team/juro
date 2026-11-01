import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { z } from "zod";
import { interpretationSchema, entrySchema, initialResearchSchema, assessmentSchema, writtenAnswerSchema } from "../lib/legal-answer-workflow/contracts";
import { createResponsesModel, type GenerationPricing, type GenerationReceipt } from "../lib/legal-answer-workflow/provider";
import type { ModelOperation } from "../lib/legal-answer-workflow/contracts";
import { maximumGenerationCalls, writtenAnswerForLanguage } from "../lib/legal-answer-workflow/contracts";
import { configureStatementCitations, restoreStatementCitations } from "../lib/legal-answer-workflow/provider-statement-citations";
import { ProviderResearchSession } from "../lib/legal-answer-workflow/provider-research-session";

const multilingualQueries = { en: "fixture rule", ru: "правило", "uz-Latn": "qoida" };

test("native citation formatting remembers literal tokens across compacted packets and clears them on finish", async () => {
  const session = new ProviderResearchSession();
  const prepare = (text: string) => session.prepare({ stage: "write", instruction: "Synthetic", researchSession: true,
    schema: { type: "object", properties: { turn: { anyOf: [{ properties: { decision: { const: "research" } } }] } } },
    signal: new AbortController().signal, input: { evidence: [{ identity: "s1", text }] } }, "{}");
  prepare("The literal token [s1] occurs in this source.");
  const current = prepare("Different complete evidence.");
  const value = { turn: { content: { issues: [{ explanation: [{ statement: "A rule. [s1]", sourceIds: ["s1"] }] }] } } };
  const explanation = (value: unknown) => z.object({ turn: z.object({ content: z.object({
    issues: z.array(z.object({ explanation: z.string() })),
  }) }) }).parse(value).turn.content.issues[0].explanation;
  assert.equal(explanation(await current.restore(value)), "A rule. [s1]");
  current.finish({ decision: "answer" });
  assert.equal(explanation(await prepare("New request.").restore(value)), "A rule.");
});

test("native candidate reads use only supplied navigation identities", async () => {
  const session = new ProviderResearchSession();
  const prepared = session.prepare({ stage: "write", instruction: "Synthetic", researchSession: true,
    schema: { type: "object", properties: { turn: { anyOf: [{ properties: { decision: { const: "research" } } }] } } },
    signal: new AbortController().signal, input: { evidence: [], unreadCandidates: [{ id: "c1", matches: [{ id: "c2" }] }],
      availableSections: [{ candidateId: "c3", sectionPosition: "7" }],
      interpretation: { requirements: [{ id: "question" }] } } }, "{}");
  const wire = z.fromJSONSchema(prepared.tools[0].parameters);
  for (const candidateId of ["c1", "c2", "c3", "invented"]) {
    for (const extra of [{}, { contains: "Synthetic heading" }, { sectionPosition: "7" }, { wholeSection: true }]) {
      assert.equal(wire.safeParse({ actions: [{ requirementId: "question", candidateId, ...extra }] }).success,
        candidateId !== "invented" && (!("sectionPosition" in extra) || candidateId === "c3"));
    }
  }
  const invalid = await prepared.accept([{ type: "function_call", call_id: "synthetic", name: "research_law",
    arguments: JSON.stringify({ actions: [{ requirementId: "question", candidateId: "invented" }] }) }]);
  assert.match(JSON.stringify(invalid), /CANDIDATE_NOT_OFFERED/);
  const empty = new ProviderResearchSession().prepare({ stage: "write", instruction: "Synthetic", researchSession: true,
    schema: { type: "object", properties: { turn: { anyOf: [{ properties: { decision: { const: "research" } } }] } } },
    signal: new AbortController().signal, input: { evidence: [], unreadCandidates: [] } }, "{}");
  const emptyWire = z.fromJSONSchema(empty.tools[0].parameters);
  assert.equal(emptyWire.safeParse({ actions: [{ requirementId: "question", candidateId: "c1" }] }).success, false);
  assert.equal(emptyWire.safeParse({ actions: [{ requirementId: "question", query: multilingualQueries }] }).success, true);
  const afterRead = session.prepare({ stage: "write", instruction: "Synthetic", researchSession: true,
    schema: { type: "object", properties: { turn: { anyOf: [{ properties: { decision: { const: "research" } } }] } } },
    signal: new AbortController().signal, input: { evidence: [], unreadCandidates: [] } }, "{}");
  const literal = { requirementId: "question", candidateId: "c1", contains: "Another heading" };
  assert.equal(z.fromJSONSchema(afterRead.tools[0].parameters).safeParse({ actions: [literal] }).success, true);
  assert.deepEqual(await afterRead.accept([{ type: "function_call", call_id: "retained", name: "research_law",
    arguments: JSON.stringify({ actions: [literal] }) }]), { turn: { decision: "research", content: null, gaps: [], actions: [literal] } });
  const large = session.prepare({ stage: "write", instruction: "Synthetic", researchSession: true,
    schema: { type: "object", properties: { turn: { anyOf: [{ properties: { decision: { const: "research" } } }] } } },
    signal: new AbortController().signal, input: { evidence: [],
      unreadCandidates: Array.from({ length: 1400 }, (_, index) => ({ id: `c${index + 1}` })) } }, "{}");
  const largeWire = z.fromJSONSchema(large.tools[0].parameters);
  assert.equal(largeWire.safeParse({ actions: [{ ...literal, candidateId: "c1400" }] }).success, true);
  assert.equal(largeWire.safeParse({ actions: [{ ...literal, candidateId: "c1401" }] }).success, false);
  assert.equal(JSON.stringify(large.tools[0].parameters).includes('"enum"'), false);
});

test("native research tools restrict navigation to offered handles including inactive retained sources", async () => {
  const prepared = new ProviderResearchSession().prepare({ stage: "write", instruction: "Synthetic", researchSession: true,
    schema: { type: "object", properties: { turn: { anyOf: [{ properties: { decision: { const: "research" } } }] } } },
    signal: new AbortController().signal, input: { evidence: [{ identity: "s1" }],
      availableEvidence: [{ identity: "s1" }, { identity: "s2" }],
      availableReferences: ["s1", "s2"].map(sourceId => ({ sourceId, url: "https://example.invalid/reference" })),
      interpretation: { requirements: [{ id: "question" }] } } }, "{}");
  const wire = z.fromJSONSchema(prepared.tools[0].parameters);
  for (const sourceId of ["s1", "s2", "never-offered"]) {
    for (const action of [{ requirementId: "question", referenceId: sourceId === "s1" ? "ref1" : sourceId === "s2" ? "ref2" : "ref999" },
      { requirementId: "question", selectSourceIds: [sourceId] }]) {
      assert.equal(wire.safeParse({ actions: [action] }).success, sourceId !== "never-offered" && !("selectSourceIds" in action));
    }
  }
  const call = (sourceId: string) => [{ type: "function_call", call_id: "synthetic", name: "research_law",
    arguments: JSON.stringify({ actions: [{ requirementId: "question", sourceId, url: "https://example.invalid/reference" }] }) }];
  assert.match(JSON.stringify(await prepared.accept(call("never-offered"))), /SOURCE_NOT_ACQUIRED/);
  assert.deepEqual(await prepared.accept(call("s2")), { turn: { decision: "research", content: null, gaps: [],
    actions: [{ requirementId: "question", sourceId: "s2", url: "https://example.invalid/reference" }] } });
});

const operation = (): ModelOperation => ({ stage: "interpret", instruction: "Return structured fixture data.",
  input: { question: "Artificial question" }, schema: { type: "object", properties: { ok: { type: "boolean" } },
    required: ["ok"], additionalProperties: false }, signal: new AbortController().signal });
function setup(fetchImpl: typeof fetch, rates: GenerationPricing = { input: 100_000, cachedInput: 10_000, output: 500_000 }, maximumRequestMicrousd?: number) {
  const events: string[] = [], charges: (number | null)[] = [];
  const receipts: GenerationReceipt[] = [];
  const model = createResponsesModel({ apiKey: "fixture-key", model: "gpt-6-luna", purpose: "qualification",
    phase: "final", deadlineAt: Date.now() + 30_000,
    rates, fetchImpl, maximumRequestMicrousd,
    ledger: { reserve: () => { events.push("reserve"); return "reservation"; },
      dispatch: () => { events.push("dispatch"); }, cancel: () => { events.push("cancel"); },
      settle: (_id, charge) => { events.push("settle"); charges.push(charge); } },
    receipt: async record => { events.push(record.event); receipts.push(record); },
  });
  return { model, events, charges, receipts };
}
const response = (status = "completed") => ({ id: "resp_fixture", model: "gpt-6-luna", service_tier: "default", status,
  usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 50 },
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"ok":true}' }] }] });

test("admission and ledger failures differ from transport without exposing private messages", async () => {
  for (const [message, expected] of [["private funding constraint", "PROVIDER_ADMISSION_FAILED"],
    ["SPENDING_POLICY_MISMATCH", "PROVIDER_LEDGER_FAILED"], ["PROVIDER_SPENDING_CAP", "PROVIDER_SPENDING_CAP"]]) {
    let dispatches = 0;
    const model = createResponsesModel({ apiKey: "fixture", model: "gpt-6-luna", purpose: "qualification", phase: "final",
      deadlineAt: Date.now() + 30_000, rates: { input: 100_000, cachedInput: 10_000, output: 500_000 },
      ledger: { reserve: () => { throw new Error(message); }, dispatch: () => { dispatches++; }, cancel: () => {}, settle: () => {} },
      receipt: async () => {}, fetchImpl: async () => { throw new Error("must not dispatch"); } });
    await assert.rejects(model.complete(operation()), { message: expected });
    assert.equal(dispatches, 0);
  }
});

test("statement composition retains source and language constraints and rejects lossy grouping", () => {
  const canonical = writtenAnswerForLanguage("uz", ["s1", "s2"]);
  const schema = z.toJSONSchema(canonical);
  configureStatementCitations(schema);
  const wire = z.fromJSONSchema(schema);
  const answer = { summary: "Qoida", summarySourceIds: ["s1"], issues: [{ title: "Qoida",
    explanation: [{ statement: "Birinchi qoida.", sourceIds: ["s1"] },
      { statement: "Ikkinchi qoida.", sourceIds: ["s2", "s1"] }], requirementIds: ["question"], actions: [] }],
    conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [],
    clarificationQuestions: [], urgency: "normal" };
  assert.equal(wire.safeParse(answer).success, true);
  const restore = (content: unknown) => (restoreStatementCitations({ turn: { content } }) as { turn: { content: unknown } }).turn.content;
  const grouped = canonical.parse(restore(answer));
  assert.equal(grouped.issues[0].explanation, "Birinchi qoida.\n\nIkkinchi qoida.");
  assert.deepEqual(grouped.issues[0].sourceIds, ["s1", "s2"]);
  for (const part of [{ statement: "Кирилл", sourceIds: ["s1"] }, { statement: "Qoida", sourceIds: ["s9"] },
    { statement: "Qoida", sourceIds: [] }, { statement: "Qoida", sourceIds: ["s1"], extra: true }]) {
    assert.equal(wire.safeParse({ ...answer, issues: [{ ...answer.issues[0], explanation: [part] }] }).success, false);
  }
  assert.throws(() => restore({ ...answer, issues: [{ ...answer.issues[0], sourceIds: ["s1"] }] }), /PROVIDER_OUTPUT_INVALID/);
  const oversized = { ...answer, issues: [{ ...answer.issues[0], explanation: [
    { statement: "a".repeat(2100), sourceIds: ["s1"] }, { statement: "b".repeat(2100), sourceIds: ["s2"] }] }] };
  assert.equal(canonical.safeParse(restore(oversized)).success, false);
});

test("native search preserves distinct material research questions and their stable identifiers", async () => {
  const search = { complexity: "difficult", needsClarification: false, queries: multilingualQueries,
    requirements: [{ id: "conditions", question: "Which conditions govern the requested decision?" },
      { id: "procedure", question: "Which procedure implements that decision?" }],
    scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
  const session = new ProviderResearchSession();
  const prepared = session.prepare({ ...operation(), researchSession: true, schema: z.toJSONSchema(entrySchema) }, "{}");
  const parameters = prepared.tools[0].parameters;
  assert((parameters.required as string[]).includes("requirements"));
  assert.match(JSON.stringify(prepared.schema), /"requirements"/);
  assert.equal(z.fromJSONSchema(parameters).safeParse(search).success, true);
  const result = await prepared.accept([{ type: "function_call", call_id: "search", name: "search_law",
    arguments: JSON.stringify(search) }]);
  assert.deepEqual(result, { conversationReply: null, interpretation: { ...search, queries: [...Object.values(multilingualQueries), "қоида"],
    requirements: search.requirements } });
});

test("native search rejects malformed or duplicate supplied research questions instead of replacing them", async () => {
  for (const requirements of [[], [{ id: "same", question: "First rule?" }, { id: "same", question: "Other rule?" }]]) {
    const fixture = setup(async () => Response.json({ ...response(), output: [{ type: "function_call",
      call_id: "search", name: "search_law", arguments: JSON.stringify({ complexity: "difficult", needsClarification: false,
        queries: multilingualQueries, requirements, scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] }) }] }),
      { input: 100_000, cachedInput: 10_000, output: 500_000,
        longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } });
    await assert.rejects(fixture.model.complete({ ...operation(), researchSession: true, schema: z.toJSONSchema(entrySchema) }), /PROVIDER_OUTPUT_INVALID/);
  }
});

test("native factual clarification retains validation and the complete long user question", async () => {
  for (const questions of [[], ["Which requested date applies?"]]) {
    const question = "Artificial question. ".repeat(250);
    const interpretation = { complexity: "difficult", needsClarification: true, queries: multilingualQueries,
      scopes: [{ kind: "historical", at: "2020-01-01" }], facts: [], clarificationQuestions: questions };
    const fixture = setup(async (_url, init) => {
      assert.equal(JSON.parse(JSON.parse(String(init?.body)).input[0].content).question, question);
      return Response.json({ ...response(), output: [{ type: "message", role: "assistant", content: [{ type: "output_text",
        text: JSON.stringify({ conversationReply: null, interpretation }) }] }] });
    }, { input: 100_000, cachedInput: 10_000, output: 500_000,
      longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } });
    const result = fixture.model.complete({ ...operation(), input: { question }, researchSession: true, schema: z.toJSONSchema(entrySchema) });
    if (!questions.length) await assert.rejects(result, /PROVIDER_OUTPUT_INVALID/);
    else assert.deepEqual(await result, { conversationReply: null, interpretation: { ...interpretation, queries: [...Object.values(multilingualQueries), "қоида"],
      requirements: [{ id: "question", question: "The complete user question supplied with this request." }] } });
  }
});

test("native research continues opaque provider state and exact tool associations without stored responses", async () => {
  const interpretation = { complexity: "simple", needsClarification: false, requirements: [{ id: "question", question: "Artificial question" }],
    queries: [...Object.values(multilingualQueries), "қоида"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
  const reasoning = { id: "rs_fixture", type: "reasoning", summary: [], encrypted_content: "opaque-fixture" };
  const call = { type: "function_call", id: "fc_fixture", call_id: "call_search", name: "search_law",
    arguments: JSON.stringify({ ...interpretation, queries: multilingualQueries, requirements: undefined }), status: "completed" };
  let count = 0;
  const fixture = setup(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.equal(body.previous_response_id, undefined);
    assert.equal(body.reasoning.context, undefined);
    if (!count++) {
      assert.equal(body.tools[0].name, "search_law");
      return Response.json({ ...response(), output: [reasoning, call] });
    }
    assert.deepEqual(body.input[1], reasoning);
    assert.deepEqual(body.input[2], call);
    assert.equal(body.input[3].type, "function_call_output");
    assert.equal(body.input[3].call_id, "call_search");
    if (count === 3) {
      assert.equal(JSON.parse(body.input[3].output).packet.unreadCandidates[0].id, "c1");
      const result = body.input.at(-1);
      assert.equal(result.call_id, "call_read");
      assert.equal(JSON.parse(result.output).packet.evidence[0].text, "Complete fixture rule with its exception.");
      assert.equal(JSON.parse(result.output).packet.evidence[0].identity, "s1");
      assert.equal(z.fromJSONSchema(body.text.format.schema).safeParse({ turn: { decision: "research", content: null,
        gaps: [], actions: [{ requirementId: "r", candidateId: "c1" }] } }).success, false);
      return Response.json({ ...response(), output: [{ type: "message", role: "assistant", phase: "final_answer",
        content: [{ type: "output_text", text: JSON.stringify({ turn: { decision: "answer", actions: [], gaps: [], content: {
          summary: "Qualified rule", summarySourceIds: ["s1"], issues: [{ title: "Rule", explanation: [
            { statement: "Rule and exception", sourceIds: ["s1"] },
            { statement: "A separate notice duty.", sourceIds: ["s2"] }],
            requirementIds: ["r"], actions: [] }], conditionalBranches: [], assumptions: [], risks: [],
          deadlines: [], requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal",
        } } }) }] }] });
    }
    assert.equal(JSON.parse(body.input[3].output).packet.unreadCandidates[0].id, "c1");
    return Response.json({ ...response(), output: [{ type: "function_call", id: "fc_read", call_id: "call_read",
      name: "research_law", arguments: JSON.stringify({ actions: [{ requirementId: "r", candidateId: "c1" }] }), status: "completed" }] });
  }, { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } });
  assert.deepEqual(await fixture.model.complete({ ...operation(), researchSession: true,
    schema: z.toJSONSchema(entrySchema) }), { conversationReply: null, interpretation });
  assert.deepEqual(await fixture.model.complete({ ...operation(), researchSession: true, stage: "write",
    input: { researchAgent: true, evidence: [], unreadCandidates: [{ id: "c1" }], canResearch: true } }), {
    decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", candidateId: "c1" }],
  });
  const answer = await fixture.model.complete({ ...operation(), researchSession: true, stage: "write", input: {
    researchAgent: true, canResearch: true, evidence: [{ identity: "canonical-rule", text: "Complete fixture rule with its exception." },
      { identity: "canonical-notice", text: "Separate complete notice provision." }],
    availableEvidence: [{ identity: "canonical-rule" }],
  } });
  assert.deepEqual((answer as { content: { summarySourceIds: string[] } }).content.summarySourceIds, ["canonical-rule"]);
  assert.deepEqual((answer as { content: { issues: unknown[] } }).content.issues, [{ title: "Rule",
    explanation: "Rule and exception\n\nA separate notice duty.", requirementIds: ["r"],
    sourceIds: ["canonical-rule", "canonical-notice"], actions: [] }]);
  assert.deepEqual(fixture.charges, [34, 34, 34]);
  assert.equal(fixture.receipts.find(item => item.stage === "write")?.maximumMicrousd, 527_500);
  assert.doesNotMatch(JSON.stringify(fixture.receipts), /opaque-fixture|fixture rule/);
});

test("native file continuation supplies complete law once alongside its exact original file", async () => {
  const bytes = Buffer.from("%PDF-1.7 complete fixture"), sha256 = createHash("sha256").update(bytes).digest("hex");
  const otherBytes = Buffer.from("%PDF-1.7 second complete fixture"), otherSha256 = createHash("sha256").update(otherBytes).digest("hex");
  const completeText = "Complete fixture rule. ".repeat(20_000);
  let calls = 0;
  const fixture = setup(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (calls++) {
      const result = body.input.findLast((item: { type?: string }) => item.type === "function_call_output");
      assert.equal(JSON.parse(result.output).packet.evidence[0].text, completeText);
      const attachment = body.input.at(-1).content;
      assert.deepEqual(attachment.filter((item: { type: string }) => item.type === "input_text"),
        [{ type: "input_text", text: "Official source attachment: s1" }, { type: "input_text", text: "Official source attachment: s2" }]);
      assert.equal(attachment.filter((item: { type: string }) => item.type === "input_file").length, 2);
      assert.equal(attachment.find((item: { type: string }) => item.type === "input_file").file_data,
        `data:application/pdf;base64,${bytes.toString("base64")}`);
      assert.equal(attachment[2].text, "Official source attachment: s2");
      assert.equal(attachment[3].file_data, `data:application/pdf;base64,${otherBytes.toString("base64")}`);
      assert.equal(JSON.stringify(body).split(completeText).length - 1, 1);
    }
    return Response.json({ ...response(), output: [{ type: "function_call", call_id: `read_${calls}`,
      name: "research_law", arguments: JSON.stringify({ actions: [{ requirementId: "r", candidateId: "c1" }] }) }] });
  }, { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } });
  const research = { ...operation(), stage: "write" as const, researchSession: true };
  await fixture.model.complete({ ...research, input: { researchAgent: true, evidence: [], unreadCandidates: [{ id: "c1" }] } });
  await fixture.model.complete({ ...research, sourceFiles: [{ sourceId: "source", sha256, bytes },
    { sourceId: "other", sha256: otherSha256, bytes: otherBytes }],
    input: { researchAgent: true, unreadCandidates: [{ id: "c1" }], evidence: [{ identity: "source", text: completeText }, { identity: "other", text: "Complete second rule." }],
      availableEvidence: [{ identity: "source" }, { identity: "other" }] } });
  assert.equal(calls, 2);
  assert.deepEqual(fixture.charges, [34, 34]);
});

test("invalid received research output is billed once and distinguished from transport failure", async () => {
  for (const text of ["{", JSON.stringify({ turn: { decision: "research", content: null, gaps: [], actions: [] } })]) {
    const envelope = response(); envelope.output[0].content[0].text = text;
    const fixture = setup(async () => Response.json(envelope));
    await assert.rejects(fixture.model.complete({ ...operation(), stage: "write",
      input: { researchAgent: true, evidence: [] } }), /PROVIDER_OUTPUT_INVALID/);
    assert.deepEqual(fixture.charges, [34]);
    assert.equal(fixture.receipts.at(-1)?.errorCode, "PROVIDER_OUTPUT_INVALID");
  }
});

test("native research binds requirement references to the supplied plan rather than accepting prose IDs", async () => {
  const fixture = setup(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const schema = z.fromJSONSchema(body.tools[0].parameters);
    assert.equal(schema.safeParse({ actions: [{ requirementId: "challenge", query: multilingualQueries }] }).success, true);
    assert.equal(schema.safeParse({ actions: [{ requirementId: "Find current procedure", query: multilingualQueries }] }).success, false);
    return Response.json({ ...response(), output: [{ type: "function_call", call_id: "bad_requirement", name: "research_law",
      arguments: JSON.stringify({ actions: [{ requirementId: "Find current procedure", query: multilingualQueries }] }) }] });
  }, { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } });
  const corrected = await fixture.model.complete({ ...operation(), stage: "write", researchSession: true,
    input: { researchAgent: true, interpretation: { requirements: [{ id: "challenge", question: "Procedure?" }] }, evidence: [] } });
  assert.match(JSON.stringify(corrected), /REQUIREMENT_NOT_OFFERED/);
  assert.deepEqual(fixture.charges, [34]);
});

test("native continuation preserves earlier complete law and original file attachments", async () => {
  const bytes = Buffer.from("%PDF-1.7 complete fixture"), sha256 = createHash("sha256").update(bytes).digest("hex");
  let calls = 0;
  const fixture = setup(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (!calls++) return Response.json({ ...response(), output: [{ type: "function_call", call_id: "select_empty",
      name: "research_law", arguments: JSON.stringify({ actions: [{ requirementId: "r", sourceId: "s1", url: "https://example.invalid/reference" }] }) }] });
    assert.match(JSON.stringify(body.input), /file_data/);
    assert.ok(JSON.stringify(body.input).includes(bytes.toString("base64")));
    assert.ok(JSON.stringify(body.input).includes("PDF law"));
    const latest = JSON.parse(body.input.at(-1).output).packet;
    assert.deepEqual(latest.evidence, []);
    assert.equal(latest.availableEvidence[0].identity, "s1");
    return Response.json({ ...response(), output: [{ type: "function_call", call_id: "reopen",
      name: "research_law", arguments: JSON.stringify({ actions: [{ requirementId: "r", sourceId: "s1", url: "https://example.invalid/reference" }] }) }] });
  }, { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } });
  const research = { ...operation(), stage: "write" as const, researchSession: true };
  await fixture.model.complete({ ...research, sourceFiles: [{ sourceId: "source", sha256, bytes }],
    input: { researchAgent: true, evidence: [{ identity: "source", text: "PDF law" }], availableEvidence: [{ identity: "source" }] } });
  const result = await fixture.model.complete({ ...research,
    input: { researchAgent: true, evidence: [], availableEvidence: [{ identity: "source" }] } });
  assert.deepEqual((result as { actions: unknown[] }).actions, [{ requirementId: "r", sourceId: "source", url: "https://example.invalid/reference" }]);
});

test("native continuation retains each identical source attachment once without losing new files or bindings", async () => {
  const session = new ProviderResearchSession();
  const op = { ...operation(), stage: "write" as const, researchSession: true,
    schema: { type: "object", properties: { turn: { anyOf: [{ properties: { decision: { const: "research" } } }] } } },
    input: { researchAgent: true, evidence: [{ identity: "s1", text: "Complete fixture law" }], availableEvidence: [{ identity: "s1" }] } };
  const attachment = (source: string, data: string) => [{ type: "input_text", text: `Official source attachment: ${source}` },
    { type: "input_file", filename: "fixture.pdf", detail: "high", file_data: data }];
  const original = attachment("s1", "data:application/pdf;base64,original");
  const prepare = (parts = original) => session.prepare(op, [{ type: "input_text", text: "Packet" }, ...parts]);
  const accept = async (prepared: ReturnType<typeof prepare>, id: string) => prepared.accept([{ type: "function_call",
    name: "research_law", call_id: id, arguments: JSON.stringify({ actions: [{ requirementId: "r", sourceId: "s1", url: "https://example.invalid/reference" }] }) }]);
  const files = (prepared: ReturnType<typeof prepare>) => JSON.stringify(prepared.input).match(/"type":"input_file"/gu)?.length ?? 0;
  await accept(prepare(), "first");
  const repeated = prepare();
  assert.equal(files(repeated), 1);
  assert.match(JSON.stringify(repeated.input), /Complete fixture law/);
  await accept(repeated, "second");
  assert.equal(files(prepare()), 1);
  const changed = [...original, ...attachment("s1", "data:application/pdf;base64,changed")];
  assert.equal(files(prepare(changed)), 2);
  assert.equal(files(prepare(changed)), 2, "preparing without acceptance must not mark a new file retained");
  const newBinding = prepare([...original, ...attachment("s2", original[1].file_data!)]);
  assert.equal(files(newBinding), 2, "a distinct source association remains explicit");
  await accept(newBinding, "third");
  assert.equal(files(prepare([...original, ...attachment("s2", original[1].file_data!)])), 2);
});

test("explicit final messages are parsed independently of commentary while ambiguous outputs remain rejected", async () => {
  const message = (phase?: string | null, text = '{"ok":true}') => ({ type: "message", role: "assistant", phase,
    content: [{ type: "output_text", text }] });
  for (const output of [
    [message("commentary", "Progress only"), message("final_answer")],
    [message(null)],
  ]) {
    const fixture = setup(async () => Response.json({ ...response(), output }));
    assert.deepEqual(await fixture.model.complete(operation()), { ok: true });
    assert.deepEqual(fixture.charges, [34]);
  }
  for (const output of [[message(), message()], [message("final_answer"), message("final_answer")],
    [message("commentary")], [message("unknown"), message("final_answer")]]) {
    const fixture = setup(async () => Response.json({ ...response(), output }));
    await assert.rejects(fixture.model.complete(operation()), /PROVIDER_OUTPUT_INVALID/);
    assert.deepEqual(fixture.charges, [34]);
  }
});

test("reasoning token diagnostics preserve total-output accounting and remain optional", async () => {
  for (const details of [undefined, null, {}, { reasoning_tokens: null }, { reasoning_tokens: 30 }]) {
    const envelope = response();
    const fixture = setup(async () => Response.json({ ...envelope,
      usage: { ...envelope.usage, ...(details !== undefined ? { output_tokens_details: details } : {}) } }));
    await fixture.model.complete(operation());
    const usage = fixture.receipts.find(item => item.event === "usage")!;
    assert.equal(usage.outputTokens, 50);
    assert.equal(usage.reasoningTokens, details && "reasoning_tokens" in details && typeof details.reasoning_tokens === "number"
      ? details.reasoning_tokens : undefined);
    assert.deepEqual(fixture.charges, [34]);
  }
});

test("a request spending ceiling stops before dispatch when its next worst-case reservation cannot fit", async () => {
  const fixture = setup(async () => { throw new Error("Must not dispatch"); }, undefined, 100);
  await assert.rejects(fixture.model.complete(operation()), /PROVIDER_REQUEST_BUDGET/);
  assert.deepEqual(fixture.events, []);
});

test("complete-document text above the former byte ceiling is dispatched intact with full-window funding", async () => {
  const text = "ж".repeat(450_000);
  const rates = { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } };
  const fixture = setup(async (_url, init) => {
    assert.equal(JSON.parse(JSON.parse(String(init?.body)).input[0].content).document, text);
    return Response.json(response());
  }, rates);
  await fixture.model.complete({ ...operation(), stage: "assess", input: { document: text } });
  assert.equal(fixture.receipts[0].maximumMicrousd, 526_250);
});

test("standard processing is explicit and unexpected premium tiers fail closed", async () => {
  const rates = { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } };
  for (const served of ["fast", "default", "unrecognized"]) {
    const fixture = setup(async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).service_tier, "default");
      return Response.json({ ...response(), service_tier: served });
    }, rates);
    if (served !== "default") {
      await assert.rejects(() => fixture.model.complete({ ...operation(), stage: "assess" }), /PROVIDER_USAGE_INVALID/);
      assert.deepEqual(fixture.charges, [null]);
    } else {
      assert.deepEqual(await fixture.model.complete({ ...operation(), stage: "assess" }), { ok: true });
      assert.deepEqual(fixture.charges, [34]);
      assert.equal(fixture.receipts[0].requestedServiceTier, "default");
      assert.equal(fixture.receipts.find(item => item.event === "settled")?.serviceTier, served);
      assert.deepEqual(fixture.receipts.find(item => item.event === "usage")?.rates,
        {
          input: rates.input, cachedInput: rates.cachedInput, output: rates.output });
    }
    assert.equal(fixture.receipts[0].maximumMicrousd, 526_250);
  }
});

test("fast processing reserves premium pricing and settles the served tier including fallback", async () => {
  const rates = { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } };
  const fastRates = { input: 200_000, cachedInput: 20_000, output: 1_000_000,
    longContext: { input: 400_000, cachedInput: 40_000, output: 1_500_000 } };
  for (const inputTokens of [100, 300_000]) for (const served of ["fast", "priority", "default", "unrecognized"]) {
    const records: GenerationReceipt[] = [];
    const charges: (number | null)[] = [];
    const model = createResponsesModel({ apiKey: "fixture", model: "gpt-6-luna", purpose: "production", phase: "operating",
      deadlineAt: Date.now() + 30_000, rates, serviceTier: "fast", fastRates,
      ledger: { reserve: () => "fixture", dispatch: () => {}, cancel: () => {}, settle: (_id, value) => { charges.push(value); } },
      receipt: async record => { records.push(record); }, fetchImpl: async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).service_tier, "fast");
        const envelope = response();
        return Response.json({ ...envelope, service_tier: served, usage: { ...envelope.usage, input_tokens: inputTokens } });
      } });
    if (served === "unrecognized") {
      await assert.rejects(model.complete({ ...operation(), stage: "assess" }), /PROVIDER_USAGE_INVALID/);
      assert.deepEqual(charges, [null]);
    } else {
      await model.complete({ ...operation(), stage: "assess" });
      assert.deepEqual(charges, [inputTokens === 100 ? served === "default" ? 34 : 67 : served === "default" ? 60_034 : 120_068]);
      assert.equal(records.find(item => item.event === "usage")?.serviceTier, served === "default" ? "default" : "fast");
    }
    assert.equal(records[0].maximumMicrousd, 1_052_500);
    assert.equal(records[0].requestedServiceTier, "fast");
  }
});

test("fast processing requires complete premium pricing before admission", () => {
  for (const fastRates of [undefined, { input: 2, cachedInput: 0, output: 2 }]) {
    assert.throws(() => createResponsesModel({ apiKey: "fixture", model: "gpt-6-luna", purpose: "production", phase: "operating",
      deadlineAt: Date.now() + 30_000, rates: { input: 1, cachedInput: 0, output: 1, longContext: { input: 2, cachedInput: 0, output: 2 } },
      serviceTier: "fast", fastRates,
      ledger: { reserve: () => { throw new Error("Must not admit"); }, dispatch: () => {}, settle: () => {}, cancel: () => {} },
      receipt: async () => {},
    }), /PROVIDER_CONFIGURATION_INVALID/);
  }
});

test("standard usage includes long-context and cache-write premiums before a cache-policy failure", async () => {
  const fixture = setup(async () => Response.json({ ...response(), usage: {
    input_tokens: 300_000, output_tokens: 50, input_tokens_details: { cached_tokens: 20_000,
      cache_write_tokens: 1000, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 1000 } },
  } }), { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } });
  await assert.rejects(() => fixture.model.complete({ ...operation(), stage: "assess" }), /PROVIDER_CACHE_POLICY_MISMATCH/);
  assert.deepEqual(fixture.charges, [56_738]);
  assert.equal(fixture.receipts.find(item => item.event === "usage")?.serviceTier, "default");
  assert.equal(fixture.receipts.at(-1)?.event, "failed");
});

test("provider uses compact source labels on the wire and restores authenticated identities after billing", async () => {
  const identity = `official:${"a".repeat(64)}`;
  const fixture = setup(async (_url, init) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    assert.equal(input.evidence[0].identity, "s1");
    assert.equal(input.evidence[0].text, "Complete artificial source text.");
    const envelope = response();
    envelope.output[0].content[0].text = JSON.stringify({ support: [{ requirementId: "r1", sourceIds: ["s1"] }],
      selectedIds: ["s1"], gaps: [], recovery: [] });
    return Response.json(envelope);
  });
  const result = assessmentSchema.parse(await fixture.model.complete({ ...operation(), stage: "assess",
    schema: z.toJSONSchema(assessmentSchema), input: { evidence: [{ identity, text: "Complete artificial source text." }] } }));
  assert.deepEqual(result.selectedIds, [identity]);
  assert.deepEqual(result.support[0].sourceIds, [identity]);
  assert.ok(fixture.receipts.some(item => item.event === "settled"));
});

test("Luna defaults every stage to low reasoning under standard processing", async () => {
  const efforts: unknown[] = [];
  const tiers: unknown[] = [];
  const fixture = setup(async (_url, init) => {
    efforts.push(JSON.parse(String(init?.body)).reasoning.effort);
    tiers.push(JSON.parse(String(init?.body)).service_tier);
    return Response.json(response());
  });
  for (const stage of ["interpret", "select", "assess", "write"] as const) {
    await fixture.model.complete({ ...operation(), stage });
  }
  assert.deepEqual(efforts, ["low", "low", "low", "low"]);
  assert.deepEqual(tiers, ["default", "default", "default", "default"]);
  assert.equal(fixture.receipts.filter(item => item.event === "settled").length, 4);
});

test("research navigation and complete-law synthesis deliberate under the same limits", async () => {
  const efforts: unknown[] = [];
  const fixture = setup(async (_url, init) => {
    efforts.push(JSON.parse(String(init?.body)).reasoning.effort);
    const envelope = response();
    envelope.output[0].content[0].text = JSON.stringify({ turn: { decision: "insufficient_evidence", content: null,
      gaps: [{ requirementId: "r", description: "Artificial missing rule" }], actions: [] } });
    return Response.json(envelope);
  });
  await fixture.model.complete({ ...operation(), stage: "write", input: { researchAgent: true, evidence: [] } });
  await fixture.model.complete({ ...operation(), stage: "write", input: { researchAgent: true, evidence: [{ identity: "artificial", text: "Artificial evidence" }] } });
  assert.deepEqual(efforts, ["low", "low"]);
});

test("detailed composition requests fuller provider output without expanding initial interpretation", async () => {
  const seen: unknown[] = [];
  const fixture = setup(async (_url, init) => {
    seen.push(JSON.parse(String(init?.body)).text.verbosity);
    return Response.json(response());
  });
  await fixture.model.complete({ ...operation(), stage: "write", input: { format: "detailed" } });
  await fixture.model.complete({ ...operation(), stage: "write", input: { format: "short" } });
  await fixture.model.complete({ ...operation(), stage: "interpret", input: { format: "detailed" } });
  assert.deepEqual(seen, ["high", "medium", "medium"]);
});

test("configured reasoning can be disabled for either supported model", async () => {
  for (const name of ["gpt-6-luna", "gpt-6.1-terra"]) {
    const model = createResponsesModel({ apiKey: "fixture-key", model: name, purpose: "production", phase: "operating",
      deadlineAt: Date.now() + 30_000, rates: { input: 1, cachedInput: 0, output: 1 }, reasoningEffort: { write: "none" },
      ledger: { reserve: () => "fixture", dispatch: () => {}, settle: () => {}, cancel: () => {} }, receipt: async () => {},
      fetchImpl: async (_url, init) => {
        assert.equal(JSON.parse(String(init?.body)).reasoning.effort, "none");
        return Response.json({ ...response(), model: name });
      } });
    await model.complete({ ...operation(), stage: "write" });
  }
});

test("offline Terra production transport preserves low effort in every stage", async () => {
  const model = createResponsesModel({ apiKey: "fixture-key", model: "gpt-6.1-terra", purpose: "production", phase: "operating",
    deadlineAt: Date.now() + 30_000, rates: { input: 1, cachedInput: 0, output: 1 },
    ledger: { reserve: () => "fixture", dispatch: () => {}, settle: () => {}, cancel: () => {} }, receipt: async () => {},
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, "gpt-6.1-terra"); assert.equal(request.reasoning.effort, "low");
      assert.equal(request.service_tier, "default");
      return Response.json({ ...response(), model: "gpt-6.1-terra" });
    } });
  for (const stage of ["interpret", "select", "assess", "write"] as const) await model.complete({ ...operation(), stage });
});

test("workflow schemas sent to the provider use supported unions and string formats", async () => {
  const formats = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);
  function inspect(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    assert.equal(Object.hasOwn(node, "oneOf"), false, "Structured Outputs requires anyOf, not oneOf");
    if (typeof node.format === "string") assert.ok(formats.has(node.format), `Unsupported format: ${node.format}`);
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual(new Set(node.required as string[]), new Set(Object.keys(node.properties as object)));
    }
    for (const child of Object.values(node)) inspect(child);
  }
  for (const schema of [entrySchema, interpretationSchema, initialResearchSchema, assessmentSchema, writtenAnswerSchema]) {
    const fixture = setup(async (_url, init) => {
      inspect(JSON.parse(String(init?.body)).text.format.schema);
      return Response.json(response());
    });
    await fixture.model.complete({ ...operation(), schema: z.toJSONSchema(schema) });
  }
});

test("provider-compatible schemas retain strict date, scope and recovery URL validation locally", () => {
  const interpretation = { complexity: "simple", needsClarification: false, requirements: [{ id: "r", question: "Fixture?" }],
    queries: ["Fixture"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
  assert.ok(interpretationSchema.safeParse(interpretation).success);
  assert.ok(interpretationSchema.safeParse({ ...interpretation, scopes: [{ kind: "historical", at: "2024-02-29" }] }).success);
  for (const scopes of [[{ kind: "historical", at: "2025-02-29" }], [{ kind: "historical" }],
    [{ kind: "current", at: "2024-02-29" }], [{ kind: "other" }]]) {
    assert.equal(interpretationSchema.safeParse({ ...interpretation, scopes }).success, false);
  }
  const assessment = (url: string) => ({ support: [], selectedIds: [], gaps: [], recovery: [{ requirementId: "r", sourceId: "s", url }] });
  assert.ok(assessmentSchema.safeParse(assessment("https://lex.uz/docs/123")).success);
  for (const url of ["not a URL", "/relative", "", `https://example.com/${"x".repeat(2048)}`]) {
    assert.equal(assessmentSchema.safeParse(assessment(url)).success, false);
  }
});

test("rejected provider requests retain safe diagnostics without recording private error messages", async () => {
  const fixture = setup(async () => Response.json({ error: { type: "invalid_request_error", code: "unsupported_parameter",
    param: "prompt_cache_options", message: "Private question, account and credential detail" } },
  { status: 400, headers: { "x-request-id": "req_rejected" } }));
  await assert.rejects(() => fixture.model.complete(operation()), /PROVIDER_HTTP_FAILED/);
  const received = fixture.receipts.find(item => item.event === "received");
  assert.equal(received?.httpStatus, 400);
  const failure = fixture.receipts.find(item => item.event === "failed");
  assert.deepEqual(failure?.providerError, { type: "invalid_request_error", code: "unsupported_parameter", param: "prompt_cache_options" });
  assert.doesNotMatch(JSON.stringify(fixture.receipts), /Private question|credential detail/);
  assert.deepEqual(fixture.charges, [null], "Diagnostics alone do not invent a zero charge");
});

test("PDF source inputs preserve original bytes and reserve the full model window before dispatch", async () => {
  const bytes = Buffer.from("%PDF-1.7 artificial source fixture"), sha256 = createHash("sha256").update(bytes).digest("hex");
  const rates = { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } };
  const fixture = setup(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.service_tier, "default");
    assert.equal(body.truncation, "disabled");
    assert.equal(body.store, false);
    const content = body.input[0].content;
    assert.equal(content[1].text, 'Official source attachment: fixture-source');
    assert.deepEqual(content[2], { type: "input_file", filename: `${sha256}.pdf`, detail: "high",
      file_data: `data:application/pdf;base64,${bytes.toString("base64")}` });
    return Response.json({ ...response(), usage: { input_tokens: 500_000,
      input_tokens_details: { cached_tokens: 0 }, output_tokens: 50 } });
  }, rates);
  await fixture.model.complete({ ...operation(), stage: "assess", sourceFiles: [{ sourceId: "fixture-source", sha256, bytes }] });
  assert.equal(fixture.receipts[0].maximumMicrousd, 526_250);
  assert.deepEqual(fixture.charges, [100_038]);
  assert.ok(fixture.events.indexOf("reserve") < fixture.events.indexOf("dispatch"));
});

test("visual reservations bound both input-heavy and output-heavy ends of the shared context window", async () => {
  const bytes = Buffer.from("%PDF-artificial"), sha256 = createHash("sha256").update(bytes).digest("hex");
  for (const outputRate of [1, 750_000]) {
    for (const outputTokens of [0, 1, 2500, 5000]) {
      const inputTokens = 1_050_000 - outputTokens;
      const fixture = setup(async () => Response.json({ ...response(), usage: {
        input_tokens: inputTokens, output_tokens: outputTokens,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: inputTokens,
          cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: inputTokens } },
      } }), { input: 100_000, cachedInput: 10_000, output: outputRate,
        longContext: { input: 200_000, cachedInput: 20_000, output: outputRate } });
      await assert.rejects(() => fixture.model.complete({ ...operation(), stage: "assess",
        sourceFiles: [{ sourceId: "source", sha256, bytes }] }), /PROVIDER_CACHE_POLICY_MISMATCH/);
      assert.equal(fixture.receipts[0].maximumMicrousd, outputRate === 1 ? 525_000 : 526_250);
      assert.ok(fixture.charges[0]! <= fixture.receipts[0].maximumMicrousd);
    }
  }
});

test("visual usage exceeding the shared context window cannot settle as valid usage", async () => {
  const bytes = Buffer.from("%PDF-artificial"), sha256 = createHash("sha256").update(bytes).digest("hex");
  const fixture = setup(async () => Response.json({ ...response(), usage: {
    input_tokens: 1_050_000, output_tokens: 1, input_tokens_details: { cached_tokens: 0 },
  } }), { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } });
  await assert.rejects(() => fixture.model.complete({ ...operation(), stage: "assess",
    sourceFiles: [{ sourceId: "source", sha256, bytes }] }), /PROVIDER_USAGE_INVALID/);
  assert.deepEqual(fixture.charges, [null]);
});

test("PDF input rejects unpriced, misidentified and interpretation-stage files before reservation", async () => {
  const bytes = Buffer.from("%PDF-artificial"), sha256 = createHash("sha256").update(bytes).digest("hex");
  const sourceFiles = [{ sourceId: "source", sha256, bytes }];
  const fixture = setup(async () => { throw Error("Unexpected paid dispatch"); });
  await assert.rejects(() => fixture.model.complete({ ...operation(), stage: "assess", sourceFiles }), /PROVIDER_FILE_PRICING/);
  assert.deepEqual(fixture.events, []);
  const priced = setup(async () => { throw Error("Unexpected paid dispatch"); },
    { input: 1, cachedInput: 0, output: 1, longContext: { input: 2, cachedInput: 0, output: 2 } });
  await assert.rejects(() => priced.model.complete({ ...operation(), sourceFiles }), /PROVIDER_FILE_INPUT/);
  await assert.rejects(() => priced.model.complete({ ...operation(), stage: "select", sourceFiles }), /PROVIDER_FILE_INPUT/);
  await assert.rejects(() => priced.model.complete({ ...operation(), stage: "assess",
    sourceFiles: [{ ...sourceFiles[0], sha256: "invalid-artifact-identifier" }] }), /PROVIDER_FILE_INPUT/);
  assert.deepEqual(priced.events, []);
});

test("long-context reservations cover upper rates and usage selects the actual pricing tier", async () => {
  const rates = { input: 100_000, cachedInput: 10_000, output: 500_000,
    longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } };
  for (const inputTokens of [272_000, 272_001]) {
    const fixture = setup(async () => Response.json({ ...response(), usage: {
      input_tokens: inputTokens, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50,
    } }), rates);
    await fixture.model.complete(operation());
    const selected = inputTokens > 272_000 ? rates.longContext : rates;
    assert.deepEqual(fixture.charges, [Math.ceil((inputTokens * selected.input + 50 * selected.output) / 1_000_000)]);
    assert.deepEqual(fixture.receipts.find(item => item.event === "usage")?.rates,
      { input: selected.input, cachedInput: selected.cachedInput, output: selected.output });
    assert.equal(fixture.receipts[0].maximumMicrousd, 525_750);
  }
});

test("missing long-context prices reject a large prompt before reservation or transport", async () => {
  const fixture = setup(async () => { throw new Error("Unexpected network"); });
  await assert.rejects(() => fixture.model.complete({ ...operation(), input: { text: "a".repeat(273_000) } }), /PROVIDER_INPUT_LIMIT/);
  assert.deepEqual(fixture.events, []);
});

test("provider transport reserves before dispatch, disables storage, and settles measured usage", async () => {
  let body: Record<string, unknown> = {};
  const fixture = setup(async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(init?.redirect, "error");
    body = JSON.parse(String(init?.body));
    return Response.json(response());
  });
  assert.deepEqual(await fixture.model.complete(operation()), { ok: true });
  assert.equal(body.store, false);
  assert.equal(body.service_tier, "default");
  assert.deepEqual(body.prompt_cache_options, { mode: "explicit" });
  assert.equal(typeof body.max_output_tokens, "number");
  assert.ok(fixture.events.indexOf("reserve") < fixture.events.indexOf("dispatch"));
  assert.deepEqual(fixture.charges, [34]);
  assert.equal(fixture.model.usage().inputTokens, 100);
});

test("a lost provider response keeps spending unknown and is never retried automatically", async () => {
  let calls = 0;
  const fixture = setup(async () => { calls++; throw new Error("socket failure with private detail"); });
  await assert.rejects(() => fixture.model.complete(operation()), /PROVIDER_TRANSPORT_FAILED/);
  assert.deepEqual(fixture.charges, [null]);
  await assert.rejects(() => fixture.model.complete(operation()), /PROVIDER_SESSION_BLOCKED/);
  assert.equal(calls, 1);
});

test("incomplete output is billed but cannot become structured model content", async () => {
  const fixture = setup(async () => Response.json(response("incomplete")));
  await assert.rejects(() => fixture.model.complete(operation()), /PROVIDER_OUTPUT_INCOMPLETE/);
  assert.deepEqual(fixture.charges, [34]);
});

test("unexpected cache writes are accounted at their reported lifetime and rejected by policy", async () => {
  const value = response();
  const fixture = setup(async () => Response.json({ ...value, usage: { ...value.usage,
    input_tokens_details: { cached_tokens: 20, cache_write_tokens: 60,
      cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 60 } } } }));
  await assert.rejects(() => fixture.model.complete(operation()), /PROVIDER_CACHE_POLICY_MISMATCH/);
  assert.deepEqual(fixture.charges, [43]);
});

test("cancellation of a dispatched request retains the unknown cost", async () => {
  const controller = new AbortController();
  const fixture = setup(async () => {
    controller.abort();
    return new Promise<Response>(() => {});
  });
  await assert.rejects(() => fixture.model.complete({ ...operation(), signal: controller.signal }));
  assert.deepEqual(fixture.charges, [null]);
});

test("cancellation during usage journaling retains the reservation instead of accepting a late settlement", async () => {
  const controller = new AbortController(), charges: (number | null)[] = [];
  const model = createResponsesModel({ apiKey: "synthetic", model: "gpt-6-luna", purpose: "qualification", phase: "diagnostic",
    deadlineAt: Date.now() + 30_000, rates: { input: 100_000, cachedInput: 10_000, output: 500_000 },
    fetchImpl: async () => Response.json(response()),
    ledger: { reserve: () => "synthetic", dispatch: () => {}, cancel: () => {}, settle: (_id, charged) => { charges.push(charged); } },
    receipt: async record => { if (record.event === "usage") controller.abort(new Error("Synthetic cancellation")); },
  });
  await assert.rejects(model.complete({ ...operation(), signal: controller.signal }));
  assert.deepEqual(charges, [null]);
  await assert.rejects(model.complete(operation()), /PROVIDER_SESSION_BLOCKED/);
});

test("concurrent admission cannot exceed the request generation-call ceiling", async () => {
  let calls = 0;
  const fixture = setup(async () => { calls++; return Response.json(response()); });
  const outcomes = await Promise.allSettled(Array.from({ length: maximumGenerationCalls + 1 }, () => fixture.model.complete(operation())));
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, maximumGenerationCalls);
  assert.equal(calls, maximumGenerationCalls);
});


test("evidence removal is absent from tools and rejected even if emitted", async () => {
  const prepared = new ProviderResearchSession().prepare({ ...operation(), stage: "write", researchSession: true,
    schema: { type: "object", properties: { turn: { anyOf: [{ properties: { decision: { const: "research" } } }] } } }, input: { evidence: [{ identity: "s1" }], availableEvidence: [{ identity: "s1" }], canResearch: true } }, "{}");
  assert.doesNotMatch(JSON.stringify(prepared.tools), /selectSourceIds|select_evidence/);
  await assert.rejects(prepared.accept([{ type: "function_call", call_id: "bad", name: "research_law",
    arguments: JSON.stringify({ actions: [{ requirementId: "r", selectSourceIds: [] }] }) }]), /EVIDENCE_REMOVAL_DISABLED/);
});

test("native continuation preserves issues, failures and full earlier packets before composition", async () => {
  let calls = 0;
  const issue = { id: "scope", issue: "Requested rule", relevance: "Answers the actual question", status: "open",
    sourceIds: ["canonical"], dependency: "Resolve exception", nextAction: "Select complete rule" };
  const fixture = setup(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls++;
    assert.equal(body.store, false);
    if (calls === 1) {
      assert.deepEqual(body.tools[0].parameters.required, ["actions", "coverageUpdates"]);
      return Response.json({ ...response(), output: [{ type: "reasoning", encrypted_content: "opaque-private-state", summary: [] },
        { type: "function_call", call_id: "repair", name: "research_law", arguments: JSON.stringify({ actions: [{ requirementId: "r", sourceId: "s1", url: "https://example.invalid/reference" }],
          coverageUpdates: [{ ...issue, sourceIds: ["s1"] }] }) }] });
    }
    const packet = JSON.parse(body.input.at(-1).output).packet;
    assert.equal(packet.question, "Actual private question");
    assert.deepEqual(packet.history, [{ role: "user", content: "Actual private fact" }]);
    assert.equal(packet.coverageRecords[0].dependency, "Resolve exception");
    assert.deepEqual(packet.coverageRecords[0].sourceIds, ["s1"]);
    assert.equal(packet.actionOutcomes[0].kind, "empty");
    assert.ok(body.input.some((item: { encrypted_content?: string }) => item.encrypted_content === "opaque-private-state"));
    assert.equal(body.input.at(-1).call_id, "repair");
    assert.ok(JSON.stringify(body.input[0]).includes("Complete artificial rule including exception."));
    assert.deepEqual(body.tools, []);
    assert.equal(packet.evidence[0].text, "Complete artificial rule including exception.");
    return Response.json({ ...response(), output: [{ type: "message", role: "assistant", content: [{ type: "output_text",
      text: JSON.stringify({ turn: { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "r", description: "Exception unresolved" }] } }) }] }] });
  }, { input: 100_000, cachedInput: 10_000, output: 500_000, longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } });
  const input = { researchAgent: true, question: "Actual private question", history: [{ role: "user", content: "Actual private fact" }],
    interpretation: { requirements: [{ id: "r" }] }, availableEvidence: [{ identity: "canonical" }],
    evidence: [{ identity: "canonical", text: "Complete artificial rule including exception." }], coverageRecords: [issue],
    actionOutcomes: [{ action: { requirementId: "r", query: "Empty query" }, kind: "empty" }] };
  const first = await fixture.model.complete({ ...operation(), stage: "write", researchSession: true, input });
  assert.deepEqual((first as { coverageUpdates: unknown[] }).coverageUpdates, [issue]);
  await fixture.model.complete({ ...operation(), stage: "write", researchSession: true,
    input: { ...input, canResearch: false, canSelectEvidence: false } });
  assert.doesNotMatch(JSON.stringify(fixture.receipts), /Actual private|opaque-private-state|Empty query/);
});
