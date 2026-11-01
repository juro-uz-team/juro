import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createStoredCorpus, type StoredProvisionReceipt } from "../lib/legal-answer-workflow/stored-corpus";
import { readOfficialProvision } from "../lib/legal-answer-workflow/evidence";
import { buildCorpusCitations } from "../lib/legal-answer-workflow/corpus-citations";
import { researchEvidence } from "../lib/legal-answer-workflow/research-context";

test("complete evidence carries the retained act title independently of similarly named section headings", async () => {
  const bytes = Buffer.from("Complete artificial rule with its qualification.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const receipt: StoredProvisionReceipt = { title: "Artificial Rules for a Particular Service", articleTitle: "Discipline",
    language: "en", textSha256: sha256, selected: { kind: "provision", articleNumber: null },
    locator: { identity: "source", snapshot: "generation", objectKey: "object", sha256, byteCount: bytes.length,
      sourceUrl: "https://lex.uz/docs/123#1", sourceTitle: "Artificial Rules for a Particular Service",
      privacyClass: "public_official_source", quarantined: false,
      canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true,
      editionObservation: { selectedEdition: "2020", observedAt: "2020-01-01T00:00:00.000Z" } } };
  const originalReceipt = structuredClone(receipt);
  const discovery = { search: async () => ({ candidates: ["hit"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async () => ({ work: "work", source: { inventory: { id: "work" }, prepared: { work: "work" } },
      unitMetadata: { locator: "1", language: "en", text: "Preview" } }) };
  const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: { get: async () => bytes },
    provisions: { lookup: async () => receipt, reference: async () => null } });
  const signal = new AbortController().signal, scope = { kind: "current" } as const;
  await corpus.search("discipline", scope, signal);
  const locator = await corpus.resolve("hit", scope, signal);
  assert.ok(locator);
  const provision = await readOfficialProvision(locator, corpus, scope, signal);
  const context = researchEvidence([provision])[0];
  assert.equal("sourceTitle" in context && context.sourceTitle, receipt.title);
  assert.equal(context.text, bytes.toString());
  const citations = buildCorpusCitations([provision], corpus, {
    namespace: `legal-prepared-${"a".repeat(64)}`, generationSha256: "a".repeat(64) });
  assert.equal(citations[0].source.actTitle, receipt.title);
  assert.deepEqual(receipt, originalReceipt, "The reader's input receipt is not mutated");
});

test("document selections bind discovered work, language and temporal scope while coalescing sibling reads", async () => {
  const requested: unknown[] = [];
  const discovery = { search: async () => ({ candidates: ["first", "sibling", "translation"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async (identity: string) => ({ work: "work", source: { inventory: { id: "work" }, prepared: { work: "work" } },
      unitMetadata: { locator: identity === "sibling" ? "2" : "1", language: identity === "translation" ? "ru" : "en", text: "Preview" } }) };
  const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: { get: async () => null },
    provisions: { lookup: async request => { requested.push(request); return null; }, reference: async () => null } });
  const signal = new AbortController().signal;
  const current = { kind: "current" } as const, historical = { kind: "historical", at: "2020-01-01" } as const;
  await assert.rejects(corpus.resolveDocument("first", current, signal), /CANDIDATE_NOT_DISCOVERED/);
  await corpus.search("rule", current, signal);
  await Promise.all(["first", "sibling", "translation"].map(id => corpus.resolveDocument(id, current, signal)));
  await assert.rejects(corpus.resolveDocument("first", historical, signal), /CANDIDATE_NOT_DISCOVERED/);
  await corpus.search("rule", historical, signal);
  await corpus.resolveDocument("first", historical, signal);
  await corpus.resolve("first", current, signal);
  assert.deepEqual(requested, [
    { work: "work", position: "1", language: "en", scope: current, wholeDocument: true },
    { work: "work", position: "1", language: "ru", scope: current, wholeDocument: true },
    { work: "work", position: "1", language: "en", scope: historical, wholeDocument: true },
    { work: "work", position: "1", language: "en", scope: current, wholeSection: false },
  ]);
});

test("discovery can expose source notices without loading complete sources before selection", async () => {
  const discovery = { search: async () => ({ candidates: ["hit"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async () => ({ work: "work", source: { inventory: { id: "work", url: "https://lex.uz/docs/123" },
      prepared: { work: "work", title: "Artificial act", notices: ["Repealed on the stated date"] } },
      unitMetadata: { locator: "1", language: "en", text: "Preview" } }) };
  const corpus = createStoredCorpus({ current: discovery, history: discovery, deferSourceNavigation: true,
    objects: { get: async () => null }, provisions: {
      describeRange: async () => { throw new Error("Full source must not load during discovery"); },
      lookup: async () => null, reference: async () => null } });
  const signal = new AbortController().signal, scope = { kind: "current" } as const;
  await corpus.search("rule", scope, signal);
  const [candidate] = await corpus.describeCandidates(["hit"], scope, signal);
  assert.equal(candidate.descriptionFailure, undefined);
  assert.equal(candidate.readRange, undefined);
  assert.deepEqual(candidate.sourceNotes, ["Repealed on the stated date"]);
});

test("overlapping chapter and article previews retain their distinct complete-read ranges in either order", async () => {
  const units = ["Chapter 1", "Article 1. Rule", "First rule.", "Article 2. Exception", "Second rule."].map((text, ordinal) =>
    ({ ordinal, locator: `${ordinal}`, text, language: "en", hierarchy: ["Chapter 1"] }));
  const prepared = { work: "work", title: "Artificial Act", units, gaps: [], tables: [] };
  for (const ids of [["0", "1"], ["1", "0"]]) {
    const discovery = { search: async () => ({ candidates: ids, sparseAvailable: true, denseAvailable: true }),
      readCandidate: async (identity: string) => ({ work: "work", source: { inventory: { id: "work", url: "https://lex.uz/docs/123" }, prepared },
        unitMetadata: units[Number(identity)] }) };
    const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: { get: async () => null },
      provisions: { lookup: async () => null, reference: async () => null } });
    const signal = new AbortController().signal;
    await corpus.search("rule", { kind: "current" }, signal);
    const descriptions = [];
    for (const id of ids) descriptions.push(...await corpus.describeCandidates([id], { kind: "current" }, signal));
    assert.equal(descriptions.find(item => item.identity === "0")?.readRange?.kind, "document");
    assert.equal(descriptions.find(item => item.identity === "1")?.readRange?.kind, "provision");
    assert.notEqual(descriptions[0].readRange?.key, descriptions[1].readRange?.key);
  }
});

test("adjacent reads require a retained parent, cache reads, and reject another document or edition", async () => {
  const bytes = Buffer.from("Complete artificial rule."), sha256 = createHash("sha256").update(bytes).digest("hex");
  const parent: StoredProvisionReceipt = { locator: { identity: "parent", snapshot: "snapshot", objectKey: "parent",
    sha256, byteCount: bytes.length, sourceUrl: "https://lex.uz/docs/123#456", privacyClass: "public_official_source",
    quarantined: false, canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true,
    editionObservation: { selectedEdition: "01.01.2020", observedAt: "2020-01-01T00:00:00.000Z" } },
    title: "Artificial act", articleTitle: "Article 1", language: "en", textSha256: sha256,
    selected: { kind: "provision", articleNumber: null } };
  const discovery = { async search() { return { candidates: ["candidate"], sparseAvailable: true, denseAvailable: true }; },
    async readCandidate() { return { work: "work", source: { inventory: { id: "work" }, prepared: { work: "work" } },
      unitMetadata: { locator: "456", language: "en", text: "Preview" } }; } };
  for (const invalid of [null, "document", "edition", "snapshot"] as const) {
    let calls = 0;
    const child = structuredClone(parent);
    child.locator.identity = "child";
    child.locator.objectKey = "child";
    child.locator.sourceUrl = invalid === "document" ? "https://lex.uz/docs/999#789" : "https://lex.uz/docs/123#789";
    if (invalid === "edition") child.locator.editionObservation!.selectedEdition = "02.01.2020";
    if (invalid === "snapshot") child.locator.snapshot = "another";
    const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: { async get() { return bytes; } },
      provisions: { async lookup() { return parent; }, async reference() { return null; },
        async adjacent() { calls++; return child; } } });
    const signal = new AbortController().signal, scope = { kind: "current" } as const;
    await assert.rejects(corpus.resolveAdjacent("parent", "next", scope, signal), /ADJACENT_PARENT_UNAVAILABLE/);
    await corpus.search("question", scope, signal);
    await corpus.resolve("candidate", scope, signal);
    await assert.rejects(corpus.resolveAdjacent("parent", "next", { kind: "historical", at: "2020-01-01" }, signal), /ADJACENT_SCOPE_MISMATCH/);
    if (invalid) {
      await assert.rejects(corpus.resolveAdjacent("parent", "next", scope, signal), /ADJACENT_SOURCE_MISMATCH/);
      assert.equal(corpus.receipt("child"), null);
    } else {
      const found = await corpus.resolveAdjacent("parent", "next", scope, signal);
      assert.deepEqual(found, child.locator);
      found!.sourceUrl = "https://lex.uz/docs/999";
      assert.deepEqual(await corpus.resolveAdjacent("parent", "next", scope, signal), child.locator);
      assert.equal(corpus.receipt("child")?.textSha256, sha256);
    }
    assert.equal(calls, 1);
  }
});

test("stored corpus reads complete retained evidence without preparing or writing sources", async () => {
  const bytes = Buffer.from("Artificial complete rule. The exception applies only with written consent.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const locator = { identity: "stored:rule", snapshot: "snapshot:one", objectKey: "retained:one", sha256,
    byteCount: bytes.length, sourceUrl: "https://lex.uz/docs/123#456", privacyClass: "public_official_source" as const,
    quarantined: false, canonicalizationConflict: false, temporalState: "current_supported" as const,
    currentPointerVerified: true, editionObservation: { selectedEdition: "01.01.2020", observedAt: "2020-01-01T00:00:00.000Z" } };
  const signal = new AbortController().signal;
  const discovery = {
    async search() { return { candidates: ["candidate:one"], sparseAvailable: true, denseAvailable: true }; },
    async readCandidate() { return { work: "work:one", source: {
      inventory: { id: "work:one", url: "https://lex.uz/docs/123" }, prepared: { work: "work:one", title: "Artificial act" } },
      unitMetadata: { locator: "456", language: "en", text: "Artificial preview", ordinal: 0 } }; },
  };
  let reads = 0;
  const corpus = createStoredCorpus({ current: discovery, history: discovery,
    objects: { async get(key) { assert.equal(key, "retained:one"); reads++; return bytes; } },
    provisions: { async lookup(request) {
      assert.deepEqual(request, { work: "work:one", position: "456", language: "en", scope: { kind: "current" }, wholeSection: false });
      return { locator, title: "Artificial act", articleTitle: "Rule", language: "en", textSha256: sha256,
        selected: { kind: "provision" as const, articleNumber: null } };
    }, async reference() { return null; } },
  });
  await assert.rejects(corpus.resolve("candidate:one", { kind: "current" }, signal), /CANDIDATE_NOT_DISCOVERED/);
  await corpus.search("artificial question", { kind: "current" }, signal);
  const found = await corpus.resolve("candidate:one", { kind: "current" }, signal);
  assert.deepEqual(found, locator);
  const evidence = await readOfficialProvision(found!, corpus, { kind: "current" }, signal);
  assert.equal(evidence.text, bytes.toString());
  assert.equal(corpus.receipt(locator.identity)?.textSha256, sha256);
  assert.equal(reads, 1);
  const generationSha256 = "a".repeat(64);
  const citations = buildCorpusCitations([evidence], corpus, { generationSha256, namespace: `legal-prepared-${generationSha256}` });
  assert.equal(citations[0].receipt.kind, "provision");
  assert.equal(citations[0].source.verifiedAt, "2020-01-01T00:00:00.000Z");
});

test("literal positions do not inherit the parent unit hierarchy", async () => {
  const scope = { kind: "current" } as const, signal = new AbortController().signal;
  const discovery = {
    search: async () => ({ candidates: ["parent"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async () => ({ work: "work", source: {
      inventory: { id: "work", url: "https://lex.uz/docs/123" }, prepared: { work: "work" } },
      unitMetadata: { locator: "1", language: "en", text: "Parent rule", hierarchy: ["Article 1"] } }),
  };
  const corpus = createStoredCorpus({ current: discovery, history: discovery, deferSourceNavigation: true,
    objects: { get: async () => null }, provisions: { lookup: async () => null, reference: async () => null,
      findInSource: async () => [{ position: "2", text: "Another article" }, { position: "3", text: "Third article" }] } });
  await corpus.search("rule", scope, signal);
  const matches = await corpus.findInSource("parent", "article", scope, signal);
  const descriptions = await corpus.describeCandidates(matches, scope, signal);
  assert.equal(descriptions.length, 2);
  assert.ok(descriptions.every(description => description.hierarchy === undefined && description.readRange === undefined));
  assert.deepEqual(descriptions.map(description => description.text), ["Another article", "Third article"]);
});

function missingFixture(receipt: StoredProvisionReceipt | null = null, bytes: Uint8Array | null = new Uint8Array()) {
  const discovery = {
    async search() { return { candidates: ["candidate:one"], sparseAvailable: true, denseAvailable: true }; },
    async readCandidate() { return { work: "work:one", source: {
      inventory: { id: "work:one", url: "https://lex.uz/docs/123" }, prepared: { work: "work:one" } },
      unitMetadata: { locator: "456", language: "en", text: "A ranking preview cannot supply missing law." } }; },
  };
  return createStoredCorpus({ current: discovery, history: discovery,
    objects: { async get() { return bytes; } },
    provisions: { async lookup() { return receipt; }, async reference() { return null; } } });
}

test("missing stored provisions remain missing despite nonempty search previews", async () => {
  const corpus = missingFixture(), signal = new AbortController().signal;
  await corpus.search("artificial question", { kind: "current" }, signal);
  assert.equal(await corpus.resolve("candidate:one", { kind: "current" }, signal), null);
  assert.equal(corpus.receipt("candidate:one"), null);
  await assert.rejects(corpus.resolveReference("candidate:one", "https://lex.uz/docs/123#456", { kind: "current" }, signal),
    /REFERENCE_NOT_AUTHENTICATED/);
});

test("candidate access is scoped to the request and requested time", async () => {
  const first = missingFixture(), second = missingFixture(), signal = new AbortController().signal;
  await first.search("artificial question", { kind: "current" }, signal);
  await assert.rejects(second.resolve("candidate:one", { kind: "current" }, signal), /CANDIDATE_NOT_DISCOVERED/);
  await assert.rejects(first.resolve("candidate:one", { kind: "historical", at: "2020-01-01" }, signal), /CANDIDATE_NOT_DISCOVERED/);
  const controller = new AbortController();
  controller.abort(new Error("request cancelled"));
  await assert.rejects(first.resolve("candidate:one", { kind: "current" }, controller.signal), /request cancelled/);
});

test("missing stored bytes cannot produce a citation receipt", async () => {
  const corpus = missingFixture({ locator: { identity: "stored:rule", snapshot: "snapshot:one", objectKey: "retained:one",
    sha256: "a".repeat(64), byteCount: 3, sourceUrl: "https://lex.uz/docs/123#456", privacyClass: "public_official_source",
    quarantined: false, canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true },
    title: "Artificial act", articleTitle: null, language: "en", textSha256: "a".repeat(64),
    selected: { kind: "provision", articleNumber: null } }, null);
  const signal = new AbortController().signal;
  await corpus.search("artificial question", { kind: "current" }, signal);
  await assert.rejects(corpus.resolve("candidate:one", { kind: "current" }, signal), /OFFICIAL_PROVISION_NOT_FOUND/);
  assert.equal(corpus.receipt("stored:rule"), null);
});

test("unavailable read ranges and one failed catalog item preserve neighboring previews and partial-lane results", async () => {
  const signal = new AbortController().signal, scope = { kind: "current" } as const;
  const units = [{ ordinal: 0, locator: "0", text: "Article 1. Artificial rule", language: "en", hierarchy: [] }];
  const discovery = { search: async () => ({ candidates: ["good", "range-missing", "catalog-missing"], sparseAvailable: true, denseAvailable: false }),
    readCandidate: async (identity: string) => {
      if (identity === "catalog-missing") throw new Error("CATALOG_UNAVAILABLE");
      return { work: "work", source: { inventory: { id: "work", url: "https://lex.uz/docs/123" },
        prepared: { work: "work", title: "Artificial Act", units, gaps: [], tables: [] } },
        unitMetadata: { ...units[0], locator: identity === "good" ? "0" : "missing", text: identity === "good" ? units[0].text : "Article 2. Mandatory procedure" } };
    } };
  const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: { get: async () => null },
    provisions: { lookup: async () => null, reference: async () => null } });
  const packet = await corpus.search("artificial question", scope, signal);
  assert.equal(packet.denseAvailable, false);
  const descriptions = await corpus.describeCandidates(packet.candidates, scope, signal);
  assert.deepEqual(descriptions.map(item => item.identity), packet.candidates);
  assert.equal(descriptions[0].title, "Artificial Act");
  assert.ok(descriptions[0].readRange);
  assert.equal(descriptions[1].text, "Article 2. Mandatory procedure");
  assert.equal(descriptions[1].readRange, undefined);
  assert.ok(descriptions[1].descriptionFailure);
  assert.match(descriptions[2].text, /unavailable/);
  assert.ok(descriptions[2].descriptionFailure);
});

