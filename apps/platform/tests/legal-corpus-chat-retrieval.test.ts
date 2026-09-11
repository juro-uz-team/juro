import assert from "node:assert/strict";
import test from "node:test";

import {
  retrieveCorpusAwareLegalSources as retrieveWithOfficialStatus,
  shouldRetrieveSecondaryInternet,
  targetCitationArticle,
} from "../lib/legal-corpus/chat-retrieval";
import type { LiveLexRetrievalResult } from "../lib/legal/live-lex-retrieval";
import { legalDatabaseFreshnessFromAsOf } from "../lib/legal/verified-retrieval";
import { referencedArticleContextRequests, referencedLegalSourceIds, selectReferencedArticleContext } from "../lib/legal/referenced-article-context";

const now = new Date("2026-08-15T00:00:00.000Z");
const checkedAt = "2026-08-14T23:00:00.000Z";
const contentHash = "a".repeat(64);

test("an unavailable required plan cannot start a second interpretation or current-source search", async () => {
  const result = await retrieveCorpusAwareLegalSources({query: "Independent legal question", locale: "ru", now,
    requirePlanningHints: true, targetPlanningHints: Promise.resolve(undefined),
    targetEnvironment: "development", targetQuestionId: "missing-plan",
    targetService: {async fetch() { assert.fail("A second target interpretation must not run"); }} as unknown as Fetcher,
    liveSearch: async () => { assert.fail("Current-source search cannot replace an unavailable plan"); }});
  assert.equal(result.sourceValidationStatus, "unavailable");
  assert.equal(result.coverageStatus, "no_coverage");
  assert.deepEqual(result.errors, [{code: "QUESTION_INTERPRETATION_UNAVAILABLE"}]);
  assert.equal(shouldRetrieveSecondaryInternet(result), false);
});

test("a historical endpoint from the shared plan cannot fall through to current live evidence", async () => {
  const result = await retrieveCorpusAwareLegalSources({query: "Rules as of 2018", locale: "ru", now,
    requirePlanningHints: true, targetPlanningHints: {answerLanguage: "ru", standaloneQuestion: "Rules as of 2018",
      requirements: [{statement: "Historical rule", priority: "core"}], formulations: ["Historical rule"],
      temporalEndpoint: {kind: "timestamp", instant: "2018-01-01T00:00:00.000Z"}},
    liveSearch: async () => { assert.fail("Current rules cannot establish historical applicability"); }});
  assert.equal(result.sourceValidationStatus, "unavailable");
  assert.equal(result.sources.length, 0);
  assert.deepEqual(result.coverageRequirements, [{id: "requirement-1", statement: "Historical rule", priority: "core", sourceIds: []}]);
  assert.equal(shouldRetrieveSecondaryInternet(result), false);
});

test("an indexed list-item number is not published as an article number", () => {
  assert.equal(targetCitationArticle("Code — Статья 6", "6) отдельный пункт внутри статьи."), null);
  assert.equal(targetCitationArticle("Code — Article 3", "3. A numbered paragraph."), null);
  assert.equal(targetCitationArticle("Code — Статья 163", "6) отдельный пункт внутри статьи."), "163");
  assert.equal(targetCitationArticle("Code — Статья 6", "Статья 6. Заголовок и текст статьи."), "6");
  assert.equal(targetCitationArticle("Code — Article 161", "See Article 163 for further restrictions."), "161");
  assert.equal(targetCitationArticle("Code — Article 161", "The operative rule without an article heading."), "161");
});

function retrieveCorpusAwareLegalSources(input: Parameters<typeof retrieveWithOfficialStatus>[0]) {
  const service = input.targetService;
  const targetService = service ? {async fetch(request: RequestInfo | URL, init?: RequestInit) {
    const result = await service.fetch(request, init);
    result.headers.set("x-juro-target-answer-contract", "2");
    return result;
  }} as Fetcher : undefined;
  return retrieveWithOfficialStatus({clock: () => (input.now ?? now).getTime(), verifyCurrentSource: async officialUrl => ({version: 2,
    officialUrl, observedAt: (input.now ?? now).toISOString(), current: true, normalizedTextSha256: contentHash,
    rawContentSha256: contentHash}), ...input, targetService });
}

function liveResult(): LiveLexRetrievalResult {
  return {
    sources: [{
      id: "direct:lex:ru:777:aaaaaaaaaaaa",
      actTitle: "Закон о live-проверке",
      actIdentifier: "777",
      officialUrl: "https://lex.uz/ru/docs/777",
      revisionDate: "2026-08-14",
      lastCheckedAt: checkedAt,
      locale: "ru",
      publishedAt: null,
      sourceType: "lex",
      status: "verified",
      verificationState: "direct_validated",
      verifiedAt: checkedAt,
      contentSha256: contentHash,
      article: "9",
      excerpt: "Правило из проверенного официального источника.",
      applicabilityStatus: "current",
      spans: [{
        id: "direct-span",
        article: "9",
        paragraph: null,
        text: "Правило из проверенного официального источника.",
        textSha256: contentHash,
        quality: "high",
      }],
      sourceQuality: {
        passed: true,
        title: true,
        sufficientText: true,
        clean: true,
        locale: true,
        canonicalUrl: true,
        structured: true,
      },
    }],
    freshness: legalDatabaseFreshnessFromAsOf(checkedAt, now),
    legalDatabaseAsOf: checkedAt,
    sourceAccessMode: "direct",
    sourcesRetrievedAt: checkedAt,
    sourceValidationStatus: "validated",
    errors: [],
    evidence: [{
      sourceId: "direct:lex:ru:777:aaaaaaaaaaaa",
      sourceKind: "lex",
      canonicalUrl: "https://lex.uz/ru/docs/777",
      contentSha256: contentHash,
      retrievedAt: checkedAt,
      validatedAt: checkedAt,
      validationStatus: "validated",
    }],
  };
}

test("article context follows only unresolved same-instrument references and never historical evidence", () => {
  const source = liveResult().sources[0]!;
  const referring = { ...source, article: "17", spans: [{ ...source.spans![0]!,
    text: "Статья 17. Исключения установлены статьей 27 настоящего Кодекса. Также применяются статья 33 другого Закона и статья 44 Налогового кодекса.",
  }] };
  assert.deepEqual(referencedArticleContextRequests([referring]), [{ url: source.officialUrl, article: "27" }]);
  assert.deepEqual(referencedArticleContextRequests([referring], true), []);
  const truncated = {...referring, spans: [{...referring.spans[0]!, text: "Статья 17. Допускаются следующие основания:"}]};
  assert.deepEqual(referencedArticleContextRequests([truncated], true), [{url: source.officialUrl, article: "17"}]);
  assert.deepEqual(referencedArticleContextRequests([referring, { ...source, article: "27" }]), []);
  assert.deepEqual(referencedArticleContextRequests([{ ...referring, applicabilityStatus: "historical" }]), []);
  assert.equal(selectReferencedArticleContext(source, "27"), null);
  assert.equal(selectReferencedArticleContext({ ...source, verificationState: "verified" }, "9"), null);
});

test("synthesis reference links preserve instrument, language, revision and complete text boundaries", () => {
  const source = liveResult().sources[0]!;
  const referring = {...source, article: "17", spans: [{...source.spans![0]!,
    text: "Исключения установлены статьей 27 настоящего Кодекса. Статья 33 другого Закона."}]};
  const target = {...source, id: "operative", article: "27", spans: [{...source.spans![0]!,
    text: "Статья 27. Применяются основания прекращения полномочий, установленные настоящей статьей."}]};
  const packet = [referring, target,
    {...target, id: "foreign", officialUrl: "https://lex.uz/docs/888"},
    {...target, id: "translation", locale: "uz"},
    {...target, id: "old", revisionDate: "2025-01-01"},
    {...target, id: "historical", applicabilityStatus: "historical" as const},
    {...target, id: "guidance", sourceClass: "OFFICIAL_GOVERNMENT_GUIDANCE" as const},
    {...target, id: "unfinished", spans: [{...target.spans[0]!, text: "Статья 27. Применяются следующие основания прекращения полномочий:"}]},
    {...target, id: "other-reference", article: "33"}];
  assert.deepEqual(referencedLegalSourceIds(referring, packet), ["operative"]);
  assert.deepEqual(referencedLegalSourceIds(target, packet), []);
});

test("chat retrieval uses the R2-native target service before live Lex", async () => {
  let calls = 0;
  let liveStarted = 0;
  const targetService = {
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const request = new Request(input, init);
      assert.equal(new URL(request.url).pathname, "/internal/legal-corpus/target/retrieval/answer");
      assert.equal(request.headers.get("x-juro-service-binding"), "target-legal-answer-v1");
      assert.deepEqual(await request.clone().json(), {
        id: "question-1",
        question: "статья 9",
        contextualQuestion: "Какой срок предусмотрен статьёй 9?",
        priorUserQuestions: ["Как оформляется трудовой договор?"],
      });
      return Response.json({
        result: {
          kind: "legal_answer",
          sourceLadder: "indexed_official_corpus",
          mainPoint: "Трудовой договор регулируется законом.",
          whatTheLawSays: [{
            requirementId: "requirement-1",
            provisionConceptId: "concept-1",
            provisionRenditionId: "rendition-1",
            proposition: "Требуется письменная форма.",
            controllingQuotation: "Трудовой договор заключается в письменной форме.",
            officialCitations: [{
              label: "Трудовой кодекс — Article 9",
              url: "https://lex.uz/ru/docs/777",
            }],
            evidenceSha256: contentHash, currentSourceStatus: {pinnedTextSha256: contentHash, observation: null},
          }, {
            requirementId: "requirement-2",
            provisionConceptId: "concept-1",
            provisionRenditionId: "rendition-1",
            proposition: "Та же норма отвечает второму требованию.",
            controllingQuotation: "Трудовой договор заключается в письменной форме.",
            officialCitations: [{
              label: "Трудовой кодекс — Article 9",
              url: "https://lex.uz/ru/docs/777",
            }],
            evidenceSha256: contentHash, currentSourceStatus: {pinnedTextSha256: contentHash, observation: null},
          }],
          whatToDoNext: [],
          focusedQuestions: [],
          formulationsUsed: 2,
          repairQueriesUsed: 0,
          temporalEndpoint: { kind: "current" },
          coverageRequirements: [
            {id: "requirement-1", statement: "Форма трудового договора", priority: "core"},
            {id: "requirement-2", statement: "Заключение трудового договора", priority: "core"},
          ],
        },
      });
    },
  } as Fetcher;
  const result = await retrieveCorpusAwareLegalSources({
    query: "статья 9",
    locale: "ru",
    targetService,
    targetEnvironment: "staging",
    targetQuestionId: "question-1",
    contextualQuestion: "Какой срок предусмотрен статьёй 9?",
    priorUserQuestions: ["Как оформляется трудовой договор?"],
    liveSearch: async () => {
      calls += 1;
      return liveResult();
    },
    onLiveSearchStarted: () => {
      liveStarted += 1;
    },
  });

  assert.equal(calls, 0);
  assert.equal(liveStarted, 0);
  assert.equal(result.sourceAccessMode, "approved_package");
  assert.equal(result.sources[0]?.verificationState, "verified");
  assert.equal(result.sources[0]?.retrievalSelection, "semantic_reranker");
  assert.equal(result.coverageStatus, "good_coverage");
  assert.equal(result.retrievalTelemetry?.indexedHitCount, 1);
  assert.equal(result.retrievalTelemetry?.queriesRun, 2);
  assert.equal(result.retrievalTelemetry?.fusionOutcome, "indexed");
  assert.deepEqual(result.coverageRequirements?.map(requirement => [requirement.id, requirement.statement, requirement.sourceIds]), [
    ["requirement-1", "Форма трудового договора", [result.sources[0]!.id]],
    ["requirement-2", "Заключение трудового договора", [result.sources[0]!.id]],
  ]);
});

test("thirteen compact provisions preserve all independent coverage mappings in the writer context", async () => {
  const requirements = Array.from({length: 13}, (_, index) => ({id: `rule-${index}`, statement: `Independent rule ${index}`, priority: "core"}));
  const targetService = {async fetch(_input: RequestInfo | URL) {
    return Response.json({result: {kind: "legal_answer", sourceLadder: "indexed_official_corpus",
      mainPoint: "All independent rules apply.", whatTheLawSays: requirements.map((requirement, index) => ({
        requirementId: requirement.id, provisionConceptId: `concept-${index}`, provisionRenditionId: `rendition-${index}`,
        proposition: requirement.statement, controllingQuotation: `Complete operative rule ${index}.`,
        officialCitations: [{label: `Example Act — Article ${700 + index}`, url: "https://lex.uz/ru/docs/777"}],
        evidenceSha256: contentHash, currentSourceStatus: {pinnedTextSha256: contentHash, observation: null},
      })), whatToDoNext: [], focusedQuestions: [], formulationsUsed: 1, repairQueriesUsed: 0,
      temporalEndpoint: {kind: "current"}, coverageRequirements: requirements.map(requirement => ({...requirement,
        unresolvedDimensions: ["forum", "claim_kind"]}))}});
  }} as Fetcher;
  const result = await retrieveCorpusAwareLegalSources({query: "Independent rules", locale: "ru",
    targetService, targetEnvironment: "staging", targetQuestionId: "compact-evidence",
    liveSearch: async () => { throw new Error("No fallback expected"); }});
  assert.equal(result.sources.length, 13);
  assert.deepEqual(result.coverageRequirements?.[0]?.unresolvedDimensions, ["forum", "claim_kind"]);
  assert.equal(result.coverageStatus, "good_coverage");
  assert.deepEqual(result.coverageRequirements?.map(requirement => requirement.id), requirements.map(requirement => requirement.id));
  assert.equal(result.coverageRequirements?.every(requirement => requirement.sourceIds?.length === 1
    && result.sources.some(source => source.id === requirement.sourceIds[0])), true);
});

test("revoked indexed documents are excluded before live research and cannot certify coverage", async () => {
  let liveCalls = 0;
  const targetService = { async fetch() {
    return Response.json({ result: { kind: "legal_answer", sourceLadder: "indexed_official_corpus",
      mainPoint: "A selected rule", whatTheLawSays: [{ requirementId: "rule", provisionConceptId: "concept",
        provisionRenditionId: "rendition", proposition: "A selected rule", controllingQuotation: "A selected rule in an obsolete document.",
        officialCitations: [{ label: "Law — Article 9", url: "https://lex.uz/ru/docs/777" }], evidenceSha256: contentHash,
        currentSourceStatus: {pinnedTextSha256: contentHash, observation: null} }],
      whatToDoNext: [], focusedQuestions: [], formulationsUsed: 1, repairQueriesUsed: 0,
      temporalEndpoint: { kind: "current" }, coverageRequirements: [{id: "rule", statement: "A condition discovered in inspected evidence", priority: "core"}] } });
  }, connect() { throw new Error("Unexpected socket connection"); } } satisfies Fetcher;
  const result = await retrieveCorpusAwareLegalSources({ query: "статья 9", locale: "ru", targetService,
    targetEnvironment: "staging", targetQuestionId: "revoked-doc", verifyCurrentSource: async officialUrl => ({version: 2,
      officialUrl, observedAt: now.toISOString(), current: false, normalizedTextSha256: contentHash, rawContentSha256: contentHash}),
    liveSearch: async () => { liveCalls += 1; return liveResult(); } });
  assert.equal(liveCalls, 1);
  assert.equal(result.sourceAccessMode, "direct");
  assert.equal(result.sources.some((source) => source.id.startsWith("target:")), false);
  assert.deepEqual(result.coverageRequirements?.map(requirement => requirement.statement), ["A condition discovered in inspected evidence"]);
});

test("the chat adapter preserves observation time and rejects expired or changed pinned evidence", async () => {
  const url = "https://lex.uz/ru/docs/777";
  for (const mode of ["fresh", "expired", "changed", "missing"] as const) {
    const observedAt = new Date(now.getTime() - (mode === "expired" ? 300_000 : 299_999)).toISOString();
    const observation = {version: 2, officialUrl: url, observedAt, current: true,
      normalizedTextSha256: mode === "changed" ? "b".repeat(64) : contentHash, rawContentSha256: contentHash};
    const targetService = {async fetch() {return Response.json({result: {kind: "legal_answer", sourceLadder: "indexed_official_corpus",
      mainPoint: "A selected rule", whatTheLawSays: [{requirementId: "rule", provisionConceptId: "concept",
        provisionRenditionId: "rendition", proposition: "The rule applies", controllingQuotation: "Complete operative rule.",
        officialCitations: [{label: "Law — Article 9", url}], evidenceSha256: contentHash,
        ...(mode === "missing" ? {} : {currentSourceStatus: {pinnedTextSha256: contentHash, observation}})}],
      whatToDoNext: [], focusedQuestions: [], formulationsUsed: 1, repairQueriesUsed: 0,
      temporalEndpoint: {kind: "current"}, coverageRequirements: [{id: "rule", statement: "The rule applies", priority: "core"}]}});
    }, connect() {throw new Error("No sockets");}} satisfies Fetcher;
    let refreshes = 0;
    const result = await retrieveCorpusAwareLegalSources({query: "General rule", locale: "ru", now, targetService,
      targetEnvironment: "staging", targetQuestionId: `observation-${mode}`,
      verifyCurrentSource: async () => {refreshes++; throw new Error("Publisher refresh unavailable");},
      liveSearch: async () => ({...liveResult(), sources: []})});
    assert.equal(result.sources.length, mode === "fresh" ? 1 : 0);
    if (mode === "fresh") {
      assert.equal(result.sources[0]!.verifiedAt, observedAt);
      assert.equal(result.sources[0]!.lastCheckedAt, observedAt);
      assert.equal(result.evidence[0]!.validatedAt, observedAt);
    }
    assert.equal(refreshes, mode === "expired" || mode === "missing" ? 1 : 0);
    assert.deepEqual(result.coverageRequirements?.map(requirement => requirement.id), ["rule"]);
  }
});

test("an indexed list introduction is completed from separately validated official article evidence", async () => {
  let reads = 0;
  const targetService = { async fetch() {
    return Response.json({ result: { kind: "legal_answer", sourceLadder: "indexed_official_corpus",
      mainPoint: "Conditions apply", whatTheLawSays: [{ requirementId: "rule", provisionConceptId: "concept",
        provisionRenditionId: "rendition", proposition: "Applicable grounds", controllingQuotation: "Статья 17. Основания. Применяются следующие основания:",
        officialCitations: [{ label: "Code — Статья 17", url: "https://lex.uz/ru/docs/777" }], evidenceSha256: contentHash,
        currentSourceStatus: {pinnedTextSha256: contentHash, observation: null} }],
      whatToDoNext: [], focusedQuestions: [], formulationsUsed: 1, repairQueriesUsed: 0,
      temporalEndpoint: { kind: "current" } } });
  }, connect() { throw new Error("Unexpected socket connection"); } } satisfies Fetcher;
  const result = await retrieveCorpusAwareLegalSources({ query: "Какие основания применяются?", locale: "ru", targetService,
    targetEnvironment: "staging", targetQuestionId: "complete-list", budgetMs: 5000,
    articleContextReader: async (url, _locale, options) => {
      reads += 1;
      assert.equal(url, "https://lex.uz/ru/docs/777");
      assert.match(options!.query!, /17/u);
      const live = liveResult();
      return { source: { ...live.sources[0]!, article: "17", contentSha256: "b".repeat(64), spans: [{
        ...live.sources[0]!.spans![0]!, article: "Статья 17", text: "Применяются следующие основания: 1) первое основание; 2) второе основание.",
      }] }, evidence: { ...live.evidence[0]!, contentSha256: "b".repeat(64) } };
    },
    liveSearch: async () => { throw new Error("Known article must not require rediscovery"); },
  });
  assert.equal(reads, 1);
  assert.ok(result.sources.some(source => source.verificationState === "direct_validated" && source.spans?.some(span => span.text.includes("второе основание"))));
  assert.equal(result.sources.find(source => source.id.startsWith("target:"))?.contentSha256, contentHash,
    "supplemental text must not overwrite immutable indexed evidence");
  assert.equal(result.retrievalTelemetry?.fusionOutcome, "mixed");
});

for (const kind of ["insufficient_indexed_coverage", "source_unavailability"] as const) test(`${kind} carries only discovery locations into fresh live verification`, async () => {
  const urls = ["https://lex.uz/ru/docs/777"];
  const targetService = { async fetch() { return Response.json({ result: {
    kind, sourceLadder: "indexed_official_corpus", nextTier: "live_official_search",
    ...(kind === "insufficient_indexed_coverage" ? { uncoveredRequirementIds: ["missing-rule"] }
      : { safeErrorCode: "INDEXED_REVALIDATION_FAILED" }), discoveredOfficialUrls: urls,
  } }); }, connect() { throw new Error("Unexpected socket connection"); } } satisfies Fetcher;
  const result = await retrieveCorpusAwareLegalSources({ query: "Applicable rule", locale: "ru", targetService,
    targetEnvironment: "staging", targetQuestionId: "discovery-continuity",
    liveSearch: async input => { assert.deepEqual(input.knownOfficialUrls, urls); return liveResult(); },
  });
  assert.equal(result.sources[0]?.verificationState, "direct_validated");
  assert.equal(result.sources.some(source => source.id.startsWith("target:")), false);
});

test("contextual planning does not consume the Indexed Official Corpus deadline", async () => {
  let targetCalls = 0;
  let liveCalls = 0;
  const contextualQuestion = new Promise<string>((resolve) => {
    setTimeout(() => resolve("Срок исковой давности по трудовым спорам"), 25);
  });
  const result = await retrieveCorpusAwareLegalSources({
    query: "Срок исковой давности по трудовым спорам",
    locale: "ru",
    targetService: {
      fetch: async () => {
        targetCalls += 1;
        return Response.json({
          result: {
            kind: "legal_answer",
            sourceLadder: "indexed_official_corpus",
            mainPoint: "Срок регулируется Трудовым кодексом.",
            whatTheLawSays: [{
              requirementId: "labor-limitation-period",
              provisionConceptId: "labor-code-limitation-period",
              provisionRenditionId: "labor-code-limitation-period-current",
              proposition: "Трудовой спор имеет установленный законом срок обращения.",
              controllingQuotation: "Срок обращения за разрешением индивидуального трудового спора устанавливается настоящим Кодексом.",
              officialCitations: [{
                label: "Трудовой кодекс — Article 560",
                url: "https://lex.uz/ru/docs/6257288",
              }],
              evidenceSha256: contentHash, currentSourceStatus: {pinnedTextSha256: contentHash, observation: null},
            }],
            whatToDoNext: [],
            focusedQuestions: [],
            formulationsUsed: 2,
            repairQueriesUsed: 0,
            temporalEndpoint: { kind: "current" },
          },
        });
      },
    } as unknown as Fetcher,
    targetEnvironment: "production",
    targetQuestionId: "labor-limitation-period-question",
    contextualQuestion,
    budgetMs: 100,
    targetBudgetMs: 10,
    liveSearch: async () => {
      liveCalls += 1;
      return liveResult();
    },
  });

  assert.equal(targetCalls, 1);
  assert.equal(liveCalls, 0);
  assert.equal(result.sourceAccessMode, "approved_package");
  assert.equal(result.retrievalTelemetry?.fusionOutcome, "indexed");
});

test("target comparison citations retain their endpoint applicability", async () => {
  const statement = (suffix: string) => ({
    requirementId: "same-requirement",
    provisionConceptId: "concept-1",
    provisionRenditionId: `rendition-${suffix}`,
    proposition: `Rule ${suffix}`,
    controllingQuotation: `Controlling quotation ${suffix}`,
    officialCitations: [{
      label: `Трудовой кодекс — Article ${suffix}`,
      url: `https://lex.uz/ru/docs/${suffix}`,
    }],
    evidenceSha256: contentHash, currentSourceStatus: {pinnedTextSha256: contentHash, observation: null},
  });
  const answer = (suffix: string, temporalEndpoint: { kind: "current" } | { kind: "timestamp"; instant: string }) => ({
    kind: "legal_answer",
    sourceLadder: "indexed_official_corpus",
    mainPoint: `Answer ${suffix}`,
    whatTheLawSays: [statement(suffix)],
    coverageRequirements: [{ id: "same-requirement", statement: "The governing rule", priority: "core" }],
    whatToDoNext: [],
    focusedQuestions: [],
    formulationsUsed: 2,
    repairQueriesUsed: 0,
    temporalEndpoint,
  });
  const historicalInstant = "2020-01-01T00:00:00.000Z";
  const result = await retrieveCorpusAwareLegalSources({
    query: "compare",
    locale: "ru",
    targetService: {
      fetch: async () => Response.json({
        result: {
          kind: "comparison_answer",
          sourceLadder: "indexed_official_corpus",
          temporalScope: {
            kind: "comparison",
            left: { kind: "timestamp", instant: historicalInstant },
            right: { kind: "current" },
          },
          left: answer("1", { kind: "timestamp", instant: historicalInstant }),
          right: answer("2", { kind: "current" }),
          transitions: [{
            id: "transition-1",
            predecessorConceptId: "concept-1",
            successorConceptId: "concept-1",
            transition: "modified",
            evidenceUrl: "https://example.com/evidence.json",
            reviewState: "accepted",
          }],
          mainPoint: "The rule changed.",
          endpointFormulationSearches: 4,
        },
      }),
    } as unknown as Fetcher,
    targetEnvironment: "staging",
    targetQuestionId: "question-comparison",
    liveSearch: async () => assert.fail("comparison target coverage must not fall through"),
  });

  assert.deepEqual(result.sources.map((source) => source.applicabilityStatus), ["historical", "current"]);
  assert.equal(result.sources[0]?.effectiveDate, historicalInstant);
  assert.equal(result.sources[1]?.effectiveDate, null);
  assert.deepEqual(result.coverageRequirements?.map(requirement => [requirement.id, requirement.sourceIds]), [
    ["left:same-requirement", [result.sources[0]!.id]],
    ["right:same-requirement", [result.sources[1]!.id]],
  ]);
});

test("live supplementation retains a different article from an already indexed instrument", async () => {
  const result = await retrieveCorpusAwareLegalSources({
    query: "Which filing rules apply?", locale: "ru", now,
    targetEnvironment: "staging", targetQuestionId: "partial-scope",
    targetService: { fetch: async () => Response.json({ result: {
      kind: "partial_legal_answer", sourceLadder: "indexed_official_corpus", nextTier: "live_official_search",
      mainPoint: "A verified rule", whatTheLawSays: [{
        requirementId: "filing", provisionConceptId: "concept", provisionRenditionId: "rendition",
        proposition: "A verified filing rule", controllingQuotation: "A verified filing rule applies to this application.",
        officialCitations: [{label: "Law — Article 8", url: "https://lex.uz/ru/docs/777"}],
        evidenceSha256: contentHash, currentSourceStatus: {pinnedTextSha256: contentHash, observation: null},
      }], whatToDoNext: [], focusedQuestions: [], formulationsUsed: 2, repairQueriesUsed: 1,
      temporalEndpoint: {kind: "current"}, uncoveredSupportingRequirementIds: ["remedy"],
    } }) } as unknown as Fetcher,
    liveSearch: async () => liveResult(),
  });
  assert.deepEqual(result.sources.map(source => source.article), ["8", "9"]);
  assert.equal(result.coverageStatus, "partial_coverage");
});

test("an over-cap comparison fails closed instead of publishing one endpoint", async () => {
  const endpointAnswer = (
    prefix: string,
    temporalEndpoint: { kind: "current" } | { kind: "timestamp"; instant: string },
  ) => ({
    kind: "legal_answer",
    sourceLadder: "indexed_official_corpus",
    mainPoint: `Answer ${prefix}`,
    whatTheLawSays: Array.from({ length: 13 }, (_, index) => ({
      requirementId: `requirement-${prefix}-${index}`,
      provisionConceptId: `concept-${prefix}-${index}`,
      provisionRenditionId: `rendition-${prefix}-${index}`,
      proposition: `Rule ${prefix}-${index}`,
      controllingQuotation: `Controlling quotation ${prefix}-${index}`,
      officialCitations: [{
        label: `Code — Article ${index + 1}`,
        url: `https://lex.uz/ru/docs/${prefix}${index}`,
      }],
      evidenceSha256: contentHash, currentSourceStatus: {pinnedTextSha256: contentHash, observation: null},
    })),
    whatToDoNext: [],
    focusedQuestions: [],
    formulationsUsed: 2,
    repairQueriesUsed: 0,
    temporalEndpoint,
  });
  const historicalInstant = "2020-01-01T00:00:00.000Z";
  let liveStarted = 0;
  const result = await retrieveCorpusAwareLegalSources({
    query: "compare",
    locale: "ru",
    targetService: {
      fetch: async () => Response.json({
        result: {
          kind: "comparison_answer",
          sourceLadder: "indexed_official_corpus",
          temporalScope: {
            kind: "comparison",
            left: { kind: "timestamp", instant: historicalInstant },
            right: { kind: "current" },
          },
          left: endpointAnswer("left", { kind: "timestamp", instant: historicalInstant }),
          right: endpointAnswer("right", { kind: "current" }),
          transitions: [{
            id: "transition-over-cap",
            predecessorConceptId: "concept-left-0",
            successorConceptId: "concept-right-0",
            transition: "modified",
            evidenceUrl: "https://example.com/comparison-evidence.json",
            reviewState: "accepted",
          }],
          mainPoint: "The rule changed.",
          endpointFormulationSearches: 4,
        },
      }),
    } as unknown as Fetcher,
    targetEnvironment: "staging",
    targetQuestionId: "question-over-cap-comparison",
    liveSearch: async () => {
      liveStarted += 1;
      return liveResult();
    },
  });

  assert.equal(liveStarted, 0);
  assert.equal(result.sources.length, 0);
  assert.equal(result.sourceValidationStatus, "unavailable");
  assert.deepEqual(result.errors, [{ code: "TARGET_EVIDENCE_CEILING_EXCEEDED" }]);
  assert.equal(result.retrievalTelemetry?.rerankingOutcome, "failed_closed");
});

test("target source unavailability continues to direct validated Lex", async () => {
  let liveStarted = 0;
  const result = await retrieveCorpusAwareLegalSources({
    query: "статья 9",
    locale: "ru",
    targetService: {
      fetch: async () => Response.json({
        result: {
          kind: "source_unavailability",
          sourceLadder: "indexed_official_corpus",
          nextTier: "live_official_search",
          safeErrorCode: "INDEXED_CANDIDATE_UNAVAILABLE",
        },
      }),
    } as unknown as Fetcher,
    targetEnvironment: "staging",
    targetQuestionId: "question-2",
    liveSearch: async () => liveResult(),
    onLiveSearchStarted: () => { liveStarted += 1; },
  });
  assert.equal(liveStarted, 1);
  assert.equal(result.sourceAccessMode, "direct");
  assert.equal(result.retrievalTelemetry?.fusionOutcome, "live");
  assert.equal(result.retrievalTelemetry?.targetOutcome, "unavailable");
  assert.equal(result.retrievalTelemetry?.targetFailureCode, "INDEXED_CANDIDATE_UNAVAILABLE");
});

test("slow indexed research overlaps official discovery without treating its URLs as evidence", async () => {
  let releaseTarget!: () => void;
  const targetReady = new Promise<void>(resolve => {releaseTarget = resolve;});
  let discoveryStarted!: () => void;
  const discoveryReady = new Promise<void>(resolve => {discoveryStarted = resolve;});
  let discoveryCalls = 0;
  let targetFinished = false;
  let liveCalls = 0;
  const retrieval = retrieveCorpusAwareLegalSources({query: "An unrelated legal question", locale: "ru",
    targetPlanningHints: {answerLanguage: "ru", standaloneQuestion: "An unrelated legal question",
      requirements: [{statement: "An unrelated legal question", priority: "core"}], formulations: ["complete formulation"]},
    targetEnvironment: "staging", targetQuestionId: "overlapped-discovery", officialDiscoveryDelayMs: 1,
    lexSearchQueries: Promise.resolve(["complete formulation"]),
    targetService: {fetch: async () => {await targetReady; targetFinished = true; return Response.json({result: {
      kind: "source_unavailability", sourceLadder: "indexed_official_corpus", nextTier: "live_official_search",
      safeErrorCode: "INDEXED_CANDIDATE_UNAVAILABLE",
    }});}} as unknown as Fetcher,
    discoverOfficialUrls: async query => {discoveryCalls++; assert.equal(targetFinished, false);
      assert.equal(query, "An unrelated legal question\ncomplete formulation"); discoveryStarted(); return ["https://lex.uz/ru/docs/777"];},
    liveSearch: async options => {liveCalls++; assert.equal(targetFinished, true);
      assert.deepEqual(await options.discoverOfficialUrls!("An unrelated legal question\ncomplete formulation", "ru", options.signal ?? new AbortController().signal), ["https://lex.uz/ru/docs/777"]);
      return {...liveResult(), sources: [], evidence: [], sourceValidationStatus: "unavailable"};},
  });
  await discoveryReady;
  assert.equal(liveCalls, 0, "URL discovery is not validated live evidence");
  releaseTarget();
  const result = await retrieval;
  assert.equal(discoveryCalls, 1);
  assert.equal(liveCalls, 1);
  assert.equal(result.sources.length, 0);
  assert.notEqual(result.coverageStatus, "good_coverage");
});

test("a timed-out current target preserves budget for direct validated Lex", async () => {
  let liveStarted = 0;
  const result = await retrieveCorpusAwareLegalSources({
    query: "статья 9",
    locale: "ru",
    targetService: {
      fetch: async () => new Promise<Response>(() => {}),
    } as unknown as Fetcher,
    targetEnvironment: "staging",
    targetQuestionId: "question-timeout",
    targetBudgetMs: 5,
    liveSearch: async () => liveResult(),
    onLiveSearchStarted: () => { liveStarted += 1; },
  });

  assert.equal(liveStarted, 1);
  assert.equal(result.sourceAccessMode, "direct");
  assert.equal(result.retrievalTelemetry?.fusionOutcome, "live");
  assert.equal(result.retrievalTelemetry?.targetOutcome, "timed_out");
  assert.equal(result.retrievalTelemetry?.targetFailureCode, "TARGET_RETRIEVAL_TIMEOUT");
});

test("historical target unavailability never substitutes a current live page", async () => {
  let liveStarted = 0;
  const applicableAt = "2020-01-01T00:00:00.000Z";
  const result = await retrieveCorpusAwareLegalSources({
    query: "статья 9",
    locale: "ru",
    applicableAt,
    targetService: {
      fetch: async () => Response.json({
        result: {
          kind: "source_unavailability",
          sourceLadder: "indexed_official_corpus",
          nextTier: "live_official_search",
          safeErrorCode: "INDEXED_CANDIDATE_UNAVAILABLE",
        },
      }),
    } as unknown as Fetcher,
    targetEnvironment: "staging",
    targetQuestionId: "question-historical",
    liveSearch: async () => {
      liveStarted += 1;
      return liveResult();
    },
  });

  assert.equal(liveStarted, 0);
  assert.equal(result.sources.length, 0);
  assert.equal(result.legalDatabaseAsOf, applicableAt);
  assert.equal(result.sourceValidationStatus, "unavailable");
  assert.deepEqual(result.errors, [{ code: "HISTORICAL_INDEXED_COVERAGE_UNAVAILABLE" }]);
  assert.equal(result.retrievalTelemetry?.rerankingOutcome, "failed_closed");
});

test("an article mismatch keeps direct official coverage below the answer threshold", async () => {
  const result = await retrieveCorpusAwareLegalSources({
    query: "статья 10",
    locale: "ru",
    liveSearch: async () => liveResult(),
  });
  assert.equal(result.coverageStatus, "partial_coverage");
});

test("speculative current discovery requires an explicit shared current plan", async () => {
  let discoveryCalls = 0;
  await retrieveCorpusAwareLegalSources({query: "A question whose temporal scope is not yet interpreted", locale: "ru",
    targetEnvironment: "staging", targetQuestionId: "pending-interpretation", officialDiscoveryDelayMs: 1,
    targetService: {fetch: async () => {await new Promise(resolve => setTimeout(resolve, 10)); return Response.json({result: {
      kind: "source_unavailability", sourceLadder: "indexed_official_corpus", nextTier: "live_official_search",
      safeErrorCode: "QUESTION_INTERPRETATION_UNAVAILABLE",
    }});}} as unknown as Fetcher,
    discoverOfficialUrls: async () => {discoveryCalls++; return [];},
    liveSearch: async () => {assert.fail("An unavailable interpretation must not start live research");},
  });
  assert.equal(discoveryCalls, 0);
});

test("one live source or government guidance cannot independently certify official coverage", async () => {
  for (const sourceClass of ["OFFICIAL_LEGISLATION", "OFFICIAL_GOVERNMENT_GUIDANCE", "SECONDARY_REFERENCE"] as const) {
    const live = liveResult();
    live.sources = live.sources.map(source => ({...source, sourceClass}));
    const result = await retrieveCorpusAwareLegalSources({query: "Which duties and exceptions apply?", locale: "ru",
      liveSearch: async () => live});
    assert.notEqual(result.coverageStatus, "good_coverage", "source availability is not semantic requirement coverage");
  }
});

test("live research includes the wider internet while sufficient indexed answers stay local", () => {
  const packet = (coverageStatus: "good_coverage" | "partial_coverage" | "weak_coverage" | "no_coverage") => ({
    coverageStatus,
  });
  assert.equal(shouldRetrieveSecondaryInternet(packet("good_coverage")), false);
  assert.equal(shouldRetrieveSecondaryInternet(packet("partial_coverage")), true);
  assert.equal(shouldRetrieveSecondaryInternet({ ...packet("good_coverage"), sourceAccessMode: "direct" }), true);
  assert.equal(shouldRetrieveSecondaryInternet({ ...packet("good_coverage"), sourceAccessMode: "approved_package" }), false);
  assert.equal(shouldRetrieveSecondaryInternet(packet("weak_coverage")), true);
  assert.equal(shouldRetrieveSecondaryInternet(packet("no_coverage")), true);
});

test("caller cancellation stops before direct retrieval starts", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("caller cancelled", "AbortError"));
  let calls = 0;
  await assert.rejects(retrieveCorpusAwareLegalSources({
    query: "статья 9",
    locale: "ru",
    signal: controller.signal,
    liveSearch: async () => {
      calls += 1;
      return liveResult();
    },
  }), (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.equal(calls, 0);
});
