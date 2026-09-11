import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryCandidateIndex, parseCandidatePacket, parsePinnedCandidateRelease, type PinnedCandidateRelease } from "../lib/legal-corpus/legal-candidate-index";
import { importProvisionRendition, parseControllingEvidenceResolution, resolveControllingEvidence } from "../lib/legal-corpus/target-evidence";
import { recordProvisionTemporalEvidence } from "../lib/legal-corpus/target-temporal";
import {
  createTargetLegalAnswerClient,
  createTargetLegalAnswerRetriever,
  boundedSelectionPool,
  handleTargetLegalAnswerRequest,
  parseRevalidatedCandidates,
  planFromQuestionPlanningHints,
  parseQuestionInterpretationPlan,
  TARGET_INITIAL_FORMULATION_LIMIT,
  type QuestionInterpretationPlan,
} from "../lib/legal-corpus/target-retrieval";
import {
  canonicalChunkIdSchema,
  provisionConceptIdSchema,
  provisionRenditionIdSchema,
  textRevisionIdSchema,
} from "../lib/legal-corpus/target-domain-schemas";
import { sqliteD1FixtureFromDirectory } from "./helpers/sqlite-d1";
import { MemoryEvidenceBucket, representativeProvision } from "./helpers/legal-target";

const release: PinnedCandidateRelease = parsePinnedCandidateRelease({
  id: "release-current-domain-general-v1",
  environment: "development",
  capability: "current",
  instances: [{ id: "current-00", shardId: "current-00" }],
  configuration: {
    identity: "ai-search-domain-general-v1",
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

test("the private answer boundary preserves late facts in long current and prior questions", async () => {
  const question = `${"Ordinary case background. ".repeat(220)} The second independent question concerns an appeal.`;
  const prior = `${"Earlier case background. ".repeat(220)} The notice was delivered on 2018-01-01.`;
  let observed = false;
  const executions: unknown[] = [];
  const client = createTargetLegalAnswerClient({environment: "development", onExecutionObserved: value => executions.push(value), service: {
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      return handleTargetLegalAnswerRequest(new Request(input, init), {environment: "development",
        versionId: "corpus-build", releaseIds: () => ["pinned-release"], retriever: {
        async answer(received) {
          assert.equal(received.question, question);
          assert.deepEqual(received.priorUserQuestions, [prior]);
          observed = true;
          return {kind: "source_unavailability", sourceLadder: "indexed_official_corpus",
            nextTier: "live_official_search", safeErrorCode: "INDEXED_CANDIDATE_UNAVAILABLE"};
        },
      }});
    },
  } as Fetcher});
  await client.answer({id: "long-question", question, priorUserQuestions: [prior]});
  assert.equal(observed, true);
  assert.partialDeepStrictEqual(executions, [{requestId: "long-question", versionId: "corpus-build", releaseIds: ["pinned-release"]}]);
});

test("the target client rejects an older service before trusting its evidence contract", async () => {
  const client = createTargetLegalAnswerClient({environment: "development", service: {
    async fetch() {return Response.json({result: {kind: "source_unavailability", sourceLadder: "indexed_official_corpus",
      nextTier: "live_official_search", safeErrorCode: "INDEXED_CANDIDATE_UNAVAILABLE"}});},
  } as unknown as Fetcher});
  await assert.rejects(client.answer({id: "old-contract", question: "Applicable rule"}), /TARGET_LEGAL_ANSWER_CONTRACT_UNAVAILABLE/);
});

test("failed execution diagnostics do not change a valid service result", async () => {
  const result = {kind: "source_unavailability" as const, sourceLadder: "indexed_official_corpus" as const,
    nextTier: "live_official_search" as const, safeErrorCode: "INDEXED_CANDIDATE_UNAVAILABLE" as const};
  const client = createTargetLegalAnswerClient({environment: "development",
    onExecutionObserved() {throw new Error("OBSERVER_FAILED");}, service: {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        return handleTargetLegalAnswerRequest(new Request(input, init), {environment: "development",
          versionId: "x".repeat(201), releaseIds() {throw new Error("RELEASE_DIAGNOSTIC_FAILED");},
          retriever: {async answer() {return result;}}});
      },
    } as unknown as Fetcher});
  assert.deepEqual(await client.answer({id: "diagnostic-failure", question: "Applicable rule"}), result);
});

test("a full shared interpretation retains grounded requirements added by support assessment", () => {
  const requirements = Array.from({length: 20}, (_, index) => ({statement: `Independent obligation ${index}`, priority: "core" as const}));
  const plan = planFromQuestionPlanningHints("full-inventory", {answerLanguage: "en", standaloneQuestion: "All independent obligations",
    requirements, formulations: requirements.map(requirement => requirement.statement)});
  const additions = Array.from({length: 3}, (_, index) => ({id: `inspected-${index}`, statement: `Referenced condition ${index}`,
    priority: "core" as const, origin: {kind: "inspected_candidate" as const, itemKey: "source-item", provisionRenditionId: "source-rendition",
      textRevisionId: "source-revision", languageFamily: "en" as const}}));
  const expanded = parseQuestionInterpretationPlan({...plan, readings: plan.readings.map(reading => ({...reading,
    requirements: [...reading.requirements, ...additions]}))});
  assert.deepEqual(expanded.readings[0]!.requirements, [...plan.readings[0]!.requirements, ...additions]);
});

function controllingProvision(input: {
  domain: string;
  article: string;
  text: string;
  sourceDocument: number;
}) {
  return {
    ...representativeProvision,
    legalInstrumentId: `instrument-${input.domain}`,
    publisherInstrumentToken: `lex-document-${input.sourceDocument}`,
    officialExpressionId: `expression-${input.domain}-uz-latn`,
    textRevisionId: `revision-${input.domain}-uz-latn-2026-01-01`,
    provisionConceptId: `concept-${input.domain}-article-${input.article}`,
    publisherProvisionToken: `article-${input.article}`,
    provisionRenditionId: `rendition-${input.domain}-uz-latn-article-${input.article}`,
    captureId: `capture-${input.domain}-${input.article}`,
    languageTag: "uz-Latn" as const,
    script: "Latn" as const,
    textualAuthority: "controlling" as const,
    origin: "certified_original" as const,
    controllingOnConflict: true,
    derivedFromExpressionId: null,
    authorityEvidence: {
      kind: "publisher_certification" as const,
      sourceUrl: `https://lex.uz/docs/${input.sourceDocument}`,
      recordedAt: "2026-08-30T00:00:00.000Z",
    },
    actTitle: `${input.domain} act`,
    articleNumber: input.article,
    provisionSequence: Number(input.article),
    provisionText: input.text,
    rawCapture: `<html><body>${input.text}</body></html>`,
    sourceUrl: `https://lex.uz/docs/${input.sourceDocument}`,
  };
}

function stableIdentity(provisionRenditionId: string) {
  return {
    provisionRenditionId: provisionRenditionIdSchema.parse(provisionRenditionId),
    canonicalChunkId: canonicalChunkIdSchema.parse(`chunk-for-${provisionRenditionId}`),
    textRevisionId: textRevisionIdSchema.parse(`revision-for-${provisionRenditionId}`),
    provisionConceptId: provisionConceptIdSchema.parse(`concept-for-${provisionRenditionId}`),
    languageFamily: "uz" as const,
    textualAuthority: "controlling" as const,
  };
}

function itemKey(renditionId: string): string {
  return `search-releases/${release.id}/current/current-00/${renditionId}.md`;
}

function candidate(key: string, formulationId: string, readingIds: string[], requirementIds: string[]) {
  return {
    itemKey: key,
    instanceId: "current-00",
    shardId: "current-00",
    formulationIds: [formulationId],
    readingIds,
    retrievalRequirementIds: requirementIds,
    vectorRank: 1,
    vectorScore: 0.91,
    keywordRank: 1,
    keywordScore: 4.2,
    fusionScore: 0.9,
  };
}

test("planning hints preserve one-to-one formulation requirement provenance", () => {
  const planned = planFromQuestionPlanningHints("request", {
    answerLanguage: "ru",
    standaloneQuestion: "Вопрос",
    requirements: [{ statement: "Запрет", priority: "core" },
      { statement: "Исключения", priority: "core" }],
    formulations: ["правовой запрет", "исключения из запрета"],
  });
  assert.deepEqual(planned.formulations.map((formulation) => formulation.requirementIds), [
    ["requirement-1"], ["requirement-2"],
  ]);
  for (const formulationRequirementIndexes of [[[0]], [[0], [2]]]) {
    assert.throws(() => planFromQuestionPlanningHints("invalid-scope", {
      answerLanguage: "en", standaloneQuestion: "Question",
      requirements: [{ statement: "Rule", priority: "core" }, { statement: "Exception", priority: "core" }],
      formulations: ["rule", "exception"], formulationRequirementIndexes,
    }));
  }
});

test("reference evidence is assessed before repair without displacing the initial pool", async () => {
  const plan = planFromQuestionPlanningHints("references", {answerLanguage: "en", standaloneQuestion: "Rule and its grounds",
    requirements: [{statement: "Ordinary rule", priority: "core"}, {statement: "Operative grounds", priority: "core"}],
    formulations: ["Rule and its grounds"], formulationRequirementIndexes: [[0, 1]]});
  const initial = parseRevalidatedCandidates(Array.from({length: 48}, (_, index) => ({...stableIdentity(`rendition-${index}`),
    candidate: candidate(`item-${index}`, "formulation-1", ["reading-1"], ["requirement-1", "requirement-2"])})));
  const references = parseRevalidatedCandidates(Array.from({length: 12}, (_, index) => ({...stableIdentity(`reference-${index}`),
    candidate: {...candidate(`reference-${index}`, "formulation-1", ["reading-1"], ["requirement-2"]),
      referenceOrigin: {itemKey: "item-0", article: String(700 + index)}, fusionScore: 0}})));
  let searches = 0;
  let wrongArticle = false;
  let oversizedEvidence = false;
  const operativeMiddle = "The applicant may file within forty days after written notification.";
  const completeLongProvision = `${"Background context. ".repeat(140)}${operativeMiddle}${" Additional definitions.".repeat(140)}`;
  const verifiedRevisions = new Set<string>();
  const retriever = createTargetLegalAnswerRetriever({environment: "development", interpreter: {interpret: async () => plan},
    verifyCurrentSource: async evidence => {verifiedRevisions.add(evidence.provisionRenditionId); return {
      pinnedTextSha256: "a".repeat(64), observation: {version: 2, officialUrl: evidence.officialCitation.url,
        observedAt: "2026-09-11T00:00:00.000Z", current: true, normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64)},
    };},
    releaseResolver: {resolve: async () => release},
    candidateIndex: {retrieve: async () => {
      searches++;
      return parseCandidatePacket({availability: "available", releaseId: release.id, endpoint: {kind: "current"},
        requiredInstanceIds: ["current-00"], partialErrors: [], candidates: initial.map(item => item.candidate)});
    }},
    candidateCatalog: {revalidate: async packet => packet.candidates.map(candidate => {
      const known = [...initial, ...references].find(item => item.candidate.itemKey === candidate.itemKey)!;
      return {...known, candidate};
    })},
    referenceDiscovery: async candidates => {
      assert.equal(candidates.length, 48);
      assert.deepEqual(new Set(candidates.map(item => item.candidate.candidate.itemKey)), new Set(initial.map(item => item.candidate.itemKey)));
      return references;
    },
    evidenceResolver: {resolveControlling: async id => {
      const article = id.startsWith("reference-") ? String(700 + Number(id.slice("reference-".length))) : "1";
      const citation = {label: `Example Act — Article ${wrongArticle ? "999" : article}`, url: "https://lex.uz/docs/900"};
      return parseControllingEvidenceResolution({controlling: {legalInstrumentId: "instrument", officialExpressionId: "expression",
        textRevisionId: "revision", provisionConceptId: `concept-${id}`, provisionRenditionId: id,
        languageTag: "uz-Latn", script: "Latn", textualAuthority: "controlling",
        provisionText: oversizedEvidence ? "Complete verified rule. ".repeat(2000)
          : id === "rendition-0" ? completeLongProvision : `Complete verified rule for ${id}.`,
        officialCitation: citation, evidence: {provisionRenditionId: id, r2Key: `evidence/${id}`, byteCount: 100,
          sha256: "a".repeat(64), sourceNormalizedSha256: String([...initial, ...references].findIndex(item => item.provisionRenditionId === id)).padStart(64, "0"),
          schemaVersion: 1}}, materialCitation: citation});
    }},
    provisionSelector: {select: async ({candidates, repairAttempted}) => {
      assert.equal(repairAttempted, false);
      assert.equal(candidates.length, wrongArticle ? 48 : 60);
      if (wrongArticle) return {outcome: "rejected"};
      assert.equal(candidates.find(item => item.candidate.provisionRenditionId === "rendition-0")!.provisionText,
        completeLongProvision, "the only operative rule in the middle must reach support assessment intact");
      return {outcome: "selected", mainPoint: "Both independently verified rules.",
        propositions: [{requirementId: "requirement-1", statement: "Rule"}, {requirementId: "requirement-2", statement: "Grounds"}],
        selections: [{itemKey: "item-0", requirementIds: ["requirement-1"]}, {itemKey: "reference-0", requirementIds: ["requirement-2"]}],
        whatToDoNext: []};
    }},
  });
  const answer = await retriever.answer({id: "reference-flow", question: "Rule and its grounds"});
  assert.equal(answer.kind, "legal_answer");
  assert.equal(verifiedRevisions.has("reference-0"), true, "Selection beyond the first24 status checks still needs its pinned fingerprint");
  if (answer.kind === "legal_answer") assert.ok(answer.whatTheLawSays.every(statement => statement.currentSourceStatus?.pinnedTextSha256));
  assert.equal(searches, 1, "explicit reference discovery avoids a second semantic search");
  wrongArticle = true;
  const mismatched = await retriever.answer({id: "reference-mismatch", question: "Rule and its grounds"});
  assert.equal(mismatched.kind, "insufficient_indexed_coverage", "metadata alone cannot substitute a different article's authenticated text");
  wrongArticle = false;
  oversizedEvidence = true;
  const oversized = await retriever.answer({id: "oversized-evidence", question: "Rule and its grounds"});
  assert.equal(oversized.kind, "source_unavailability", "oversized complete context must fail before assessment, never become a shortened excerpt");
  if (oversized.kind === "source_unavailability") {
    assert.equal(oversized.safeErrorCode, "INDEXED_EVIDENCE_CONTEXT_EXCEEDED");
    assert.deepEqual(oversized.coverageRequirements?.map(requirement => requirement.id), ["requirement-1", "requirement-2"]);
  }
});

test("repair retains supported evidence even when new candidates push it below the pool ceiling", () => {
  const entries = parseRevalidatedCandidates(Array.from({length: 60}, (_, index) => ({
    ...stableIdentity(`rendition-${index}`),
    candidate: {...candidate(`item-${index}`, "formulation-repair", ["reading"], ["requirement"],),
      fusionScore: 1 - index / 100, vectorRank: index + 1},
  })));
  assert.equal(boundedSelectionPool(entries).some(item => item.candidate.itemKey === "item-59"), false);
  const retained = boundedSelectionPool(entries, ["item-59"]);
  assert.equal(retained.length, 48);
  assert.ok(retained.some(item => item.candidate.itemKey === "item-59"));
  assert.ok(retained.some(item => item.candidate.itemKey === "item-0"));
  const required = Array.from({length: 24}, (_, index) => `item-${36 + index}`);
  const complete = boundedSelectionPool(entries, required);
  assert.equal(complete.length, 48);
  assert.equal(required.every(key => complete.some(item => item.candidate.itemKey === key)), true);
  assert.throws(() => boundedSelectionPool(entries, Array.from({length: 25}, (_, index) => `item-${index}`)));
});

test("selection pool reserves independently ranked candidates for every formulation", () => {
  const make = (key: string, formulationIds: string[], matches: Array<{
    formulationId: string; rank: number; fusionScore: number;
  }>, score: number) => ({
    candidate: {
      ...candidate(key, formulationIds[0]!, ["reading"], ["requirement"]),
      formulationIds,
      formulationMatches: matches,
      fusionScore: score,
    },
    ...stableIdentity(`rendition-${key}`),
  });
  const shared = Array.from({ length: 7 }, (_, index) => make(
    `shared-${index + 1}`,
    ["formulation-1", "formulation-2"],
    ["formulation-1", "formulation-2"].map((formulationId) => ({
      formulationId, rank: index + 1, fusionScore: 1 - index / 100,
    })),
    2 - index / 100,
  ));
  const noise = Array.from({ length: 48 }, (_, index) => make(
    `noise-${index + 1}`,
    ["formulation-3"],
    [{ formulationId: "formulation-3", rank: index + 1, fusionScore: 1 - index / 100 }],
    3 - index / 100,
  ));
  const specific = [make("specific-1", ["formulation-1"],
    [{ formulationId: "formulation-1", rank: 8, fusionScore: 0.5 }], 0.5),
  make("specific-2", ["formulation-2"],
    [{ formulationId: "formulation-2", rank: 8, fusionScore: 0.5 }], 0.5)];
  const selected = boundedSelectionPool(parseRevalidatedCandidates([...noise, ...shared, ...specific]));
  assert.equal(selected.length, 48);
  assert.equal(selected.some((entry) => entry.candidate.itemKey === "specific-1"), true);
  assert.equal(selected.some((entry) => entry.candidate.itemKey === "specific-2"), true);
});

test("domain-general questions return hash-verified Legal Answers through the private retrieval seam", async (t) => {
  const stageEvents: Array<{stage: string; elapsedMs: number}> = [];
  t.mock.method(console, "info", (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("{")) {
      const event = JSON.parse(args[0]);
      if (event.event === "legal_target_stage_finished") stageEvents.push(event);
    }
  });
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(new URL("../legal-drizzle/", import.meta.url));
  const bucket = new MemoryEvidenceBucket();
  const fixtures = [{
    id: "employment",
    question: "Can an employer end the contract while the employee is on protected leave?",
    text: "Employment protection applies during the evidenced leave period.",
    conditionalQuestion: "Which legally defined leave is involved?",
  }, {
    id: "family",
    question: "What formal rule applies to guardianship?",
    text: "Guardianship requires the procedure stated in this provision.",
  }, {
    id: "tax",
    question: "When is this tax filing due?",
    text: "The tax filing deadline is governed by this provision.",
  }] as const;
  try {
    const renditionByQuestion = new Map<string, string>();
    for (const [index, fixture] of fixtures.entries()) {
      const provision = controllingProvision({
        domain: fixture.id,
        article: String(index + 1),
        text: fixture.text,
        sourceDocument: 700 + index,
      });
      await importProvisionRendition({ db: d1, bucket }, provision);
      await recordProvisionTemporalEvidence({ db: d1 }, {
        id: `temporal-${provision.provisionRenditionId}`,
        textRevisionId: provision.textRevisionId,
        provisionRenditionId: provision.provisionRenditionId,
        editorialValidFrom: provision.capturedAt,
        editorialValidTo: null,
        applicability: {
          validFrom: provision.capturedAt,
          validTo: null,
          evidenceUrl: provision.sourceUrl,
          evidenceKind: "official_timeline",
        },
        currentPointer: { evidenceUrl: provision.sourceUrl, verifiedAt: provision.capturedAt },
        recordedAt: provision.capturedAt,
      });
      renditionByQuestion.set(fixture.question, provision.provisionRenditionId);
    }

    for (const fixture of fixtures) {
      const renditionId = renditionByQuestion.get(fixture.question)!;
      const plan: QuestionInterpretationPlan = {
        id: `plan-${fixture.id}`,
        originalLanguage: "en",
        answerLanguage: "en",
        readings: [{
          id: `reading-${fixture.id}`,
          statement: fixture.question,
          requirements: [{
            id: `requirement-${fixture.id}`,
            statement: `Governing ${fixture.id} proposition`,
          }],
        }],
        formulations: [{
          id: `formulation-${fixture.id}`,
          text: fixture.question,
          privateNameSpans: [],
          readingIds: [`reading-${fixture.id}`],
          requirementIds: [`requirement-${fixture.id}`],
          kind: "exact",
        }],
        missingCaseFacts: "conditionalQuestion" in fixture ? [{
          id: `fact-${fixture.id}`,
          question: fixture.conditionalQuestion,
          material: true,
        }] : [],
      };
      const key = itemKey(renditionId);
      const unavailableRenditionId = `rendition-${fixture.id}-unavailable`;
      const unavailableKey = itemKey(unavailableRenditionId);
      const index = createInMemoryCandidateIndex(async (formulation) => [
        ...(fixture.id === "employment" ? [{
          ...candidate(unavailableKey, formulation.id, formulation.readingIds, formulation.requirementIds),
        }] : []),
        { ...candidate(key, formulation.id, formulation.readingIds, formulation.requirementIds) },
      ]);
      let supportUnavailable = false;
      let finishStatusCheck: ((current: boolean) => void) | undefined;
      const retriever = createTargetLegalAnswerRetriever({
        environment: "development",
        onReleaseResolved() {throw new Error("DIAGNOSTIC_SINK_UNAVAILABLE");},
        verifyCurrentSource: (evidence) => new Promise(resolve => { finishStatusCheck = (current) => resolve({
          pinnedTextSha256: "a".repeat(64), observation: {version: 2, officialUrl: evidence.officialCitation.url,
            observedAt: "2026-08-01T00:00:00.000Z", current, normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64)},
        }); }),
        interpreter: { interpret: async (input) => {
          assert.equal(input.question, `Resolved context: ${fixture.question}`);
          assert.deepEqual(input.priorUserQuestions, []);
          return plan;
        } },
        releaseResolver: { resolve: async () => release },
        candidateIndex: index,
        candidateCatalog: {
          revalidate: async (packet) => packet.candidates.map((entry) => ({
            candidate: entry,
            ...stableIdentity(entry.itemKey === unavailableKey ? unavailableRenditionId : renditionId),
          })),
        },
        evidenceResolver: {
          resolveControlling: (id) => resolveControllingEvidence({ db: d1, bucket }, id),
        },
        provisionSelector: {
          select: async ({ plan: interpreted, candidates }) => {
            assert.ok(finishStatusCheck, "current-status checking starts before support assessment");
            if (supportUnavailable) {
              const finish = finishStatusCheck;
              setTimeout(() => finish(true), 20);
              throw new Error("SUPPORT_TIMEOUT");
            }
            finishStatusCheck(true);
            finishStatusCheck = undefined;
            assert.equal(candidates.length, 1);
            assert.equal(candidates[0]!.candidate.provisionRenditionId, renditionId);
            return {
              outcome: "selected",
              mainPoint: `Main Point for ${fixture.id}`,
              propositions: interpreted.readings.flatMap((reading) => reading.requirements.map((requirement) => ({
                requirementId: requirement.id,
                statement: requirement.statement,
              }))),
              selections: [{
                itemKey: candidates[0]!.candidate.candidate.itemKey,
                requirementIds: [`requirement-${fixture.id}`],
              }],
              whatToDoNext: ["Check the material facts against the controlling provision."],
            };
          },
        },
      });
      const service = {
        fetch(input: RequestInfo | URL, init?: RequestInit) {
          return handleTargetLegalAnswerRequest(new Request(input, init), {
            environment: "development",
            retriever,
          });
        },
      } as Fetcher;
      const result = await createTargetLegalAnswerClient({
        service,
        environment: "development",
      }).answer({
        id: `question-${fixture.id}`,
        question: fixture.question,
        contextualQuestion: `Resolved context: ${fixture.question}`,
      });

      assert.equal(result.kind, "conditionalQuestion" in fixture ? "conditional_answer" : "legal_answer");
      if (result.kind !== "legal_answer" && result.kind !== "conditional_answer") {
        assert.fail(`unexpected outcome ${result.kind}`);
      }
      assert.equal(result.sourceLadder, "indexed_official_corpus");
      assert.equal(result.mainPoint, `Main Point for ${fixture.id}`);
      assert.equal(result.whatTheLawSays[0]?.controllingQuotation, fixture.text);
      assert.equal(result.whatTheLawSays[0]?.officialCitations.length, 1);
      assert.equal(result.whatTheLawSays[0]?.evidenceLocator?.articleNumber,
        String(fixtures.indexOf(fixture) + 1), "Receipt identity comes from the authenticated provision article");
      assert.match(result.whatTheLawSays[0]?.officialCitations[0]?.url ?? "", /^https:\/\/lex\.uz\/docs\//u);
      assert.match(result.whatTheLawSays[0]?.evidenceSha256 ?? "", /^[a-f0-9]{64}$/u);
      assert.equal(result.whatTheLawSays[0]?.currentSourceStatus?.observation?.observedAt, "2026-08-01T00:00:00.000Z",
        "The packet preserves actual publisher time even when the caller must reject its age");
      assert.equal(JSON.stringify(result).includes("provider excerpt"), false);
      assert.deepEqual(result.focusedQuestions,
        "conditionalQuestion" in fixture ? [fixture.conditionalQuestion] : []);
      supportUnavailable = true;
      stageEvents.length = 0;
      const unavailable = await retriever.answer({ id: `retry-${fixture.id}`,
        question: `Resolved context: ${fixture.question}` });
      assert.equal(unavailable.kind, "source_unavailability");
      assert.ok(stageEvents.some(event => event.stage === "source_observation_drain" && event.elapsedMs >= 10),
        "time waiting for outstanding publisher checks remains attributed after support fails");
      assert.deepEqual(Reflect.get(unavailable, "discoveredOfficialUrls"),
        [result.whatTheLawSays[0]!.officialCitations[0]!.url],
        "verified locations survive support failure as discovery leads, not accepted evidence");
    }
  } finally {
    sqlite.close();
  }
});

for (const compoundRepair of [false, true]) test(`every Plausible Reading gets a formulation before focused repair (compound: ${compoundRepair})`, async () => {
  const formulationOrder: string[] = [];
  const requestInstant = "2026-09-06T00:00:00.000Z";
  let clock = Date.parse(requestInstant);
  const observedInstants: string[] = [];
  let selectionCalls = 0;
  const plan: QuestionInterpretationPlan = {
    id: "plan-two-readings",
    originalLanguage: "ru",
    answerLanguage: "ru",
    readings: [{
      id: "reading-status-a",
      statement: "First plausible legal status",
      requirements: [{ id: "requirement-a", statement: "First governing rule" }],
    }, {
      id: "reading-status-b",
      statement: "Second plausible legal status",
      requirements: [{ id: "requirement-b", statement: "Second governing rule" }],
    }],
    formulations: [{
      id: "formulation-a",
      text: "first legal status",
      privateNameSpans: [],
      readingIds: ["reading-status-a"],
      requirementIds: ["requirement-a"],
      kind: "legal_register",
    }, {
      id: "formulation-b",
      text: "second legal status",
      privateNameSpans: [],
      readingIds: ["reading-status-b"],
      requirementIds: ["requirement-b"],
      kind: "legal_register",
    }],
    missingCaseFacts: [],
  };
  const firstKey = itemKey("rendition-a");
  const repairKey = itemKey("rendition-b");
  const index = createInMemoryCandidateIndex(async (formulation) => {
    formulationOrder.push(formulation.id);
    const key = formulation.id.startsWith("repair-b")
      && formulation.requirementIds.length === 1
      && formulation.requirementIds[0] === "requirement-b" ? repairKey : firstKey;
    if (compoundRepair && formulation.id.startsWith("repair-b")) {
      assert.equal(formulation.requirementIds.length, 1, "each repair query must target one legal proposition");
      assert.equal(formulation.text, formulation.requirementIds[0] === "requirement-b"
        ? "Second governing rule" : "First governing rule");
    }
    return [candidate(key, formulation.id, formulation.readingIds, formulation.requirementIds)];
  });
  const retriever = createTargetLegalAnswerRetriever({
    environment: "development",
    now: () => clock,
    interpreter: { interpret: async () => plan },
    releaseResolver: { resolve: async () => release },
    candidateIndex: { async retrieve(interpretation, endpoint, pinned, context) {
      assert.equal(pinned.id, release.id);
      observedInstants.push(context!.currentAt);
      clock += 60_000;
      return index.retrieve(interpretation, endpoint, pinned, context);
    } },
    candidateCatalog: {
      revalidate: async (packet, _endpoint, pinned, currentAt) => {
        assert.equal(pinned.id, release.id);
        observedInstants.push(currentAt);
        return packet.candidates.map((entry) => ({
        candidate: entry,
        ...stableIdentity(entry.itemKey === repairKey ? "rendition-b" : "rendition-a"),
      })); },
    },
    evidenceResolver: {
      resolveControlling: async (id, _endpoint, context) => {
        assert.equal(context.release.id, release.id);
        observedInstants.push(context.currentAt);
        const resolved = parseControllingEvidenceResolution({
        controlling: {
          legalInstrumentId: "instrument",
          officialExpressionId: "expression",
          textRevisionId: "revision",
          provisionConceptId: `concept-${id}`,
          provisionRenditionId: id,
          languageTag: "uz-Latn",
          script: "Latn",
          textualAuthority: "controlling",
          provisionText: `verified ${id}`,
          officialCitation: { label: `Act — Article ${id}`, url: "https://lex.uz/docs/900" },
          evidence: {
            provisionRenditionId: id,
            r2Key: `corpus/provisions/${id}.json`,
            byteCount: 10,
            sha256: "a".repeat(64),
            sourceNormalizedSha256: "b".repeat(64),
            schemaVersion: 1,
          },
        },
        materialCitation: { label: `Act — Article ${id}`, url: "https://lex.uz/docs/900" },
      });
        return {...resolved, articleContext: {...resolved.controlling,
          provisionText: `complete verified ${id} ${"Introductory material. ".repeat(60)} Operative exception in the middle. ${"Additional conditions. ".repeat(60)}`,
          evidence: {...resolved.controlling.evidence, r2Key: "corpus/normalized/revision.json", sha256: "b".repeat(64)},
        }};
      },
    },
    provisionSelector: {
      select: async ({ candidates }) => {
        selectionCalls += 1;
        assert.ok(candidates.every(candidate => candidate.provisionText.startsWith("complete verified")));
        assert.ok(candidates.every(candidate => candidate.provisionText.includes("Operative exception in the middle.")));
        if (selectionCalls === 1) return {
          outcome: "repair",
          repairFormulation: {
            id: "repair-b",
            text: "second governing rule repair",
            privateNameSpans: [],
            readingIds: compoundRepair ? ["reading-status-b", "reading-status-a"] : ["reading-status-b"],
            requirementIds: compoundRepair ? ["requirement-b", "requirement-a"] : ["requirement-b"],
            kind: "repair",
          },
        } as const;
        return {
          outcome: "selected",
          mainPoint: "Both plausible readings are supported separately.",
          propositions: [{ requirementId: "requirement-a", statement: "First rule" }, {
            requirementId: "requirement-b", statement: "Second rule",
          }],
          selections: candidates.map((entry) => ({
            itemKey: entry.candidate.candidate.itemKey,
            requirementIds: entry.candidate.candidate.itemKey === repairKey ? ["requirement-b"] : ["requirement-a"],
          })),
          whatToDoNext: [],
        } as const;
      },
    },
  });

  const result = await retriever.answer({ id: "question-two-readings", question: "ambiguous status" });
  assert.equal(result.kind, "legal_answer");
  assert.deepEqual(formulationOrder, compoundRepair
    ? ["formulation-a", "formulation-b", "repair-b-1", "repair-b-2"]
    : ["formulation-a", "formulation-b", "repair-b"]);
  assert.equal(selectionCalls, 2);
  assert.equal(observedInstants.length, 6);
  assert.deepEqual([...new Set(observedInstants)], [requestInstant]);
  if (result.kind === "legal_answer") {
    assert.equal(result.whatTheLawSays.length, 2);
    assert.ok(result.whatTheLawSays.every(statement => statement.controllingQuotation.startsWith("complete verified")
      && statement.evidenceSha256 === "b".repeat(64)));
  }

  const overBudget = createTargetLegalAnswerRetriever({
    environment: "development",
    interpreter: { interpret: async () => ({
      ...plan,
      formulations: Array.from({ length: TARGET_INITIAL_FORMULATION_LIMIT + 1 }, (_, index) => ({
        ...plan.formulations[index % 2]!,
        id: `over-${index}`,
      })),
    }) },
    releaseResolver: { resolve: async () => release },
    candidateIndex: { retrieve: async () => { assert.fail("provider must not run"); } },
    candidateCatalog: { revalidate: async () => [] },
    evidenceResolver: { resolveControlling: async () => { assert.fail("evidence must not hydrate"); } },
    provisionSelector: { select: async () => { assert.fail("selector must not run"); } },
  });
  const clarification = await overBudget.answer({ id: "question-over-budget", question: "too broad" });
  assert.equal(clarification.kind, "source_unavailability");
  if (clarification.kind === "source_unavailability") assert.equal(clarification.safeErrorCode, "QUESTION_INTERPRETATION_UNAVAILABLE");
});

test("unavailable or incomplete indexed packets continue the strict Source Ladder", async () => {
  const plan: QuestionInterpretationPlan = {
    id: "plan-unavailable",
    originalLanguage: "en",
    answerLanguage: "en",
    readings: [{
      id: "reading",
      statement: "A reading",
      requirements: [{ id: "requirement", statement: "A material rule" }],
    }],
    formulations: [{
      id: "formulation",
      text: "A material rule",
      privateNameSpans: [],
      readingIds: ["reading"],
      requirementIds: ["requirement"],
      kind: "exact",
    }],
    missingCaseFacts: [],
  };
  const base = {
    environment: "development" as const,
    interpreter: { interpret: async () => plan },
    releaseResolver: { resolve: async () => release },
    candidateCatalog: { revalidate: async () => [] },
    evidenceResolver: { resolveControlling: async () => { assert.fail("must not hydrate"); } },
    provisionSelector: { select: async () => ({ outcome: "rejected" as const }) },
  };
  const unavailable = createTargetLegalAnswerRetriever({
    ...base,
    candidateIndex: {
      retrieve: async () => parseCandidatePacket({
        availability: "unavailable",
        releaseId: release.id,
        endpoint: { kind: "current" as const },
        requiredInstanceIds: ["current-00"],
        candidates: [],
        partialErrors: [{ code: "CANDIDATE_PARTIAL_RESPONSE" as const, instanceId: "current-00" }],
      }),
    },
  });
  const unavailableResult = await unavailable.answer({ id: "question-unavailable", question: "question" });
  assert.deepEqual(unavailableResult, {
    kind: "source_unavailability",
    sourceLadder: "indexed_official_corpus",
    nextTier: "live_official_search",
    safeErrorCode: "INDEXED_CANDIDATE_UNAVAILABLE",
  });

  const incomplete = createTargetLegalAnswerRetriever({
    ...base,
    candidateIndex: createInMemoryCandidateIndex(async () => []),
  });
  const incompleteResult = await incomplete.answer({ id: "question-incomplete", question: "question" });
  assert.equal(incompleteResult.kind, "insufficient_indexed_coverage");
  if (incompleteResult.kind === "insufficient_indexed_coverage") {
    assert.equal(incompleteResult.nextTier, "live_official_search");
  }

  const key = itemKey("rendition-selector-boundary");
  const forgedSelection = createTargetLegalAnswerRetriever({
    ...base,
    candidateIndex: createInMemoryCandidateIndex(async (formulation) => [
      candidate(key, formulation.id, formulation.readingIds, formulation.requirementIds),
    ]),
    candidateCatalog: {
      revalidate: async (packet) => packet.candidates.map((entry) => ({
        candidate: entry,
        ...stableIdentity("rendition-selector-boundary"),
      })),
    },
    provisionSelector: {
      select: async () => ({
        outcome: "selected" as const,
        mainPoint: "Untrusted selector output.",
        propositions: [{ requirementId: "requirement", statement: "A material rule" }],
        selections: [{ itemKey: key, requirementIds: ["requirement-not-on-candidate"] }],
        whatToDoNext: [],
      }),
    },
  });
  const forgedResult = await forgedSelection.answer({
    id: "question-forged-selection",
    question: "question",
  });
  assert.equal(forgedResult.kind, "source_unavailability");
  if (forgedResult.kind === "source_unavailability") {
    assert.equal(forgedResult.safeErrorCode, "INDEXED_REVALIDATION_FAILED");
  }
});

test("an as-of interpretation pins the history release and endpoint through candidate and evidence resolution", async () => {
  const endpoint = { kind: "timestamp" as const, instant: "2026-02-15T00:00:00.000Z" };
  const historyRelease: PinnedCandidateRelease = parsePinnedCandidateRelease({
    ...release,
    id: "release-history-point-in-time-v1",
    capability: "history",
    instances: [{ id: "history-00", shardId: "history-00" }],
  });
  const key = `search-releases/${historyRelease.id}/history/history-00/rendition-history.md`;
  const plan: QuestionInterpretationPlan = {
    id: "plan-point-in-time",
    originalLanguage: "en",
    answerLanguage: "en",
    temporalEndpoint: endpoint,
    readings: [{
      id: "reading-history",
      statement: "The rule at the requested instant",
      requirements: [{ id: "requirement-history", statement: "Applicable historical rule" }],
    }],
    formulations: [{
      id: "formulation-history",
      text: "applicable rule on 15 February 2026",
      privateNameSpans: [],
      readingIds: ["reading-history"],
      requirementIds: ["requirement-history"],
      kind: "legal_register",
    }],
    missingCaseFacts: [],
  };
  let evidenceEndpoint: unknown;
  const retriever = createTargetLegalAnswerRetriever({
    environment: "development",
    interpreter: { interpret: async () => plan },
    releaseResolver: { resolve: async (received) => {
      assert.deepEqual(received, endpoint);
      return historyRelease;
    } },
    candidateIndex: createInMemoryCandidateIndex(async (formulation, received, pinned) => {
      assert.deepEqual(received, endpoint);
      assert.equal(pinned.id, historyRelease.id);
      return [{
        ...candidate(key, formulation.id, formulation.readingIds, formulation.requirementIds),
        instanceId: "history-00",
        shardId: "history-00",
      }];
    }),
    candidateCatalog: {
      revalidate: async (packet, received, pinned) => {
        assert.deepEqual(received, endpoint);
        assert.equal(pinned.capability, "history");
        return packet.candidates.map((entry) => ({
          candidate: entry,
          ...stableIdentity("rendition-history"),
        }));
      },
    },
    evidenceResolver: {
      resolveControlling: async (id, received) => {
        assert.equal(id, "rendition-history");
        evidenceEndpoint = received;
        return parseControllingEvidenceResolution({
          controlling: {
            legalInstrumentId: "instrument-history",
            officialExpressionId: "expression-history",
            textRevisionId: "revision-history-2026-01-01-2",
            provisionConceptId: "concept-history",
            provisionRenditionId: id,
            languageTag: "uz-Latn",
            script: "Latn",
            textualAuthority: "controlling",
            provisionText: "The verified provision was applicable at the requested instant.",
            officialCitation: { label: "Historical Act — Article 1", url: "https://lex.uz/docs/901" },
            evidence: {
              provisionRenditionId: id,
              r2Key: "corpus/provisions/history.json",
              byteCount: 10,
              sha256: "c".repeat(64),
              sourceNormalizedSha256: "d".repeat(64),
              schemaVersion: 1,
            },
          },
          materialCitation: { label: "Historical Act — Article 1", url: "https://lex.uz/docs/901" },
        });
      },
    },
    provisionSelector: {
      select: async ({ candidates }) => ({
        outcome: "selected",
        mainPoint: "This is the rule at the requested instant.",
        propositions: [{ requirementId: "requirement-history", statement: "Historical rule" }],
        selections: [{
          itemKey: candidates[0]!.candidate.candidate.itemKey,
          requirementIds: ["requirement-history"],
        }],
        whatToDoNext: [],
      }),
    },
  });

  const result = await retriever.answer({ id: "question-history", question: "What was the rule then?" });
  assert.equal(result.kind, "legal_answer");
  if (result.kind !== "legal_answer") assert.fail(`unexpected outcome ${result.kind}`);
  assert.deepEqual(result.temporalEndpoint, endpoint);
  assert.deepEqual(evidenceEndpoint, endpoint);
});
