import assert from "node:assert/strict";
import test from "node:test";
import { selectionAssessmentBatches, selectionReferenceContext } from "../lib/legal-corpus/selection-reference-context";

import { openAiCompatibleJsonSchema } from "../lib/ai/openai-schema";
import {
  classifyTargetPrivateNames,
  handleTargetReasoningServiceRequest,
  parseTargetInterpretationProviderOutput,
  parseTargetRequirementSupport,
  prioritizeTargetRequirements,
  selectTargetProvisions,
  targetSupportAssessmentJsonSchema,
  targetRequirementSupportContext,
  targetInterpretationJsonSchema,
  TARGET_PRIVATE_NAME_CLASSIFICATION_PATH,
  TARGET_PROVISION_SELECTION_PATH,
} from "../lib/legal-corpus/target-reasoning-service";

test("optional expansion overflow does not discard validated support mappings", () => {
  const mappings = [{itemKey: "source", supportedRequirementIds: ["requirement"], governingRequirementIds: ["requirement"]}];
  const additionalRequirements = Array.from({length: 4}, (_, index) => ({sourceItemKey: "source", readingId: "reading", statement: `Referenced operative condition ${index}`, priority: "core"}));
  const parsed = parseTargetRequirementSupport({mappings, additionalRequirements});
  assert.deepEqual(parsed.mappings, mappings);
  assert.equal(parsed.additionalRequirements.length, 3);
  assert.throws(() => parseTargetRequirementSupport({mappings: [{itemKey: "source"}], additionalRequirements}));
});

test("operative references from later assessment batches outrank optional details and duplicate renditions", () => {
  const suggestion = (statement: string, sourceItemKey: string, priority: "core" | "supporting") => ({statement, sourceItemKey, priority, readingId: "reading"});
  const result = prioritizeTargetRequirements([
    suggestion("Optional procedure", "first", "supporting"),
    suggestion("Optional procedure", "translation", "supporting"),
    suggestion("Optional remedy", "second", "supporting"),
    suggestion("Operative exception", "late", "core"),
  ]);
  assert.deepEqual(result.map(item => item.statement), ["Operative exception", "Optional procedure", "Optional remedy"]);
});

test("reasoning calls use strict provider schemas and interpretation normalizes nullable optionals", () => {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    assert.equal("oneOf" in object, false);
    assert.equal("allOf" in object, false);
    if (object.type === "object" && object.properties && typeof object.properties === "object") {
      assert.deepEqual(new Set(object.required as string[]),
        new Set(Object.keys(object.properties as Record<string, unknown>)));
    }
    Object.values(object).forEach(visit);
  };
  visit(openAiCompatibleJsonSchema(targetInterpretationJsonSchema));
  visit(openAiCompatibleJsonSchema(targetSupportAssessmentJsonSchema));
  assert.match(JSON.stringify(targetSupportAssessmentJsonSchema), /governingRequirementIds/u);
  const parsed = parseTargetInterpretationProviderOutput({
    id: "plan-provider",
    originalLanguage: "ru",
    answerLanguage: "ru",
    readings: [{ id: "reading", statement: "Трудовой договор",
      requirements: [{ id: "requirement", statement: "Порядок заключения", priority: "core" }] }],
    formulations: [{ id: "formulation", text: "порядок заключения трудового договора",
      legalTitleSpans: [], privateNameSpans: [], readingIds: ["reading"],
      requirementIds: ["requirement"], kind: "legal_register" }],
    missingCaseFacts: [], temporalEndpoint: null, comparison: null,
  });
  assert.equal("temporalEndpoint" in parsed, false);
  assert.equal("comparison" in parsed, false);
});

test("question interpretation canonicalizes provider UTC instants that omit the zone marker", () => {
  const base = {
    id: "plan-provider-time",
    originalLanguage: "en",
    answerLanguage: "en",
    readings: [{ id: "reading", statement: "Employment contract rules",
      requirements: [{ id: "requirement", statement: "Governing rules", priority: "core" }] }],
    formulations: [{ id: "formulation", text: "employment contract rules",
      legalTitleSpans: [], privateNameSpans: [], readingIds: ["reading"],
      requirementIds: ["requirement"], kind: "legal_register" }],
    missingCaseFacts: [],
  };
  const endpoint = parseTargetInterpretationProviderOutput({
    ...base,
    temporalEndpoint: { kind: "timestamp", instant: "2025-01-01T00:00:00" },
    comparison: null,
  });
  assert.deepEqual(endpoint.temporalEndpoint,
    { kind: "timestamp", instant: "2025-01-01T00:00:00.000Z" });

  const offsetEndpoint = parseTargetInterpretationProviderOutput({
    ...base,
    temporalEndpoint: { kind: "timestamp", instant: "2025-01-01T00:00:00+05:00" },
    comparison: null,
  });
  assert.deepEqual(offsetEndpoint.temporalEndpoint,
    { kind: "timestamp", instant: "2024-12-31T19:00:00.000Z" });

  const comparison = parseTargetInterpretationProviderOutput({
    ...base,
    temporalEndpoint: null,
    comparison: {
      left: { kind: "timestamp", instant: "2020-01-01T00:00:00" },
      right: { kind: "timestamp", instant: "2025-01-01T00:00:00.000Z" },
    },
  });
  assert.deepEqual(comparison.comparison, {
    left: { kind: "timestamp", instant: "2020-01-01T00:00:00.000Z" },
    right: { kind: "timestamp", instant: "2025-01-01T00:00:00.000Z" },
  });
});

async function computeFormulationSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode([
    "juro.private-name-classification.v1",
    text.normalize("NFC"),
  ].join("\n")));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

test("local PII attestation is hash-bound and preserves only declared legal titles", async () => {
  const text = "Companies Act protects John and Иван Петров.";
  const formulationSha256 = await computeFormulationSha256(text);
  const result = await classifyTargetPrivateNames({
    text,
    formulationSha256,
    legalTitleSpans: ["Companies Act"],
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.privateNameSpans, ["John", "Иван Петров"]);
  assert.equal(result.privateNameSpans.includes("Companies Act"), false);

  const mismatch = await classifyTargetPrivateNames({
    text,
    formulationSha256: "0".repeat(64),
    legalTitleSpans: ["Companies Act"],
  });
  assert.equal(mismatch.status, "uncertain");
});

const plan = {
  id: "plan-general",
  originalLanguage: "en",
  answerLanguage: "en",
  readings: [{
    id: "reading-one",
    statement: "First plausible reading",
    requirements: [{ id: "requirement-one", statement: "First governing rule" }],
  }, {
    id: "reading-two",
    statement: "Second plausible reading",
    requirements: [{ id: "requirement-two", statement: "Second governing rule" }],
  }],
  formulations: [{
    id: "formulation-one",
    text: "first governing rule",
    privateNameSpans: [],
    readingIds: ["reading-one"],
    requirementIds: ["requirement-one"],
    kind: "exact" as const,
  }, {
    id: "formulation-two",
    text: "second governing rule",
    privateNameSpans: [],
    readingIds: ["reading-two"],
    requirementIds: ["requirement-two"],
    kind: "legal_register" as const,
  }],
  missingCaseFacts: [],
};

function selectionCandidate(itemKey: string, retrievalRequirementIds: string[], score: number) {
  return {
    candidate: {
      candidate: {
        itemKey,
        instanceId: "instance-one",
        shardId: "shard-one",
        formulationIds: ["formulation-one"],
        formulationMatches: [{
          formulationId: "formulation-one",
          rank: 1,
          fusionScore: score,
        }],
        readingIds: ["reading-one", "reading-two"],
        retrievalRequirementIds,
        vectorRank: 1,
        vectorScore: score,
        keywordRank: 1,
        keywordScore: score,
        fusionScore: score,
      },
      canonicalChunkId: `chunk-${itemKey}`,
      provisionRenditionId: `rendition-${itemKey}`,
      textRevisionId: `revision-${itemKey}`,
      provisionConceptId: `concept-${itemKey}`,
      languageFamily: "en" as const,
      textualAuthority: "controlling" as const,
    },
    citationLabel: `Act — Article ${itemKey}`,
    provisionText: `Verified provision text for ${itemKey}`,
  };
}

test("new mandatory article references must originate in inspected candidate context", () => {
  const candidate = selectionCandidate("governing", ["requirement-one", "requirement-two"], 1);
  candidate.provisionText = "The governing rule applies. Article 88 establishes the necessary exception.";
  for (const article of [88, 987]) {
    const decision = selectTargetProvisions({plan, candidates: [candidate], repairAttempted: false}, {
      mappings: [{itemKey: "governing", supportedRequirementIds: ["requirement-one", "requirement-two"]}],
      additionalRequirements: [{sourceItemKey: "governing", readingId: "reading-one",
        statement: `Necessary exception under Article ${article}`, priority: "core"}],
    });
    assert.equal(decision.outcome, article === 88 ? "repair" : "selected");
    if (decision.outcome === "repair") assert.deepEqual(decision.additionalRequirements?.[0]?.requirement.origin, {
      kind: "inspected_candidate", itemKey: "governing", provisionRenditionId: "rendition-governing",
      textRevisionId: "revision-governing", languageFamily: "en",
    });
  }
});

test("provision selection uses the minimum assessed Provision Set rather than redundant hits", () => {
  const selectionInput = {
    plan,
    candidates: [
      selectionCandidate("irrelevant-high", ["requirement-one", "requirement-two"], 0.99),
      selectionCandidate("item-one", ["requirement-one"], 0.9),
      selectionCandidate("item-one-complement", ["requirement-one"], 0.85),
      selectionCandidate("item-two", ["requirement-two"], 0.8),
    ],
    repairAttempted: false,
  };
  const selected = selectTargetProvisions(selectionInput, { mappings: [{
    itemKey: "irrelevant-high", supportedRequirementIds: [],
  }, {
    itemKey: "item-one", supportedRequirementIds: ["requirement-one"],
  }, {
    itemKey: "item-one-complement", supportedRequirementIds: ["requirement-one"],
  }, {
    itemKey: "item-two", supportedRequirementIds: ["requirement-two"],
  }], additionalRequirements: [] });
  assert.equal(selected.outcome, "selected");
  if (selected.outcome === "selected") {
    assert.deepEqual(selected.propositions.map(({ requirementId }) => requirementId), [
      "requirement-one", "requirement-two",
    ]);
    assert.deepEqual(selected.selections.map(({ itemKey }) => itemKey), ["item-one", "item-two"]);
  }

  const repair = selectTargetProvisions({
    plan,
    candidates: [selectionCandidate("item-one", ["requirement-one"], 0.9)],
    repairAttempted: false,
  }, { mappings: [{ itemKey: "item-one", supportedRequirementIds: ["requirement-one"] }], additionalRequirements: [] });
  assert.equal(repair.outcome, "repair");
  if (repair.outcome === "repair") {
    assert.deepEqual(repair.repairFormulation.requirementIds, ["requirement-two"]);
  }

  const unrelated = selectTargetProvisions({
    plan,
    candidates: [selectionCandidate("irrelevant-high", ["requirement-one", "requirement-two"], 0.99)],
    repairAttempted: false,
  }, { mappings: [{ itemKey: "irrelevant-high", supportedRequirementIds: [] }], additionalRequirements: [] });
  assert.equal(unrelated.outcome, "repair");
  if (unrelated.outcome === "repair") {
    assert.deepEqual(unrelated.repairFormulation.requirementIds, ["requirement-one"]);
  }
});

test("assessed support retrieved for the same requirement wins retrieval-score ties", () => {
  const result = selectTargetProvisions({
    plan,
    candidates: [
      selectionCandidate("cross-topic-high", ["requirement-two"], 0.99),
      selectionCandidate("aligned-one", ["requirement-one"], 0.7),
      selectionCandidate("aligned-two", ["requirement-two"], 0.6),
    ],
    repairAttempted: false,
  }, { mappings: [{
    itemKey: "cross-topic-high", supportedRequirementIds: ["requirement-one"],
  }, {
    itemKey: "aligned-one", supportedRequirementIds: ["requirement-one"],
  }, {
    itemKey: "aligned-two", supportedRequirementIds: ["requirement-two"],
  }], additionalRequirements: [] });
  assert.equal(result.outcome, "selected");
  if (result.outcome === "selected") {
    assert.deepEqual(result.selections.map(({ itemKey }) => itemKey), [
      "aligned-one", "aligned-two",
    ]);
  }
});

test("requirement-specific formulation rank beats broad cross-formulation popularity", () => {
  const direct = selectionCandidate("direct-rule", ["requirement-one"], 0.2);
  direct.candidate.candidate.formulationIds = ["formulation-one"];
  direct.candidate.candidate.formulationMatches = [{
    formulationId: "formulation-one",
    rank: 1,
    fusionScore: 0.2,
  }];
  const broad = selectionCandidate("broad-guidance", ["requirement-one", "requirement-two"], 0.99);
  broad.candidate.candidate.formulationIds = ["formulation-one", "formulation-two"];
  broad.candidate.candidate.formulationMatches = [{
    formulationId: "formulation-one",
    rank: 8,
    fusionScore: 0.99,
  }, {
    formulationId: "formulation-two",
    rank: 1,
    fusionScore: 0.99,
  }];
  const second = selectionCandidate("second-rule", ["requirement-two"], 0.1);
  second.candidate.candidate.formulationIds = ["formulation-two"];
  second.candidate.candidate.formulationMatches = [{
    formulationId: "formulation-two",
    rank: 2,
    fusionScore: 0.1,
  }];

  const result = selectTargetProvisions({
    plan,
    candidates: [broad, direct, second],
    repairAttempted: false,
  }, { mappings: [{
    itemKey: "broad-guidance",
    supportedRequirementIds: ["requirement-one", "requirement-two"],
  }, {
    itemKey: "direct-rule",
    supportedRequirementIds: ["requirement-one"],
  }, {
    itemKey: "second-rule",
    supportedRequirementIds: ["requirement-two"],
  }], additionalRequirements: [] });

  assert.equal(result.outcome, "selected");
  if (result.outcome === "selected") {
    assert.deepEqual(result.selections.map(({ itemKey }) => itemKey), ["direct-rule", "broad-guidance"]);
  }
});

test("an operative governing provision beats a higher-ranked cross-reference", () => {
  const direct = selectionCandidate("operative-direct-rule", ["requirement-one"], 0.2);
  direct.candidate.candidate.formulationMatches = [{
    formulationId: "formulation-one",
    rank: 8,
    fusionScore: 0.2,
  }];
  const broad = selectionCandidate("higher-ranked-broad-rule", ["requirement-one"], 0.99);
  broad.candidate.candidate.formulationMatches = [{
    formulationId: "formulation-one",
    rank: 1,
    fusionScore: 0.99,
  }];
  const second = selectionCandidate("second-rule", ["requirement-two"], 0.1);

  const result = selectTargetProvisions({
    plan,
    candidates: [broad, direct, second],
    repairAttempted: false,
  }, { mappings: [{
    itemKey: "higher-ranked-broad-rule",
    supportedRequirementIds: ["requirement-one"],
  }, {
    itemKey: "operative-direct-rule",
    supportedRequirementIds: ["requirement-one"],
    governingRequirementIds: ["requirement-one"],
  }, {
    itemKey: "second-rule",
    supportedRequirementIds: ["requirement-two"],
  }], additionalRequirements: [] });

  assert.equal(result.outcome, "selected");
  if (result.outcome === "selected") {
    assert.deepEqual(result.selections.map(({ itemKey }) => itemKey), [
      "operative-direct-rule", "second-rule",
    ]);
  }
});

test("literal search wording cannot replace assessed Requirement Support", () => {
  const literal = selectionCandidate("literal", ["requirement-one"], 0.7);
  literal.provisionText = "Article heading. First governing rule. Exact controlling text.";
  const result = selectTargetProvisions({
    plan,
    candidates: [literal, selectionCandidate("item-two", ["requirement-two"], 0.6)],
    repairAttempted: false,
  }, { mappings: [{
    itemKey: "item-two", supportedRequirementIds: ["requirement-two"],
  }], additionalRequirements: [] });

  assert.equal(result.outcome, "repair");
  if (result.outcome === "repair") {
    assert.deepEqual(result.repairFormulation.requirementIds, ["requirement-one"]);
  }
});

test("filing coverage is not inferred from a literal forum match in a processing provision", () => {
  const filingPlan = {
    ...plan,
    readings: [{ id: "reading-one", statement: "Time to file a complaint",
      requirements: [{ id: "filing", statement: "Deadline for the applicant to file with the review commission", priority: "core" as const }] }],
    formulations: [{ ...plan.formulations[0]!, text: "review commission procedure", requirementIds: ["filing"] }],
  };
  const processing = selectionCandidate("processing", ["filing"], 0.99);
  processing.provisionText = "Review commission procedure. The commission examines a submitted complaint within ten days.";
  const result = selectTargetProvisions({ plan: filingPlan, candidates: [processing], repairAttempted: false },
    { mappings: [], additionalRequirements: [] });
  assert.equal(result.outcome, "repair");
});

test("operative support outranks incidental support regardless of retrieval formulation", () => {
  const direct = selectionCandidate("filing-rule", ["requirement-two"], 0.5);
  const incidental = selectionCandidate("processing-rule", ["requirement-one"], 0.99);
  const result = selectTargetProvisions({ plan, candidates: [direct, incidental], repairAttempted: false }, {
    mappings: [
      { itemKey: "filing-rule", supportedRequirementIds: ["requirement-one", "requirement-two"], governingRequirementIds: ["requirement-one", "requirement-two"] },
      { itemKey: "processing-rule", supportedRequirementIds: ["requirement-one"], governingRequirementIds: [] },
    ], additionalRequirements: [],
  });
  assert.equal(result.outcome, "selected");
  if (result.outcome === "selected") assert.deepEqual(result.selections.map(({ itemKey }) => itemKey), ["filing-rule"]);
});

test("selection preserves supported core requirements when only supporting coverage remains open", () => {
  const partialPlan = {
    ...plan,
    readings: [{
      id: "reading-one",
      statement: "Requested legal outcome",
      requirements: [{ id: "requirement-one", statement: "Governing rule", priority: "core" as const }, {
        id: "requirement-remedy", statement: "Available remedy", priority: "supporting" as const,
      }],
    }],
    formulations: [{
      ...plan.formulations[0]!,
      readingIds: ["reading-one"],
      requirementIds: ["requirement-one", "requirement-remedy"],
    }],
  };
  const result = selectTargetProvisions({
    plan: partialPlan,
    candidates: [selectionCandidate("item-one", ["requirement-one", "requirement-remedy"], 0.9)],
    repairAttempted: true,
  }, { mappings: [{ itemKey: "item-one", supportedRequirementIds: ["requirement-one"] }], additionalRequirements: [] });
  assert.equal(result.outcome, "partial");
  if (result.outcome === "partial") {
    assert.deepEqual(result.uncoveredSupportingRequirementIds, ["requirement-remedy"]);
    assert.deepEqual(result.selections[0]?.requirementIds, ["requirement-one"]);
  }
});

test("a dedicated formulation does not repeat an uncovered supporting search", () => {
  const dedicatedPlan = {
    ...plan,
    readings: [{
      id: "reading-one",
      statement: "Requested legal outcome",
      requirements: [{ id: "requirement-one", statement: "Governing rule", priority: "core" as const }, {
        id: "requirement-remedy", statement: "Available remedy", priority: "supporting" as const,
      }],
    }],
    formulations: [{
      ...plan.formulations[0]!,
      readingIds: ["reading-one"],
      requirementIds: ["requirement-one"],
    }, {
      ...plan.formulations[1]!,
      readingIds: ["reading-one"],
      requirementIds: ["requirement-remedy"],
    }],
  };
  const result = selectTargetProvisions({
    plan: dedicatedPlan,
    candidates: [selectionCandidate("item-one", ["requirement-one"], 0.9)],
    repairAttempted: false,
  }, { mappings: [{ itemKey: "item-one", supportedRequirementIds: ["requirement-one"] }], additionalRequirements: [] });

  assert.equal(result.outcome, "partial");
  if (result.outcome === "partial") {
    assert.deepEqual(result.uncoveredSupportingRequirementIds, ["requirement-remedy"]);
  }
});

test("support context supplies reading identifiers required by related-provision discovery", () => {
  const context = targetRequirementSupportContext(plan);
  assert.deepEqual(context.map(item => item.readingId), ["reading-one", "reading-two"]);
});

test("a coverage requirement retains distinct operative provisions, not only its highest-ranked hit", () => {
  const direct = selectionCandidate("civil-remedy", ["requirement-one"], 0.9);
  const complementary = selectionCandidate("liability", ["requirement-one"], 0.8);
  const translated = selectionCandidate("civil-remedy-translation", ["requirement-one"], 0.7);
  translated.candidate.provisionConceptId = direct.candidate.provisionConceptId;
  const result = selectTargetProvisions({
    plan: {...plan, readings: [plan.readings[0]!], formulations: [plan.formulations[0]!]},
    candidates: [direct, complementary, translated], repairAttempted: true,
  }, {mappings: [direct, complementary, translated].map(candidate => ({
    itemKey: candidate.candidate.candidate.itemKey, supportedRequirementIds: ["requirement-one"], governingRequirementIds: ["requirement-one"],
  })), additionalRequirements: []});
  assert.equal(result.outcome, "selected");
  if (result.outcome === "selected") assert.deepEqual(result.selections.map(item => item.itemKey), ["civil-remedy", "liability"]);
});

test("a compact set of thirteen operative provisions is retained without dropping a rule", () => {
  const candidates = Array.from({length: 13}, (_, index) =>
    selectionCandidate(`operative-${index}`, ["requirement-one"], 0.9 - index / 100));
  const result = selectTargetProvisions({
    plan: {...plan, readings: [plan.readings[0]!], formulations: [plan.formulations[0]!]},
    candidates, repairAttempted: false,
  }, {mappings: candidates.map(candidate => ({itemKey: candidate.candidate.candidate.itemKey,
    supportedRequirementIds: ["requirement-one"], governingRequirementIds: ["requirement-one"]})),
    additionalRequirements: []});
  assert.equal(result.outcome, "selected");
  if (result.outcome === "selected") assert.deepEqual(new Set(result.selections.map(item => item.itemKey)),
    new Set(candidates.map(candidate => candidate.candidate.candidate.itemKey)));
});

test("complete operative evidence exceeding the context budget is rejected without selecting a subset", () => {
  for (const [count, characters] of [[13, 3000], [25, 100]]) {
    const candidates = Array.from({length: count!}, (_, index) => ({
      ...selectionCandidate(`operative-${index}`, ["requirement-one"], 0.9 - index / 100),
      provisionText: "x".repeat(characters!),
    }));
    const result = selectTargetProvisions({
      plan: {...plan, readings: [plan.readings[0]!], formulations: [plan.formulations[0]!]},
      candidates, repairAttempted: false,
    }, {mappings: candidates.map(candidate => ({itemKey: candidate.candidate.candidate.itemKey,
      supportedRequirementIds: ["requirement-one"], governingRequirementIds: ["requirement-one"]})),
      additionalRequirements: []});
    assert.equal(result.outcome, "rejected");
  }
});

test("an explicit provision reference can trigger one bounded generic repair", () => {
  const candidate = selectionCandidate("item-one", ["requirement-one"], 0.9);
  const result = selectTargetProvisions({
    plan: {
      ...plan,
      readings: [plan.readings[0]!],
      formulations: Array.from({ length: 6 }, (_, index) => ({
        ...plan.formulations[0]!,
        id: `formulation-${index + 1}`,
      })),
    },
    candidates: [candidate],
    repairAttempted: false,
  }, {
    mappings: [{ itemKey: "item-one", supportedRequirementIds: ["requirement-one"] }],
    additionalRequirements: [{
      sourceItemKey: "item-one",
      readingId: "reading-one",
      statement: "The expressly referenced exception must also be checked.",
      priority: "supporting",
    }],
  });
  assert.equal(result.outcome, "repair");
  if (result.outcome === "repair") {
    assert.equal(result.additionalRequirements?.length, 1);
    assert.deepEqual(result.repairFormulation.requirementIds, ["related-reading-one-1"]);
  }
});

test("an irrelevant search hit cannot spend the repair budget on a new scope", () => {
  const result = selectTargetProvisions({plan,
    candidates: [selectionCandidate("supported", ["requirement-one", "requirement-two"], 0.8),
      selectionCandidate("unrelated", ["requirement-one"], 0.9)], repairAttempted: false,
  }, {mappings: [{itemKey: "supported", supportedRequirementIds: ["requirement-one", "requirement-two"]}],
    additionalRequirements: [{sourceItemKey: "unrelated", readingId: "reading-one",
      statement: "A different actor's procedure", priority: "core"}],
  });
  assert.equal(result.outcome, "selected");
});

test("assessment batches see already verified references without mixing revisions", () => {
  const source = selectionCandidate("source", ["requirement-one"], 0.9);
  source.provisionText = "The exception is defined in Article 732 of this Act.";
  const reference = selectionCandidate("reference", ["requirement-one"], 0.8);
  reference.citationLabel = "Example Act — Article 732";
  reference.candidate.textRevisionId = source.candidate.textRevisionId;
  reference.provisionText = "Article 732. The exception requires written notice.";
  const otherRevision = selectionCandidate("other", ["requirement-one"], 0.7);
  otherRevision.citationLabel = reference.citationLabel;
  assert.deepEqual(selectionReferenceContext([source], [source, otherRevision, reference]).map(({citationLabel, provisionText}) => ({citationLabel, provisionText})),
    [{citationLabel: reference.citationLabel, provisionText: reference.provisionText}]);
  assert.deepEqual(selectionReferenceContext([source, reference], [source, reference]), []);
  source.provisionText = "See Article 732 of a different Act.";
  assert.deepEqual(selectionReferenceContext([source], [source, reference]), []);
  source.provisionText = "No explicit reference is supplied.";
  assert.deepEqual(selectionReferenceContext([source], [source, reference]), []);
});

test("assessment groups an explicit rule and its grounds without dropping intervening candidates", () => {
  const source = selectionCandidate("referring-rule", ["requirement-one"], 0.9);
  source.citationLabel = "Example Act — Article 700";
  source.provisionText = "Only the grounds in Article 732 of this Act apply.";
  const noise = Array.from({length: 9}, (_, index) => selectionCandidate(`other-${index}`, ["requirement-one"], 0.8));
  const grounds = selectionCandidate("referenced-grounds", ["requirement-one"], 0.7);
  grounds.candidate.textRevisionId = source.candidate.textRevisionId;
  grounds.citationLabel = "Example Act — Article 732";
  const input = [source, ...noise, grounds];
  const batches = selectionAssessmentBatches(input, 8);
  assert.equal(batches[0]?.includes(grounds), true, "explicitly referenced grounds must be in the referring rule's batch");
  assert.ok(batches.every(batch => batch.length <= 8));
  assert.equal(batches.flat().length, input.length);
  assert.deepEqual(new Set(batches.flat()), new Set(input));
  const foreign = structuredClone(grounds);
  foreign.candidate.textRevisionId = "foreign-revision";
  assert.ok(!selectionAssessmentBatches([source, ...noise, foreign], 8)[0]?.includes(foreign));
  assert.throws(() => selectionAssessmentBatches(input, 0));
});

test("referenced grounds see the referring status rule during their own assessment", () => {
  const referring = selectionCandidate("protected-status", ["requirement-one"], 0.9);
  referring.citationLabel = "Example Act — Article 700";
  referring.provisionText = "For a licensed representative, only the grounds in Article 732 of this Act apply.";
  const grounds = selectionCandidate("grounds", ["requirement-one"], 0.8);
  grounds.citationLabel = "Example Act — Article 732";
  grounds.provisionText = "Article 732. The grounds are dissolution and serious misconduct.";
  grounds.candidate.textRevisionId = referring.candidate.textRevisionId;
  assert.deepEqual(selectionReferenceContext([grounds], [grounds, referring]).map(({citationLabel, provisionText}) => ({citationLabel, provisionText})),
    [{citationLabel: referring.citationLabel, provisionText: referring.provisionText}]);
  const foreign = structuredClone(referring);
  foreign.candidate.textRevisionId = "another-revision";
  assert.deepEqual(selectionReferenceContext([grounds], [grounds, foreign]), []);
  referring.provisionText = "See Article 732 of another Act.";
  assert.deepEqual(selectionReferenceContext([grounds], [grounds, referring]), []);
});

test("repair retains material cross-references while another requirement is uncovered", () => {
  const result = selectTargetProvisions({ plan,
    candidates: [selectionCandidate("item-one", ["requirement-one"], 0.9)], repairAttempted: false,
  }, { mappings: [{itemKey: "item-one", supportedRequirementIds: ["requirement-one"]}],
    additionalRequirements: [{sourceItemKey: "item-one", readingId: "reading-one",
      statement: "The expressly referenced grounds defining the exception", priority: "core"}],
  });
  assert.equal(result.outcome, "repair");
  if (result.outcome === "repair") {
    assert.equal(result.additionalRequirements?.length, 1);
    assert.ok(result.repairFormulation.requirementIds.includes("requirement-two"));
    assert.ok(result.repairFormulation.requirementIds.includes("related-reading-one-1"));
    assert.deepEqual(result.retainedItemKeys, ["item-one"]);
  }
});

test("complete reference chains cross assessment batches without the former four-context ceiling", () => {
  const chain = Array.from({length: 12}, (_, index) => {
    const candidate = selectionCandidate(`chain-${index}`, ["requirement-one"], 0.8);
    candidate.candidate.textRevisionId = "same-authenticated-revision";
    candidate.citationLabel = `Example Act — Article ${700 + index}`;
    candidate.provisionText = index === 11 ? "Written notice is required."
      : `The conditions in Article ${701 + index} of this Act also apply.`;
    return candidate;
  });
  const batches = selectionAssessmentBatches(chain, 8);
  assert.equal(batches.length, 2);
  const context = selectionReferenceContext(batches[1]!, chain);
  assert.equal(context.length, 8);
  assert.deepEqual(new Set(context.map(item => item.evidenceIdentity.provisionRenditionId)),
    new Set(chain.slice(0, 8).map(item => item.candidate.provisionRenditionId)));
  assert.ok(context.every(item => item.evidenceIdentity.textRevisionId === "same-authenticated-revision"));
  const otherLanguage = {...chain[0]!, candidate: {...chain[0]!.candidate,
    languageFamily: "ru", candidate: {...chain[0]!.candidate.candidate, itemKey: "other-language"}}};
  assert.equal(selectionReferenceContext([chain[1]!], [chain[1]!, otherLanguage]).length, 0);
});

test("assessment partitions complete short provisions and rejects oversized connected material explicitly", () => {
  const short = Array.from({length: 13}, (_, index) => selectionCandidate(`short-${index}`, ["requirement-one"], 0.8));
  assert.equal(selectionAssessmentBatches(short, 8).flat().length, 13);
  const long = short.map(item => ({...item, provisionText: "Complete paragraph. ".repeat(600)}));
  const batches = selectionAssessmentBatches(long, 8);
  assert.equal(batches.flat().length, 13);
  assert.ok(batches.every(batch => batch.reduce((total, item) => total + item.provisionText.length, 0) <= 32_000));
  const source = selectionCandidate("oversized-source", ["requirement-one"], 0.8);
  source.provisionText = "Complete verified material. ".repeat(2000);
  assert.throws(() => selectionAssessmentBatches([source], 8), /INDEXED_EVIDENCE_CONTEXT_EXCEEDED/u);
  const pair = long.slice(0, 2).map((item, index) => ({...item,
    candidate: {...item.candidate, textRevisionId: "shared-revision"},
    citationLabel: `Example Act — Article ${700 + index}`,
    provisionText: `See Article ${index === 0 ? 701 : 700} of this Act. ${"Operative condition. ".repeat(900)}`,
  }));
  assert.throws(() => selectionAssessmentBatches(pair, 8), /INDEXED_EVIDENCE_CONTEXT_EXCEEDED/u);
});

test("reasoning routes require the exact private service boundary", async () => {
  const body = {
    plan,
    candidates: [
      selectionCandidate("item-one", ["requirement-one"], 0.9),
      selectionCandidate("item-two", ["requirement-two"], 0.8),
    ],
    repairAttempted: false,
  };
  const accepted = await handleTargetReasoningServiceRequest(new Request(
    `http://legal-corpus.internal${TARGET_PROVISION_SELECTION_PATH}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-juro-service-binding": "target-retrieval-runtime-v1",
        "x-juro-legal-environment": "staging",
      },
      body: JSON.stringify(body),
    },
  ), { APP_ENV: "staging" }, {
    assessSupport: async () => ({ mappings: [{
      itemKey: "item-one", supportedRequirementIds: ["requirement-one"],
    }, {
      itemKey: "item-two", supportedRequirementIds: ["requirement-two"],
    }], additionalRequirements: [] }),
  });
  assert.equal(accepted.status, 200);

  const publicRequest = await handleTargetReasoningServiceRequest(new Request(
    `https://app.juro.uz${TARGET_PRIVATE_NAME_CLASSIFICATION_PATH}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  ), { APP_ENV: "production" });
  assert.equal(publicRequest.status, 404);
});
