import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { MAX_LEGAL_EVIDENCE_SOURCES } from "../lib/legal/legal-evidence-budget";

import {
  createInMemoryCandidateIndex,
  parsePinnedCandidateRelease,
  type PinnedCandidateRelease,
  type TemporalEndpoint,
} from "../lib/legal-corpus/legal-candidate-index";
import {
  recordOfficialExpressionEquivalence,
  recordProvisionLineage,
  resolveProvisionLineage,
} from "../lib/legal-corpus/target-lineage";
import { parseControllingEvidenceResolution } from "../lib/legal-corpus/target-evidence";
import {
  canonicalChunkIdSchema,
  provisionConceptIdSchema,
  provisionRenditionIdSchema,
  textRevisionIdSchema,
} from "../lib/legal-corpus/target-domain-schemas";
import {
  createTargetLegalAnswerRetriever,
  type QuestionInterpretationPlan,
} from "../lib/legal-corpus/target-retrieval";
import { sqliteD1FixtureFromDirectory } from "./helpers/sqlite-d1";

const current = { kind: "current" as const };
const past = { kind: "timestamp" as const, instant: "2024-01-01T00:00:00.000Z" };

const endpointIdentity = (endpoint: TemporalEndpoint) =>
  endpoint.kind === "current" ? "current" : endpoint.instant.slice(0, 4);

const endpointProvisionText = (endpoint: TemporalEndpoint) => endpoint.kind === "current"
  ? "Current governing text."
  : `Historical governing text for ${endpointIdentity(endpoint)}.`;

const release = (endpoint: TemporalEndpoint): PinnedCandidateRelease => parsePinnedCandidateRelease({
  id: endpoint.kind === "current" ? "release-current-comparison" : "release-history-comparison",
  environment: "development",
  capability: endpoint.kind === "current" ? "current" : "history",
  instances: [{
    id: endpoint.kind === "current" ? "current-00" : "history-00",
    shardId: endpoint.kind === "current" ? "current-00" : "history-00",
  }],
  configuration: {
    identity: "comparison-config-v1",
    embeddingModel: "openai/text-embedding-3-large",
    dimensions: 1_536,
    keywordTokenizer: "porter",
    metadataSchema: ["language", "document_type", "valid_from", "valid_to"],
    gatewayIdentity: "juro-ai-search-development",
    providerProjectIdentity: "juro-openai-development",
    gatewayPayloadLogging: false,
    gatewayCaching: false,
    similarityCaching: false,
  },
});

function comparisonPlan(left: TemporalEndpoint, right: TemporalEndpoint): QuestionInterpretationPlan {
  return {
    id: "plan-comparison",
    originalLanguage: "en",
    answerLanguage: "en",
    comparison: { left, right },
    readings: [{
      id: "reading-change",
      statement: "How the governing rule changed",
      requirements: [{ id: "requirement-change", statement: "Governing rule at each endpoint" }],
    }],
    formulations: [{
      id: "formulation-change",
      text: "governing rule",
      privateNameSpans: [],
      readingIds: ["reading-change"],
      requirementIds: ["requirement-change"],
      kind: "legal_register",
    }],
    missingCaseFacts: [],
  };
}

function stableIdentity(provisionRenditionId: string, provisionConceptId: string) {
  return {
    provisionRenditionId: provisionRenditionIdSchema.parse(provisionRenditionId),
    canonicalChunkId: canonicalChunkIdSchema.parse(`chunk-for-${provisionRenditionId}`),
    textRevisionId: textRevisionIdSchema.parse(`revision-for-${provisionRenditionId}`),
    provisionConceptId: provisionConceptIdSchema.parse(provisionConceptId),
    languageFamily: "uz" as const,
    textualAuthority: "controlling" as const,
  };
}

function comparisonRetriever(
  left: TemporalEndpoint,
  right: TemporalEndpoint,
  calls: TemporalEndpoint[],
  lineage: (leftConceptIds: string[], rightConceptIds: string[]) => Promise<Array<{
    id: string;
    predecessorConceptId: string;
    successorConceptId: string | null;
    transition: "unchanged" | "modified" | "renumbered" | "moved" | "split" | "merged" | "repealed";
    evidenceUrl: string;
    reviewState: "accepted";
  }>> = async (leftConceptIds, rightConceptIds) => [{
    id: "lineage-modified",
    predecessorConceptId: leftConceptIds[0]!,
    successorConceptId: rightConceptIds[0]!,
    transition: leftConceptIds[0] === rightConceptIds[0] ? "unchanged" : "modified",
    evidenceUrl: "https://lex.uz/docs/990",
    reviewState: "accepted",
  }],
  comparisonPins?: Array<[TemporalEndpoint, TemporalEndpoint]>,
) {
  return createTargetLegalAnswerRetriever({
    environment: "development",
    interpreter: { interpret: async () => comparisonPlan(left, right) },
    releaseResolver: {
      resolve: async (endpoint) => {
        if (comparisonPins) assert.fail("comparison endpoints must use the pinned release pair");
        return release(endpoint);
      },
      ...(comparisonPins ? { resolveComparison: async (
        pinnedLeft: TemporalEndpoint, pinnedRight: TemporalEndpoint,
      ) => {
        assert.equal(comparisonPins.length, 0, "Resolve a shared comparison once, without recursive reinterpretation");
        comparisonPins.push([pinnedLeft, pinnedRight]);
        return { left: release(pinnedLeft), right: release(pinnedRight) };
      } } : {}),
    },
    candidateIndex: createInMemoryCandidateIndex(async (formulation, endpoint, pinned) => {
      calls.push(endpoint);
      const side = endpointIdentity(endpoint);
      return [{
        itemKey: `search-releases/${pinned.id}/${side}/${side}-rendition.md`,
        instanceId: pinned.instances[0]!.id,
        shardId: pinned.instances[0]!.shardId,
        formulationIds: [formulation.id],
        readingIds: formulation.readingIds,
        retrievalRequirementIds: formulation.requirementIds,
        vectorRank: 1,
        vectorScore: 0.9,
        keywordRank: 1,
        keywordScore: 4,
        fusionScore: 0.8,
      }];
    }),
    candidateCatalog: {
      revalidate: async (packet, endpoint) => packet.candidates.map((candidate) => ({
        candidate,
        ...stableIdentity(
          `rendition-${endpointIdentity(endpoint)}`,
          `concept-${endpointIdentity(endpoint)}`,
        ),
      })),
    },
    evidenceResolver: {
      resolveControlling: async (id, endpoint) => {
        const identity = endpointIdentity(endpoint);
        return parseControllingEvidenceResolution({ controlling: {
          legalInstrumentId: "instrument-comparison",
          officialExpressionId: "expression-comparison",
          textRevisionId: `revision-${identity}`,
          provisionConceptId: `concept-${identity}`,
          provisionRenditionId: id,
          languageTag: "uz-Latn",
          script: "Latn",
          textualAuthority: "controlling",
          provisionText: endpointProvisionText(endpoint),
          officialCitation: { label: "Act — Article 1", url: "https://lex.uz/docs/990" },
          evidence: {
            provisionRenditionId: id,
            r2Key: `corpus/provisions/${id}.json`,
            byteCount: 10,
            sha256: createHash("sha256").update(`comparison-evidence-${identity}`).digest("hex"),
            sourceNormalizedSha256: "a".repeat(64),
            schemaVersion: 1,
          },
        },
        materialCitation: { label: "Act — Article 1", url: "https://lex.uz/docs/990" },
        });
      },
    },
    provisionSelector: {
      select: async ({ candidates }) => ({
        outcome: "selected",
        mainPoint: "Endpoint-specific governing rule.",
        propositions: candidates[0]!.candidate.candidate.retrievalRequirementIds.map(requirementId => ({ requirementId, statement: "Endpoint rule" })),
        selections: [{ itemKey: candidates[0]!.candidate.candidate.itemKey, requirementIds: candidates[0]!.candidate.candidate.retrievalRequirementIds }],
        whatToDoNext: [],
      }),
    },
    lineageResolver: { resolve: lineage },
  });
}

test("shared planning hints execute each comparison endpoint without reentering comparison", async () => {
  const left: TemporalEndpoint = {kind: "timestamp", instant: "2020-01-01T00:00:00.000Z"};
  const right: TemporalEndpoint = {kind: "current"};
  const calls: TemporalEndpoint[] = [];
  const pins: Array<[TemporalEndpoint, TemporalEndpoint]> = [];
  const result = await comparisonRetriever(left, right, calls, undefined, pins).answer({
    id: "shared-comparison", question: "Compare the rule in 2020 with today",
    planningHints: {answerLanguage: "en", standaloneQuestion: "Compare the rule in 2020 with today",
      requirements: [{statement: "Governing rule", priority: "core"}], formulations: ["Governing rule"],
      comparison: {left, right}},
  });
  assert.equal(result.kind, "comparison_answer");
  assert.deepEqual(pins, [[left, right]]);
  assert.deepEqual(calls, [left, right]);
});

test("comparison pins both endpoint releases from one resolver decision", async () => {
  const calls: TemporalEndpoint[] = [];
  const pins: Array<[TemporalEndpoint, TemporalEndpoint]> = [];
  const result = await comparisonRetriever(current, past, calls, undefined, pins).answer({
    id: "question-pinned-comparison",
    question: "How did the rule change?",
  });
  assert.equal(result.kind, "comparison_answer");
  assert.deepEqual(pins, [[current, past]]);
});

for (const [label, left, right] of [
  ["current/current", current, current],
  ["current/timestamp", current, past],
  ["timestamp/current", past, current],
  ["timestamp/timestamp", past, { ...past, instant: "2025-01-01T00:00:00.000Z" }],
] as const) {
  test(`comparison supports ${label} with independent Provision Sets`, async () => {
    const calls: TemporalEndpoint[] = [];
    const result = await comparisonRetriever(left, right, calls).answer({
      id: `question-${label.replace("/", "-")}`,
      question: "How did the rule change?",
    });
    assert.equal(result.kind, "comparison_answer");
    assert.deepEqual(calls, [left, right]);
    assert.deepEqual(result.temporalScope, { kind: "comparison", left, right });
    assert.equal(result.left.whatTheLawSays[0]?.controllingQuotation,
      endpointProvisionText(left));
    assert.equal(result.right.whatTheLawSays[0]?.controllingQuotation,
      endpointProvisionText(right));
    const leftProvisionSetSha256 = createHash("sha256")
      .update(JSON.stringify(result.left.whatTheLawSays)).digest("hex");
    const rightProvisionSetSha256 = createHash("sha256")
      .update(JSON.stringify(result.right.whatTheLawSays)).digest("hex");
    if (label === "current/current") assert.equal(leftProvisionSetSha256, rightProvisionSetSha256);
    else assert.notEqual(leftProvisionSetSha256, rightProvisionSetSha256);
    assert.equal(result.endpointFormulationSearches, 2);
    assert.equal(
      result.transitions[0]?.transition,
      result.left.whatTheLawSays[0]?.provisionConceptId
        === result.right.whatTheLawSays[0]?.provisionConceptId ? "unchanged" : "modified",
    );
  });
}

test("accepted explicit many-to-many lineage represents renumber, split, merge, and repeal without article inference", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(new URL("../legal-drizzle/", import.meta.url));
  try {
    sqlite.exec(`INSERT INTO legal_instruments
      (id,publisher_instrument_token,canonical_title,document_type,canonical_url,created_at)
      VALUES ('instrument-lineage','lex-document-995','Lineage Act','act',
        'https://lex.uz/docs/995','2026-08-30T00:00:00.000Z');`);
    for (const id of ["old-a", "old-b", "new-a", "new-b", "same-number-unrelated"]) {
      sqlite.prepare(`INSERT INTO legal_provision_concepts
        (id,legal_instrument_id,publisher_concept_token,created_at)
        VALUES (?,'instrument-lineage',?,'2026-08-30T00:00:00.000Z')`).run(id, id);
    }
    const edges = [{ id: "renumber", from: "old-a", to: "new-a", transition: "renumbered" },
      { id: "split-a", from: "old-a", to: "new-a", transition: "split" },
      { id: "split-b", from: "old-a", to: "new-b", transition: "split" },
      { id: "merge-a", from: "old-a", to: "new-b", transition: "merged" },
      { id: "merge-b", from: "old-b", to: "new-b", transition: "merged" },
      { id: "repeal", from: "old-b", to: null, transition: "repealed" }] as const;
    for (const edge of edges) await recordProvisionLineage({ db: d1 }, {
      id: edge.id,
      predecessorConceptId: edge.from,
      successorConceptId: edge.to,
      transition: edge.transition,
      evidenceUrl: "https://lex.uz/docs/995",
      reviewState: "accepted",
      reviewedBy: "legal-data-reviewer",
      reviewedAt: "2026-08-30T00:00:00.000Z",
      recordedAt: "2026-08-30T00:00:00.000Z",
    });
    const resolved = await resolveProvisionLineage({ db: d1 },
      ["old-a", "old-b", "same-number-unrelated"], ["new-a", "new-b"]);
    assert.deepEqual(resolved.map(({ id }) => id).sort(), edges.map(({ id }) => id).sort());
    assert.equal(resolved.some((edge) => edge.predecessorConceptId === "same-number-unrelated"), false);
  } finally {
    sqlite.close();
  }
});

test("official-expression equivalence rejects an incidental duplicate identity", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(new URL("../legal-drizzle/", import.meta.url));
  try {
    sqlite.exec(`INSERT INTO legal_instruments
      (id,publisher_instrument_token,canonical_title,document_type,canonical_url,created_at)
      VALUES ('instrument-equivalence','lex-document-997','Equivalence Act','act',
        'https://lex.uz/docs/997','2026-08-30T00:00:00.000Z');
      INSERT INTO legal_official_expressions
      (id,legal_instrument_id,language_tag,source_url,created_at,script,textual_authority)
      VALUES
      ('expression-equivalence-uz','instrument-equivalence','uz-Latn','https://lex.uz/docs/997',
        '2026-08-30T00:00:00.000Z','Latn','controlling'),
      ('expression-equivalence-ru','instrument-equivalence','ru','https://lex.uz/ru/docs/997',
        '2026-08-30T00:00:00.000Z','Cyrl','official_translation');`);
    const evidence = {
      id: "equivalence-997",
      leftExpressionId: "expression-equivalence-uz",
      rightExpressionId: "expression-equivalence-ru",
      equivalenceKind: "official_translation" as const,
      evidenceUrl: "https://lex.uz/docs/997",
      reviewState: "accepted" as const,
      reviewedBy: "legal-data-reviewer",
      reviewedAt: "2026-08-30T00:00:00.000Z",
      recordedAt: "2026-08-30T00:00:00.000Z",
    };
    await recordOfficialExpressionEquivalence({ db: d1 }, evidence);
    await recordOfficialExpressionEquivalence({ db: d1 }, evidence);
    await assert.rejects(
      () => recordOfficialExpressionEquivalence({ db: d1 }, {
        ...evidence,
        id: "equivalence-997-alias",
      }),
      /LEGAL_LINEAGE_IDENTITY_CONFLICT/u,
    );
  } finally {
    sqlite.close();
  }
});

test("one unavailable endpoint makes the whole indexed comparison unavailable", async () => {
  const calls: TemporalEndpoint[] = [];
  const base = comparisonRetriever(past, current, calls);
  const unavailable = createTargetLegalAnswerRetriever({
    environment: "development",
    interpreter: { interpret: async () => comparisonPlan(past, current) },
    releaseResolver: { resolve: async (endpoint) => release(endpoint) },
    candidateIndex: { retrieve: async () => { throw new Error("history provider unavailable"); } },
    candidateCatalog: { revalidate: async () => [] },
    evidenceResolver: { resolveControlling: async () => assert.fail("must not hydrate") },
    provisionSelector: { select: async () => assert.fail("must not select") },
    lineageResolver: { resolve: async () => assert.fail("must not borrow lineage") },
  });
  void base;
  const result = await unavailable.answer({ id: "question-unavailable-comparison", question: "change?" });
  assert.equal(result.kind, "source_unavailability");
  if (result.kind === "source_unavailability") assert.equal(result.nextTier, "live_official_search");
});

test("a lineage edge unrelated to either selected Provision Set fails closed", async () => {
  const result = await comparisonRetriever(current, past, [], async () => [{
    id: "lineage-unrelated",
    predecessorConceptId: "concept-unrelated-left",
    successorConceptId: "concept-unrelated-right",
    transition: "modified",
    evidenceUrl: "https://lex.uz/docs/990",
    reviewState: "accepted",
  }]).answer({ id: "question-unrelated-lineage", question: "change?" });
  assert.equal(result.kind, "source_unavailability");
  if (result.kind === "source_unavailability") {
    assert.equal(result.safeErrorCode, "INDEXED_REVALIDATION_FAILED");
  }
});

for (const count of [13, MAX_LEGAL_EVIDENCE_SOURCES, MAX_LEGAL_EVIDENCE_SOURCES + 1]) {
  test(`${count} provisions are enforced independently at each comparison endpoint`, async () => {
    let endpointSearches = 0;
    const retriever = createTargetLegalAnswerRetriever({
      environment: "development",
      interpreter: { interpret: async () => comparisonPlan(past, current) },
      releaseResolver: { resolve: async (endpoint) => release(endpoint) },
      candidateIndex: createInMemoryCandidateIndex(async (formulation, endpoint, pinned) => {
        endpointSearches += 1;
        const side = endpoint.kind === "current" ? "current" : "past";
        return Array.from({ length: count }, (_, index) => ({
          itemKey: `search-releases/${pinned.id}/${side}/rendition-${side}-${index}.md`,
          instanceId: pinned.instances[0]!.id,
          shardId: pinned.instances[0]!.shardId,
          formulationIds: [formulation.id],
          readingIds: formulation.readingIds,
          retrievalRequirementIds: formulation.requirementIds,
          vectorRank: index + 1,
          vectorScore: 0.9 - index / 100,
          keywordRank: index + 1,
          keywordScore: 4 - index / 100,
          fusionScore: 0.8 - index / 100,
        }));
      }),
      candidateCatalog: {
        revalidate: async (packet) => packet.candidates.map((candidate) => ({
          candidate,
          ...stableIdentity(
            /\/past\//u.test(candidate.itemKey)
              ? `rendition-past-${candidate.vectorRank - 1}`
              : `rendition-current-${candidate.vectorRank - 1}`,
            /\/past\//u.test(candidate.itemKey)
              ? `concept-past-${candidate.vectorRank - 1}`
              : `concept-current-${candidate.vectorRank - 1}`,
          ),
        })),
      },
      evidenceResolver: {
        resolveControlling: async (id) => parseControllingEvidenceResolution({
          controlling: {
            legalInstrumentId: "instrument-ceiling",
            officialExpressionId: "expression-ceiling",
            textRevisionId: id,
            provisionConceptId: id.replace("rendition", "concept"),
            provisionRenditionId: id,
            languageTag: "uz-Latn",
            script: "Latn",
            textualAuthority: "controlling",
            provisionText: `Verified ${id}`,
            officialCitation: { label: "Ceiling Act", url: "https://lex.uz/docs/996" },
            evidence: {
              provisionRenditionId: id,
              r2Key: `corpus/provisions/${id}.json`,
              byteCount: 10,
              sha256: "b".repeat(64),
              sourceNormalizedSha256: "c".repeat(64),
              schemaVersion: 1,
            },
          },
          materialCitation: { label: "Ceiling Act", url: "https://lex.uz/docs/996" },
        }),
      },
      provisionSelector: {
        select: async ({ candidates }) => ({
          outcome: "selected",
          mainPoint: "Endpoint ceiling proof.",
          propositions: [{ requirementId: "requirement-change", statement: "Endpoint rule" }],
          selections: candidates.map(({ candidate }) => ({
            itemKey: candidate.candidate.itemKey,
            requirementIds: ["requirement-change"],
          })),
          whatToDoNext: [],
        }),
      },
      lineageResolver: {
        resolve: async (left, right) => left.map((predecessorConceptId, index) => ({
          id: `lineage-ceiling-${index}`,
          predecessorConceptId,
          successorConceptId: right[index] ?? right[0]!,
          transition: "modified" as const,
          evidenceUrl: "https://lex.uz/docs/996",
          reviewState: "accepted" as const,
        })),
      },
    });
    const result = await retriever.answer({ id: `question-ceiling-${count}`, question: "compare" });
    if (count <= MAX_LEGAL_EVIDENCE_SOURCES) {
      assert.equal(result.kind, "comparison_answer");
      if (result.kind === "comparison_answer") {
        assert.equal(result.left.whatTheLawSays.length, count);
        assert.equal(result.right.whatTheLawSays.length, count);
      }
      assert.equal(endpointSearches, 2);
    } else {
      assert.equal(result.kind, "clarification_required");
      assert.equal(endpointSearches, 1, "a failed left endpoint must stop before the right endpoint");
    }
  });
}
