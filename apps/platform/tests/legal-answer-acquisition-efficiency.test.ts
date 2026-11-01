import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createCorpusResearch } from "../lib/legal-answer-workflow/corpus-research";
import { ResearchWorkspace } from "../lib/legal-answer-workflow/research-workspace";
import { assessmentSchema, type Interpretation, type WorkflowPorts } from "../lib/legal-answer-workflow/contracts";

const interpretation: Interpretation = { complexity: "simple", needsClarification: false,
  requirements: [{ id: "r", question: "Artificial permit conditions" }], queries: ["first", "second"],
  scopes: [{ kind: "current" }, { kind: "historical", at: "2020-01-01" }], facts: [], clarificationQuestions: [] };

function fixture(limit = 3, failSection = false, documentFallback = false) {
  const reads: string[] = [], searches: string[] = [], fetched: string[] = [];
  const bytes = Buffer.from("Complete artificial scope, rule, qualification and exception.");
  const workspace = new ResearchWorkspace();
  const ports: WorkflowPorts = {
    model: { complete: async () => assert.fail("No provider calls") },
    publication: { publish: async () => assert.fail("No publication") },
    corpus: { automaticReadLimit: limit, automaticReadScope: "section", candidateReadScope: "section",
      search: async (query, scope) => { searches.push(`${query}:${scope.kind}`); return {
        candidates: [`${query}-a`, `${query}-b`], sparseAvailable: true, denseAvailable: true }; },
      describeCandidates: async ids => ids.map(identity => ({ identity, sourceUrl: `https://lex.uz/docs/${identity.startsWith("first") ? "123" : "456"}`,
        text: "Artificial navigation", truncated: true,
        readRange: { kind: "provision" as const, key: identity, language: "en",
          sections: [{ key: "same-section-key", position: "section", title: "Complete section" }] } })),
      resolve: async (identity, scope, _signal, section) => {
        reads.push(`${identity}:${scope.kind}:${section ?? "article"}`);
        if (failSection && section) return null;
        return locator(`${identity}:${scope.kind}:${section ?? "article"}`, scope);
      },
      resolveDocument: async (identity, scope) => { reads.push(`${identity}:${scope.kind}:document`); return locator(`${identity}:${scope.kind}:document`, scope); },
      resolveAdjacent: async () => assert.fail("No automatic adjacency fan-out"),
      resolveIntroductory: async () => assert.fail("No automatic introductory fan-out"),
      get: async key => { fetched.push(key); return bytes; } },
  };
  function locator(identity: string, scope: Interpretation["scopes"][number]) {
    return { identity, snapshot: "fixture", objectKey: identity, sha256: createHash("sha256").update(bytes).digest("hex"),
      byteCount: bytes.length, sourceUrl: `https://lex.uz/docs/${identity.startsWith("second") ? "456" : "123"}`, privacyClass: "public_official_source" as const,
      quarantined: false, canonicalizationConflict: false, currentPointerVerified: true,
      ...(documentFallback ? { sourceStructure: { navigationOnly: true as const, rangeKind: "document" as const,
        rangeTitle: null, anchor: { position: "1", ordinal: 0, language: "en" }, headings: [] } } : {}),
      temporalState: scope.kind === "current" ? "current_supported" as const : "historical_only" as const,
      ...(scope.kind === "historical" ? { applicableAt: scope.at } : {}) };
  }
  const signal = new AbortController().signal;
  const research = createCorpusResearch(ports, workspace, signal, signal);
  return { research, workspace, reads, searches, fetched };
}

test("automatic complete reads share a request allowance across queries, scopes and concurrent acquisition", async () => {
  const { research, workspace, reads, searches } = fixture();
  await Promise.all([research.acquire(interpretation.queries, interpretation), research.acquire(interpretation.queries, interpretation)]);
  assert.deepEqual(reads, ["first-a:current:section", "first-a:historical:section", "second-a:current:section"]);
  assert.equal(searches.length, 4);
  assert.equal(research.discoveredCandidates.length, 8, "all navigation remains available");
  const originals = workspace.active().map(item => item.text);
  const candidate = research.discoveredCandidates.find(item => item.identity === "second-a" && item.scope.kind === "historical")!;
  assert.equal((await research.execute({ requirementId: "r", candidateId: candidate.id }, interpretation)).kind, "complete_read");
  assert.equal(workspace.active().length, 4, "explicit reads remain available after the seed allowance");
  assert.deepEqual(workspace.active().slice(0, 3).map(item => item.text), originals);
});

test("unavailable enclosure falls back to its entire provision without resetting the allowance", async () => {
  const { research, workspace, reads } = fixture(1, true);
  await research.acquire(interpretation.queries, interpretation);
  await research.acquire(interpretation.queries, interpretation);
  assert.deepEqual(reads, ["first-a:current:section", "first-a:current:article"]);
  assert.equal(workspace.active().length, 1);
});

test("whole documents require an explicit valid action and retain previously acquired sections", async () => {
  const { research, workspace, reads } = fixture(0);
  await research.discover(interpretation.queries, interpretation);
  const candidateId = research.discoveredCandidates[0].id;
  const action = { requirementId: "r", candidateId, wholeDocument: true as const };
  assert.equal(assessmentSchema.shape.recovery.element.safeParse(action).success, true);
  assert.equal(assessmentSchema.shape.recovery.element.safeParse({ ...action, wholeSection: true }).success, false);
  await research.execute({ requirementId: "r", candidateId }, interpretation);
  assert.equal(reads[0], "first-a:current:section");
  assert.equal((await research.execute(action, interpretation)).kind, "complete_read");
  assert.equal(reads[1], "first-a:current:document");
  assert.equal(workspace.active().length, 2);
  assert.equal((await research.execute(action, interpretation)).kind, "duplicate");
});

test("document navigation and uncertain-boundary fallbacks cannot silently load whole sources", async () => {
  for (const advertised of [true, false]) {
    const { research, workspace, reads, fetched } = fixture(0, false, true);
    await research.discover(interpretation.queries, interpretation);
    const candidate = research.discoveredCandidates[0];
    if (advertised) candidate.readRange = { kind: "document", key: "document", language: "en" };
    const result = await research.execute({ requirementId: "r", candidateId: candidate.id }, interpretation);
    assert.equal(result.kind, "unavailable");
    assert.equal(result.code, "WHOLE_DOCUMENT_SELECTION_REQUIRED");
    assert.equal(workspace.active().length, 0);
    assert.deepEqual(fetched, [], "reject broader locators before fetching their full contents");
    if (advertised) assert.equal(reads.length, 0);
    assert.equal((await research.execute({ requirementId: "r", candidateId: candidate.id, wholeDocument: true }, interpretation)).kind, "complete_read");
    assert.equal(workspace.active().length, 1);
  }
});

test("governing introductory sections remain explicitly readable after targeted section acquisition", async () => {
  const { research, workspace, reads } = fixture(1);
  await research.acquire(interpretation.queries, interpretation);
  const candidate = research.discoveredCandidates.find(item => item.identity === "first-a" && item.scope.kind === "current")!;
  candidate.readRange!.sourceSections = [{ key: "governing-scope", position: "annex-introduction", title: "Scope and definitions" }];
  assert.equal(research.offeredSections(candidate).some(section => section.position === "annex-introduction"), true);
  const retained = workspace.active()[0];
  const result = await research.execute({ requirementId: "r", candidateId: candidate.id, sectionPosition: "annex-introduction" }, interpretation);
  assert.equal(result.kind, "complete_read");
  assert.equal(reads.at(-1), "first-a:current:annex-introduction");
  assert.equal(workspace.active().length, 2);
  assert.deepEqual(workspace.active()[0], retained);
  assert.equal((await research.execute({ requirementId: "r", candidateId: candidate.id, sectionPosition: "invented-introduction" }, interpretation)).kind, "invalid");
});

test("following an operative link cannot silently add an entire referenced act to context", async () => {
  const workspace = new ResearchWorkspace(), bytes = Buffer.from("Complete rule referring to another act.");
  const url = "https://lex.uz/docs/456";
  const parent = { identity: "parent", snapshot: "fixture", objectKey: "parent", text: bytes.toString(),
    sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
    sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source" as const,
    quarantined: false as const, canonicalizationConflict: false as const, currentPointerVerified: true,
    temporalState: "current_supported" as const, operativeReferences: [{ url, text: "Related act" }] };
  workspace.retain(parent);
  const signal = new AbortController().signal;
  const research = createCorpusResearch({
    model: { complete: async () => assert.fail("No generation") }, publication: { publish: async () => assert.fail("No publication") },
    corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }), resolve: async () => null,
      resolveReference: async () => ({ ...parent, identity: "referenced", objectKey: "referenced", sourceUrl: url,
        sourceStructure: { navigationOnly: true, rangeKind: "document", rangeTitle: "Related act",
          anchor: { position: "1", ordinal: 0, language: "en" }, headings: [] } }),
      get: async () => assert.fail("A broad reference must not fetch model-context text") },
  }, workspace, signal, signal);
  const result = await research.execute({ requirementId: "r", sourceId: "parent", url }, interpretation);
  assert.equal(result.kind, "unavailable");
  assert.equal(result.code, "COMPLETE_PROVISION_SELECTION_REQUIRED");
  assert.deepEqual(workspace.active(), [parent]);
});
