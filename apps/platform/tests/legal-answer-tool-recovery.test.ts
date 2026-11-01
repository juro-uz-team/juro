import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ProviderResearchSession } from "../lib/legal-answer-workflow/provider-research-session";
import { compactEvidenceOperation } from "../lib/legal-answer-workflow/model-identities";
import { researchTurnSchema, navigationEntrySchema, type ModelOperation } from "../lib/legal-answer-workflow/contracts";
import { RetainedContext } from "../lib/legal-answer-workflow/retained-context";

const operation = (input: Record<string, unknown>): ModelOperation => ({ stage: "write", instruction: "Fixture",
  researchSession: true, signal: new AbortController().signal, schema: z.toJSONSchema(researchTurnSchema),
  input: { researchAgent: true, interpretation: { requirements: [{ id: "question" }] }, evidence: [],
    availableEvidence: [], coverageRecords: [], unreadCandidates: [{ id: "c1" }], ...input } });
const coverage = { id: "issue", issue: "Rule", relevance: "Requested rule", status: "supported", sourceIds: ["c1"], dependency: "", nextAction: "" };
const call = (actions: unknown[], coverageUpdates: unknown[] = []) => [{ type: "function_call", call_id: "read",
  name: "research_law", arguments: JSON.stringify({ actions, coverageUpdates }) }];

test("native research admits explicit whole documents only for offered candidates", async () => {
  const session = new ProviderResearchSession();
  const compact = compactEvidenceOperation(operation({}));
  const prepared = session.prepare(compact.operation, "{}");
  const wire = z.fromJSONSchema(prepared.tools[0].parameters);
  const action = { requirementId: "question", candidateId: "c1", wholeDocument: true };
  assert.equal(wire.safeParse({ actions: [action], coverageUpdates: [] }).success, true);
  assert.equal(wire.safeParse({ actions: [{ ...action, candidateId: "invented" }], coverageUpdates: [] }).success, false);
  assert.equal(wire.safeParse({ actions: [{ ...action, sectionPosition: "unoffered" }], coverageUpdates: [] }).success, false);
  const result = researchTurnSchema.parse(compact.restore(await prepared.accept(call([action]))));
  assert.deepEqual(result.actions, [action]);
});

test("native entry can select offered reads without inventing another search", async () => {
  const session = new ProviderResearchSession();
  const entry: ModelOperation = { stage: "interpret", researchSession: true, instruction: "Fixture",
    signal: new AbortController().signal, schema: z.toJSONSchema(navigationEntrySchema),
    input: { question: "Artificial permit rule", entryNavigation: true, unreadCandidates: [{ id: "c1" }] } };
  const prepared = session.prepare(entry, JSON.stringify(entry.input));
  const parameters = { complexity: "simple", needsClarification: false, requirements: [{ id: "rule", question: "Permit conditions" }],
    queries: { en: null, ru: null, "uz-Latn": null }, scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [], candidateIds: ["c1"] };
  const wire = z.fromJSONSchema(prepared.tools[0].parameters);
  assert.equal(wire.safeParse(parameters).success, true);
  assert.equal(wire.safeParse({ ...parameters, candidateIds: ["c99"] }).success, false);
  const output = await prepared.accept([{ type: "function_call", call_id: "initial", name: "search_law", arguments: JSON.stringify(parameters) }]);
  const result = navigationEntrySchema.parse(output);
  assert.deepEqual(result.candidateIds, ["c1"]);
  assert.deepEqual(result.interpretation?.queries, ["Artificial permit rule"]);
  assert.deepEqual(result.interpretation?.requirements, parameters.requirements);
});

test("reference handles preserve an authenticated source and URL as one selection", async () => {
  const input = operation({ evidence: [{ identity: "source-a" }, { identity: "source-b" }],
    availableEvidence: [{ identity: "source-a" }, { identity: "source-b" }], availableReferences: [
      { sourceId: "source-a", url: "https://lex.uz/docs/123", texts: ["Procedure"] },
      { sourceId: "source-b", url: "https://lex.uz/docs/123", texts: ["Historical procedure"] },
    ] });
  const compact = compactEvidenceOperation(input);
  const session = new ProviderResearchSession();
  const prepared = session.prepare(compact.operation, JSON.stringify(compact.operation.input));
  const wire = z.fromJSONSchema(prepared.tools[0].parameters);
  assert.equal(wire.safeParse({ actions: [{ requirementId: "question", referenceId: "ref2" }], coverageUpdates: [] }).success, true);
  assert.equal(wire.safeParse({ actions: [{ requirementId: "question", sourceId: "s1", url: "https://lex.uz/docs/123" }], coverageUpdates: [] }).success, false);
  const result = researchTurnSchema.parse(compact.restore(await prepared.accept(call([
    { requirementId: "question", referenceId: "ref2" }, { requirementId: "question", referenceId: "ref999" },
  ]))));
  assert.deepEqual(result.actions, [{ requirementId: "question", sourceId: "source-b", url: "https://lex.uz/docs/123" }]);
  assert.deepEqual(result.toolErrors, [{ field: "actions", index: 1, code: "INVALID_ARGUMENT" }]);
  const next = session.prepare(compact.operation, JSON.stringify(compact.operation.input));
  assert.match(JSON.stringify(next.input), /referenceId/);
  const repeated = researchTurnSchema.parse(compact.restore(await next.accept(call([{ requirementId: "question", referenceId: "ref1" }]))));
  assert.equal("sourceId" in repeated.actions[0] && repeated.actions[0].sourceId, "source-a");
});

test("invalid independent fields preserve valid work and feedback indices refer to original multilingual arguments", async () => {
  const compact = compactEvidenceOperation(operation({}));
  const session = new ProviderResearchSession();
  const prepared = session.prepare(compact.operation, "{}");
  const read = { requirementId: "question", candidateId: "c1" };
  const result = researchTurnSchema.parse(compact.restore(await prepared.accept(call([
    read, { requirementId: "question", sourceId: "s1", url: "https://example.invalid/reference" },
    { requirementId: "question", candidateId: 99 },
  ], [{ ...coverage, issue: 99 }, coverage]))));
  assert.deepEqual(result.actions, [read]);
  assert.ok(result.toolErrors?.some(error => error.field === "actions" && error.index === 1 && error.code === "SOURCE_NOT_ACQUIRED"));
  assert.ok(result.toolErrors?.some(error => error.field === "actions" && error.index === 2 && error.code === "INVALID_ARGUMENT"));
  assert.ok(result.toolErrors?.some(error => error.field === "coverageUpdates" && error.index === 1 && error.code === "SOURCE_NOT_ACQUIRED"));
  const multilingual = researchTurnSchema.parse(compact.restore(await prepared.accept(call([
    { requirementId: "question", query: { en: "rule", ru: "правило", "uz-Latn": "qoida" } },
    { requirementId: "question", candidateId: "unoffered" },
  ]))));
  assert.equal(multilingual.actions.length, 4);
  assert.deepEqual(multilingual.toolErrors, [{ field: "actions", index: 1, code: "CANDIDATE_NOT_OFFERED" }]);
});

test("empty evidence forbids candidate IDs as support; invalid bookkeeping preserves a valid read and correction feedback", async () => {
  const compact = compactEvidenceOperation(operation({}));
  const session = new ProviderResearchSession();
  const prepared = session.prepare(compact.operation, "{}");
  const action = { requirementId: "question", candidateId: "c1" };
  const wire = z.fromJSONSchema(prepared.tools[0].parameters);
  assert.equal(wire.safeParse({ actions: [action], coverageUpdates: [coverage] }).success, false);
  assert.equal(wire.safeParse({ actions: [action], coverageUpdates: [{ ...coverage, sourceIds: [] }] }).success, true);
  const raw = await prepared.accept(call([action], [coverage]));
  const restored = researchTurnSchema.parse(compact.restore(raw));
  assert.deepEqual(restored.actions, [action]);
  assert.deepEqual(restored.coverageUpdates, []);
  assert.deepEqual(restored.toolErrors, [{ field: "coverageUpdates", index: 0, code: "SOURCE_NOT_ACQUIRED" }]);
  const next = session.prepare(compact.operation, "{}");
  assert.match(JSON.stringify(next.input), /SOURCE_NOT_ACQUIRED/);
  assert.ok(JSON.stringify(next.input).includes(JSON.stringify(call([action], [coverage])[0])));
  assert.throws(() => compact.restore(JSON.parse(JSON.stringify(raw))), /PROVIDER_OUTPUT_INVALID/);
});

test("exact section pairs bind grouped matches, publisher contents and retained menus without crossing editions", async () => {
  const session = new ProviderResearchSession();
  const compact = compactEvidenceOperation(operation({ unreadCandidates: [
    { id: "c1", matches: [{ id: "c2" }], sourceRef: "d1", readRange: { sourceSectionsRef: "s1", sections: [{ position: "p1" }] } },
    { id: "c3", readRange: { sections: [{ position: "p3" }] } }],
    candidateSources: { d1: { publisherContents: [{ position: "p2", title: "A heading" }] } },
    candidateSourceSections: { s1: [{ candidateId: "c1", sectionPosition: "p4" }] } }));
  const prepared = session.prepare(compact.operation, "{}");
  const wire = z.fromJSONSchema(prepared.tools[0].parameters);
  for (const candidateId of ["c1", "c2", "c3"]) for (const sectionPosition of ["p1", "p2", "p3", "p4", "A heading"]) {
    const valid = candidateId === "c3" ? sectionPosition === "p3" : ["p1", "p2", "p4"].includes(sectionPosition);
    assert.equal(wire.safeParse({ actions: [{ requirementId: "question", candidateId, sectionPosition }], coverageUpdates: [] }).success, valid);
  }
  const invalid = { requirementId: "question", candidateId: "c1", sectionPosition: "A heading" };
  for (let index = 0; index < 2; index++) {
    const recovered = researchTurnSchema.parse(compact.restore(await prepared.accept(call([invalid]))));
    assert.deepEqual(recovered.actions, []);
    assert.equal(recovered.toolErrors?.[0].code, "SECTION_NOT_OFFERED");
  }
  await assert.rejects(prepared.accept(call([invalid])), /PROVIDER_TOOL_CORRECTION_LIMIT/);
});

test("context references reconstruct every byte of changed and unchanged packets without reference chains", () => {
  const retained = new RetainedContext();
  const history = new Map<string, unknown>();
  const readPointer = (value: unknown, path: string): unknown => path.split("/").slice(1).reduce<unknown>((node, part) =>
    (node as Record<string, unknown>)[part.replace(/~1/gu, "/").replace(/~0/gu, "~")], value);
  const law = { identity: "s1", text: "Complete law with its exceptions. ".repeat(200) };
  let totalReferences = 0;
  for (let index = 0; index < 4; index++) {
    const input = { evidence: [law, { identity: "s2", text: `Changed rule ${index}. `.repeat(100) }],
      "escaped/key~": "Exact metadata ".repeat(100), state: index };
    const encoded = retained.prepare(input, `call${index}`);
    const restored = structuredClone(encoded.value.packet) as Record<string, unknown>;
    if (index) assert.ok(encoded.value.retainedContextReferences.some(reference => reference.path === "/evidence/0"),
      "Unchanged complete law must reuse its exact retained occurrence, while changed law remains complete");
    for (const reference of encoded.value.retainedContextReferences) {
      const parts = reference.path.split("/").slice(1).map(part => part.replace(/~1/gu, "/").replace(/~0/gu, "~"));
      const parent = parts.slice(0, -1).reduce((node, part) => node[part] as Record<string, unknown>, restored);
      const original = readPointer(history.get(reference.callId), reference.originalPath);
      assert.notEqual(original, null);
      parent[parts.at(-1)!] = original;
    }
    assert.deepEqual(restored, input);
    if (index) assert.ok(JSON.stringify(encoded.value).length < JSON.stringify(input).length);
    totalReferences += encoded.value.retainedContextReferences.length;
    encoded.commit(); history.set(`call${index}`, encoded.value);
  }
  assert.ok(totalReferences > 0);
  retained.clear();
  assert.deepEqual(retained.prepare({ evidence: [law] }, "fresh").value.retainedContextReferences, []);
});
