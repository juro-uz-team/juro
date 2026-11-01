import assert from "node:assert/strict";
import test from "node:test";
import { compactEvidenceOperation, createEvidenceCompactor } from "../lib/legal-answer-workflow/model-identities";
import { assessmentSchema, initialReadTurnSchema, unreadResearchTurnSchema, researchResponseSchema, researchTurnSchema, writtenAnswerSchema, type ModelOperation } from "../lib/legal-answer-workflow/contracts";
import { z } from "zod";
import { restoreStatementCitations } from "../lib/legal-answer-workflow/provider-statement-citations";
import { citationProseNormalizer } from "../lib/legal-answer-workflow/citation-prose";

const first = `official:${"a".repeat(64)}:current`;
test("citation suffix cleanup preserves literal, quoted, code, link and unattached tokens", () => {
  const normalize = citationProseNormalizer({ question: "Explain literal [s3]." });
  for (const text of ['The token is [s1]', 'A quote: "Rule. [s1]"', 'A quote: "Rule. [s1]',
    'A code fragment `x`. [s1]', 'A [link](https://example.test). [s1]',
    'An unattached rule. [s2]', 'A literal token. [s3]', 'A rule. [s1] [s2]',
    'A different label. [section]', "An open quote: 'Rule. [s1]",
    '```\nA literal rule. [s1]\n```', '“A quotation\nA literal rule. [s1]\n”',
    '~~~\nA literal rule. [s1]\n~~~', '    A literal rule. [s1]', '\tA literal rule. [s1]',
    '> A quoted rule. [s1]', '<pre>\nA literal rule. [s1]\n</pre>', ' \tA literal rule. [s1]']) {
    assert.equal(normalize(text, ["s1", "s3"]), text);
  }
  assert.equal(normalize('The office «Example» applies. [s1]\n\nAnother rule! [s1]', ["s1"]),
    'The office «Example» applies.\n\nAnother rule!');
  for (const apostrophe of ["'", "‘", "’", "ʻ", "ʼ"]) {
    const text = `Bolaning fikri va ota-onaning o${apostrophe}zaro kelishuvi hisobga olinadi.`;
    assert.equal(normalize(`${text} [s1]`, ["s1"]), text);
  }
});

test("citation suffix cleanup occurs before statement support is grouped", () => {
  const result = restoreStatementCitations({ turn: { content: { issues: [{ explanation: [
    { statement: "First rule. [s2]", sourceIds: ["s1"] },
    { statement: "Second rule. [s2]", sourceIds: ["s2"] },
  ] }] } } }) as { turn: { content: { issues: { explanation: string; sourceIds: string[] }[] } } };
  assert.equal(result.turn.content.issues[0].explanation, "First rule. [s2]\n\nSecond rule.");
  assert.deepEqual(result.turn.content.issues[0].sourceIds, ["s1", "s2"]);
});

test("redundant terminal citation handles do not leak into restored answer prose", () => {
  const compact = compactEvidenceOperation({ ...operation(), stage: "write", sourceFiles: [],
    input: { researchAgent: true, evidence: [first, second].map(identity => ({ identity, text: "Complete rule" })) } });
  const content = { summary: "The artificial rule applies. [s1]", summarySourceIds: ["s1"],
    issues: [{ title: "Rule", explanation: "The rule [a] has a condition. [s1] [s2]",
      requirementIds: ["r"], sourceIds: ["s1", "s2"], actions: [] }],
    conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [],
    referenceNotes: [], clarificationQuestions: [], urgency: "normal" };
  const { sourceIds, ...issue } = content.issues[0];
  const wire = { turn: { decision: "answer", content: { ...content, issues: [{ ...issue,
    explanation: [{ statement: issue.explanation, sourceIds }] }] }, gaps: [], actions: [] } };
  const restored = researchTurnSchema.parse(compact.restore(restoreStatementCitations(wire))).content!;
  assert.equal(restored.summary, "The artificial rule applies.");
  assert.equal(restored.issues[0].explanation, "The rule [a] has a condition.");
  assert.deepEqual(restored.summarySourceIds, [first]);
  assert.deepEqual(restored.issues[0].sourceIds, [first, second]);
});
test("research source handles survive selection changes without admitting inactive citations", () => {
  const compact = createEvidenceCompactor();
  const turn = (identities: string[]) => compact({ ...operation(), stage: "write", sourceFiles: [], input: {
    researchAgent: true, evidence: identities.map(identity => ({ identity, text: "Complete retained rule" })),
    availableEvidence: [first, second].map(identity => ({ identity })),
  } });
  const original = turn([first, second]);
  const selected = turn([second]);
  const reopened = turn([second, first]);
  const ids = (value: typeof original) => (value.operation.input as { evidence: { identity: string }[] }).evidence.map(item => item.identity);
  assert.deepEqual(ids(original), ["s1", "s2"]);
  assert.deepEqual(ids(selected), ["s2"]);
  assert.deepEqual(ids(reopened), ["s2", "s1"]);
  const content = { summary: "Rule", summarySourceIds: ["s1"], issues: [{ title: "Rule", explanation: "Condition",
    requirementIds: ["r"], sourceIds: ["s1"], actions: [] }], conditionalBranches: [], assumptions: [], risks: [],
    deadlines: [], requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal" };
  const answer = { turn: { decision: "answer", content, gaps: [], actions: [] } };
  assert.throws(() => selected.restore(answer));
  assert.deepEqual(researchTurnSchema.parse(reopened.restore(answer)).content?.summarySourceIds, [first]);
});
test("prior judgments use current context labels without promoting inactive evidence to citations", () => {
  const input = { researchAgent: true, evidence: [{ identity: first, text: "Current complete law" }],
    availableEvidence: [{ identity: first }, { identity: second }],
    previousResearch: { gaps: [{ requirementId: "r", description: "Prior missing rule" }],
      consideredEvidenceIds: [second], newlyReadEvidenceIds: [first], newCandidateCount: 2, newFailures: [] } };
  const before = structuredClone(input);
  const compact = compactEvidenceOperation({ ...operation(), stage: "write", sourceFiles: [], input });
  const mapped = compact.operation.input as typeof input;
  assert.deepEqual(mapped.previousResearch, { ...input.previousResearch, consideredEvidenceIds: ["u1"], newlyReadEvidenceIds: ["s1"] });
  assert.deepEqual(mapped.availableEvidence.map(item => item.identity), ["s1", "u1"]);
  assert.deepEqual(input, before);
  for (const field of ["consideredEvidenceIds", "newlyReadEvidenceIds"] as const) {
    assert.throws(() => compactEvidenceOperation({ ...operation(), stage: "write", sourceFiles: [], input: {
      ...input, previousResearch: { ...input.previousResearch, [field]: ["unknown"] },
    } }), /PROVIDER_SOURCE_IDENTITY/);
  }
});
test("provider answer citations can select only complete evidence supplied to that turn", () => {
  const compact = compactEvidenceOperation({ ...operation(), stage: "write", sourceFiles: [],
    input: { researchAgent: true, language: "ru", evidence: [{ identity: first, text: "Complete rule" }],
      availableEvidence: [{ identity: second, text: "Previously read rule" }] } });
  const provider = z.fromJSONSchema(compact.operation.schema);
  const content = { summary: "Rule", summarySourceIds: ["s1"],
    issues: [{ title: "Rule", explanation: "Condition", requirementIds: ["R1"], sourceIds: ["s1"], actions: [] }],
    conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal" };
  const wrap = (value: unknown) => ({ turn: { decision: "answer", content: value, gaps: [], actions: [] } });
  assert.equal(provider.safeParse(wrap(content)).success, true);
  for (const invalid of ["document1", "s2", "u1", first]) {
    assert.equal(provider.safeParse(wrap({ ...content, summarySourceIds: [invalid] })).success, false);
    assert.equal(provider.safeParse(wrap({ ...content, issues: [{ ...content.issues[0], sourceIds: [invalid] }] })).success, false);
  }
});
test("citation binding preserves large evidence inventories within the provider enum budget", () => {
  const compact = compactEvidenceOperation({ ...operation(), stage: "write", sourceFiles: [],
    input: { researchAgent: true, language: "ru", evidence: Array.from({ length: 200 }, (_, index) =>
      ({ identity: `official-${index}`, text: "Complete provision" })) } });
  let count = 0;
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if ("$ref" in value) assert.deepEqual(Object.keys(value), ["$ref"], "References must not override constraints with siblings");
    for (const [key, child] of Object.entries(value)) {
      if (key === "enum" && Array.isArray(child)) count += child.length;
      else inspect(child);
    }
  };
  inspect(compact.operation.schema);
  assert.ok(count <= 1000, `Provider enum budget exceeded: ${count}`);
  assert.ok(JSON.stringify(compact.operation.schema).includes('"s200"'));
});
test("Uzbek generated prose requires Latin script while original evidence and structured identities remain intact", () => {
  const content = { summary: "Ota-ona uchun qoida.", summarySourceIds: ["s1"],
    issues: [{ title: "Qoida", explanation: "Bolaning manfaatlari hisobga olinadi.", requirementIds: ["Р1"], sourceIds: ["s1"], actions: [] }],
    conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal" };
  const original = operation();
  const compact = compactEvidenceOperation({ ...original, stage: "write", sourceFiles: [],
    input: { researchAgent: true, language: "uz", evidence: [{ identity: first, text: "Исходный текст закона." }] } });
  const wire = JSON.stringify(compact.operation.schema);
  assert.ok(wire.includes("pattern"));
  const answerBranch = researchResponseSchema(true, true, "uz").shape.turn.options.find(option => "content" in option.shape
    && option.shape.decision.value === "answer");
  assert.ok(answerBranch);
  const schema = z.toJSONSchema(answerBranch);
  const contentSchema = schema.properties?.content;
  assert.ok(contentSchema && typeof contentSchema === "object");
  const contentKeys = Object.keys(contentSchema.properties ?? {});
  assert.ok(contentKeys.indexOf("issues") < contentKeys.indexOf("summary"));
  assert.equal((compact.operation.input as { evidence: { text: string }[] }).evidence[0].text, "Исходный текст закона.");
  const wrap = (value: unknown) => ({ turn: { decision: "answer", content: value, gaps: [], actions: [] } });
  const restored = researchTurnSchema.parse(compact.restore(wrap(content)));
  assert.deepEqual(restored.content?.issues[0].requirementIds, ["Р1"]);
  assert.deepEqual(restored.content?.summarySourceIds, [first]);
  assert.throws(() => compact.restore(wrap({ ...content, summary: "Qoida: қарор қабул қилинади." })));
  assert.throws(() => compact.restore(wrap({ ...content, requiredDocuments: [{ name: "Ҳужжат", reason: "Asos", required: false }] })));
  // Other scripts must not bypass the Uzbek Latin constraint merely because they are not Cyrillic.
  for (const summary of ["Xodimಕ್ಕೆ to‘lanadi.", "ամբողջ davr uchun.", "Xodim uchun 全部."]) {
    assert.throws(() => compact.restore(wrap({ ...content, summary })));
    assert.equal(z.fromJSONSchema(schema).safeParse({ decision: "answer", content: { ...content, summary }, gaps: [], actions: [] }).success, false);
  }
  assert.doesNotThrow(() => compact.restore(wrap({ ...content,
    summary: "O‘zbekiston — xodimning oʻrtacha ish haqi: 1 000 so‘m (50%); 10 × 2 ≥ 20.\n§ 560: “muddat”; № 12, Ⅳ bob, ½." })));
  const russian = researchResponseSchema(true, true, "ru");
  assert.equal(russian.safeParse(wrap({ ...content, summary: "Правило для родителей." })).success, true);
});
test("provider response branches cannot combine an answer with unresolved research", () => {
  const schema = researchResponseSchema(true, true);
  const turn = { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", candidateId: "c1" }] };
  assert.equal(schema.safeParse({ turn }).success, true);
  assert.equal(schema.safeParse({ turn: { ...turn, decision: "answer" } }).success, false);
  assert.equal(schema.safeParse({ turn: { ...turn, actions: [] } }).success, false);
  assert.equal(researchResponseSchema(false, false).safeParse({ turn: { ...turn,
    actions: Array.from({ length: 4 }, (_, index) => ({ requirementId: "r", candidateId: `c${index}` })) } }).success, false);
  const wire = z.toJSONSchema(schema);
  assert.equal(wire.type, "object");
  assert.equal(wire.anyOf, undefined);
  assert.ok(wire.properties?.turn);
});
test("initial navigation cannot select or reference evidence before any complete read", () => {
  const turn = { decision: "research", content: null, gaps: [], actions: [{ requirementId: "r", candidateId: "c1", wholeSection: true }] };
  assert.equal(initialReadTurnSchema.safeParse(turn).success, true);
  assert.equal(initialReadTurnSchema.safeParse({ ...turn,
    actions: [{ requirementId: "r", resultSetId: "results1", page: 0 }] }).success, true);
  for (const action of [{ requirementId: "r", selectSourceIds: ["document7"] },
    { requirementId: "r", sourceId: "s1", url: "https://lex.uz/docs/42" }]) {
    assert.equal(initialReadTurnSchema.safeParse({ ...turn, actions: [action] }).success, false);
  }
  const schema = JSON.stringify(z.toJSONSchema(initialReadTurnSchema));
  assert.ok(!schema.includes('"selectSourceIds"'));
  assert.ok(!schema.includes('"sourceId"'));
  assert.equal(unreadResearchTurnSchema.safeParse({ ...turn,
    actions: [{ requirementId: "r", selectSourceIds: ["u1"] }] }).success, true);
});
const second = `official:${"b".repeat(64)}:historical`;
const assessment = { support: [{ requirementId: "r1", sourceIds: [first, second] }], selectedIds: [first, second],
  gaps: [], recovery: [{ requirementId: "r1", sourceId: second, url: "https://lex.uz/docs/42" }] };
const operation = (): ModelOperation => ({ stage: "assess", instruction: "Fixture instruction", signal: new AbortController().signal,
  schema: z.toJSONSchema(assessmentSchema), input: { question: first, evidence: [
    { identity: first, text: `Original text ${second}`, applicableAt: "2024-01-01", operativeReferences: [{ url: "https://lex.uz/docs/42", text: first }] },
    { identity: second, text: "Second complete provision" }], interpretation: { requirements: [{ id: "r1", question: first }] } },
  sourceFiles: [{ sourceId: second, sha256: "b".repeat(64), bytes: new Uint8Array([1, 2, 3]) }] });

test("research decisions restore reference identities without any assessment object", () => {
  const original = operation();
  const compact = compactEvidenceOperation({ ...original, stage: "write", schema: z.toJSONSchema(researchTurnSchema),
    input: { ...(original.input as object), researchAgent: true,
      availableReferences: [{ sourceId: second, url: "https://lex.uz/docs/42", texts: [first],
        scope: { kind: "historical", at: "2024-01-01" }, attempted: false }] } });
  assert.deepEqual((compact.operation.input as { availableReferences: unknown }).availableReferences, [{
    sourceId: "s2", url: "https://lex.uz/docs/42", texts: [first],
    scope: { kind: "historical", at: "2024-01-01" }, attempted: false,
  }]);
  const turn = researchTurnSchema.parse(compact.restore({ turn: { decision: "research", content: null,
    gaps: [{ requirementId: "r1", description: "Read the exception." }],
    actions: [{ requirementId: "r1", sourceId: "s2", url: "https://lex.uz/docs/42" }] } }));
  assert.deepEqual(turn.actions, [{ requirementId: "r1", sourceId: second, url: "https://lex.uz/docs/42" }]);
  assert.ok(!("assessment" in (compact.operation.input as object)));
  assert.throws(() => compact.restore({ turn: { ...turn, actions: [{ requirementId: "r1", sourceId: "s99", url: "https://lex.uz/docs/42" }] } }),
    /PROVIDER_SOURCE_IDENTITY/);
});

test("available prior reads can be selected by label without becoming citations before reopening", () => {
  const original = operation();
  const compact = compactEvidenceOperation({ ...original, stage: "write", sourceFiles: [], input: {
    researchAgent: true, evidence: [{ identity: first, text: "Complete rule" }],
    availableEvidence: [{ identity: first }, { identity: second }] } });
  const input = compact.operation.input as { availableEvidence: { identity: string }[] };
  assert.deepEqual(input.availableEvidence.map(item => item.identity), ["s1", "u1"]);
  const restored = researchTurnSchema.parse(compact.restore({ turn: { decision: "research", content: null, gaps: [],
    actions: [{ requirementId: "r1", selectSourceIds: ["s1", "u1"] }] } }));
  assert.deepEqual(restored.actions, [{ requirementId: "r1", selectSourceIds: [first, second] }]);
  const reference = researchTurnSchema.parse(compact.restore({ turn: { decision: "research", content: null, gaps: [],
    actions: [{ requirementId: "r1", sourceId: "u1", url: "https://example.invalid/reference" }] } }));
  assert.deepEqual(reference.actions, [{ requirementId: "r1", sourceId: second, url: "https://example.invalid/reference" }]);
  assert.throws(() => compact.restore({ turn: { decision: "research", content: null, gaps: [],
    actions: [{ requirementId: "r1", selectSourceIds: ["u99"] }] } }), /PROVIDER_SOURCE_IDENTITY/);
});

test("model labels preserve complete evidence, file bindings and canonical assessment identities", () => {
  const original = operation(), before = structuredClone(original.input);
  const compact = compactEvidenceOperation(original);
  const input = compact.operation.input as { question: string; evidence: { identity: string; text: string; applicableAt?: string; operativeReferences?: unknown }[] };
  assert.deepEqual(input.evidence.map(item => item.identity), ["s1", "s2"]);
  assert.equal(input.question, first);
  assert.equal(input.evidence[0].text, `Original text ${second}`);
  assert.equal(input.evidence[0].applicableAt, "2024-01-01");
  assert.deepEqual(input.evidence[0].operativeReferences, [{ url: "https://lex.uz/docs/42", text: first }]);
  assert.equal(compact.operation.sourceFiles?.[0].sourceId, "s2");
  assert.deepEqual(compact.operation.sourceFiles?.[0].bytes, original.sourceFiles?.[0].bytes);
  assert.deepEqual(original.input, before);
  assert.deepEqual(compact.restore({ ...assessment, support: [{ requirementId: "r1", sourceIds: ["s1", "s2"] }],
    selectedIds: ["s1", "s2"], recovery: [{ ...assessment.recovery[0], sourceId: "s2" }] }), assessment);
  assert.throws(() => compact.restore({ ...assessment, selectedIds: ["s99"] }), /PROVIDER_SOURCE_IDENTITY/);
});

test("every writing citation field restores exactly, without rewriting prose or requirement IDs", () => {
  const content = { summary: "s1", summarySourceIds: ["s1"], issues: [{ title: "s2", explanation: "s1", requirementIds: ["r1"],
    sourceIds: ["s1", "s2"], actions: [{ title: "s1", description: "s2", sourceIds: ["s2"] }] }],
    conditionalBranches: [{ condition: "s1", outcome: "s2", sourceIds: ["s2"] }], assumptions: [],
    risks: [{ level: "low", title: "s1", explanation: "s2", sourceIds: ["s1"] }],
    deadlines: [{ title: "s1", dueDate: null, sourceDate: null, calculationMethod: "s2", confidence: "confirmed", sourceIds: ["s2"] }],
    requiredDocuments: [], referenceNotes: [{ title: "s1", note: "s2", sourceIds: ["s1"] }], clarificationQuestions: [], urgency: "normal" };
  const original = operation();
  const compact = compactEvidenceOperation({ ...original, stage: "write", schema: z.toJSONSchema(writtenAnswerSchema),
    input: { ...(original.input as object), assessment } });
  const result = writtenAnswerSchema.parse(compact.restore(content));
  assert.equal(result.summary, "s1");
  assert.deepEqual(result.issues[0].requirementIds, ["r1"]);
  assert.deepEqual([result.summarySourceIds, result.issues[0].sourceIds, result.issues[0].actions[0].sourceIds,
    result.conditionalBranches[0].sourceIds, result.risks[0].sourceIds, result.deadlines[0].sourceIds, result.referenceNotes[0].sourceIds],
  [[first], [first, second], [second], [second], [first], [second], [first]]);
  const mapped = (compact.operation.input as { assessment: typeof assessment }).assessment;
  assert.deepEqual(mapped.support[0].sourceIds, ["s1", "s2"]);
  assert.equal(mapped.recovery[0].sourceId, "s2");
});

test("labels are operation-owned and duplicate or unbound identities fail closed", () => {
  const original = operation();
  assert.throws(() => compactEvidenceOperation({ ...original, input: { evidence: [{ identity: first }, { identity: first }] } }), /PROVIDER_SOURCE_IDENTITY/);
  assert.throws(() => compactEvidenceOperation({ ...original, sourceFiles: [{ ...original.sourceFiles![0], sourceId: "unbound" }] }), /PROVIDER_SOURCE_IDENTITY/);
  const a = compactEvidenceOperation(original);
  const b = compactEvidenceOperation({ ...original, sourceFiles: [], input: { evidence: [{ identity: "another-request" }] } });
  const output = { support: [{ requirementId: "r1", sourceIds: ["s1"] }], selectedIds: ["s1"], gaps: [], recovery: [] };
  assert.equal(assessmentSchema.parse(a.restore(output)).selectedIds[0], first);
  assert.equal(assessmentSchema.parse(b.restore(output)).selectedIds[0], "another-request");
});

test("unselected alternative support and inactive recovery remain context, never writable citations", () => {
  const original = operation();
  const alternative = { support: [{ requirementId: "r1", sourceIds: [first] }, { requirementId: "r1", sourceIds: [second] }],
    selectedIds: [first], gaps: [], recovery: [{ requirementId: "r1", sourceId: second, url: "https://lex.uz/docs/42" }] };
  const compact = compactEvidenceOperation({ ...original, stage: "write", sourceFiles: [], input: {
    evidence: [{ identity: first, text: "Complete supplied text" }], assessment: alternative } });
  const input = compact.operation.input as { assessment: typeof alternative };
  assert.deepEqual(input.assessment.support.map(item => item.sourceIds), [["s1"], ["u1"]]);
  assert.equal(input.assessment.recovery[0].sourceId, "u1");
  const output = { summary: "Supported", summarySourceIds: ["s1"], issues: [{ title: "Rule", explanation: "Complete", requirementIds: ["r1"],
    sourceIds: ["s1"], actions: [] }], conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [],
    referenceNotes: [], clarificationQuestions: [], urgency: "normal" };
  assert.deepEqual(writtenAnswerSchema.parse(compact.restore(output)).summarySourceIds, [first]);
  assert.throws(() => compact.restore({ ...output, summarySourceIds: ["u1"] }), /PROVIDER_SOURCE_IDENTITY/);
});
