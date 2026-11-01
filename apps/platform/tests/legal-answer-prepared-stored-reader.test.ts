import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createPreparedStoredReader } from "../lib/legal-answer-workflow/prepared-stored-reader";
import { resolveSavedSourceRoute } from "../lib/legal-answer-workflow/saved-source-routing";
import { buildCorpusCitations } from "../lib/legal-answer-workflow/corpus-citations";
import { createStoredCorpus } from "../lib/legal-answer-workflow/stored-corpus";
import { readOfficialProvision } from "../lib/legal-answer-workflow/evidence";
import { researchReferences } from "../lib/legal-answer-workflow/research-context";
import { modelResearchDiscovery } from "../lib/legal-answer-workflow/research-context";

const hash = "a".repeat(64), token = "t".repeat(40);
const artifacts = { packageSha256: hash, vectorCompletionSha256: hash, vectorIdentitySha256: hash,
  membershipSha256: hash, workIndexSha256: hash, navigationSha256: hash, sparseSha256: hash };
const release = (capability: "current" | "history") => ({ id: `fixture-${capability}`, capability, environment: "staging",
  instances: [{ id: "fixture", shardId: "fixture-shard" }], configuration: { backend: "prepared-corpus-v1",
    navigationBackend: "pgvector", identity: "fixture", embeddingModel: "openai/text-embedding-3-large", dimensions: 3072,
    artifacts, evidenceSemantics: "discovery-only", categoryRanking: { mode: "disabled" }, gatewayIdentity: "fixture",
    providerProjectIdentity: "fixture", gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false } });
function source(edition: string | null = null) {
  const hierarchy: string[] = [];
  return { current_capture: "unique", inventory: { id: "work", kind: "document", state: "done",
    url: `https://lex.uz/docs/123${edition ? `?ONDATE=${edition}` : ""}`, raw_hash: hash,
    context: { source: "123", edition }, receipt: { status: 200, sha256: hash, observed: 1577836800 } },
    prepared: { work: "work", source: "123", title: "Artificial act", requested_edition: edition,
      selected_edition: ["01.01.2020"], gaps: [], tables: [], relationships: [
        { kind: "publisher_link", href: "#200", label: "Other rule", locator: "101" },
      ], units: [
        { ordinal: 0, locator: "100", language: "en", hierarchy, text: "Article 1. Rule" },
        { ordinal: 1, locator: "101", language: "en", hierarchy, text: "A complete rule." },
        { ordinal: 2, locator: "200", language: "en", hierarchy, text: "Article 2. Other rule" },
        { ordinal: 3, locator: "201", language: "en", hierarchy, text: "Its complete exception." },
      ] } };
}
async function withReader(item: ReturnType<typeof source>, capability: "current" | "history",
  run: (reader: ReturnType<typeof createPreparedStoredReader>, worker: { url: string; workerSha256: string; token: string }) => Promise<void>) {
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/read-sources");
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(body.artifacts, artifacts);
    if (body.reference) {
      response.setHeader("x-juro-worker-sha256", hash);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ package_sha256: hash, work_index_sha256: hash, reference_status: "missing", sources: {} }));
      return;
    }
    assert.ok(body.works.length === 1 && ["work", "unavailable"].includes(body.works[0]));
    response.setHeader("x-juro-worker-sha256", hash);
    response.setHeader("content-type", "application/json");
    if (body.works[0] === "unavailable") { response.writeHead(404).end(); return; }
    response.end(JSON.stringify({ package_sha256: hash, work_index_sha256: hash, sources: { work: item } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const worker = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, workerSha256: hash, token };
    await run(createPreparedStoredReader({ release: release(capability), worker }), worker);
  } finally {
    server.closeIdleConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
const target = { work: "work", position: "101", language: "en" };
const signal = () => AbortSignal.timeout(3000);

test("a multi-megabyte act contributes only selected complete articles, with wider extents visible before reading", async () => {
  const item = source(), hierarchy = ["Part 1. Artificial obligations"];
  const unit = (ordinal: number, locator: string, text: string) => ({ ordinal, locator, text, language: "en", hierarchy });
  item.prepared.units = [unit(0, "100", hierarchy[0]), unit(1, "101", "Article 1. Permit"),
    unit(2, "102", "A permit is required. Complete qualification: written consent — согласие — is necessary."),
    unit(3, "103", "Exception: private events are exempt. See Article 2 for the governing scope."),
    unit(4, "200", "Article 2. Scope"), unit(5, "201", "Governing scope: this rule applies only to public events.")];
  for (let index = 0; index < 400; index++) {
    item.prepared.units.push(unit(6 + index * 2, String(300 + index * 2), `Article ${index + 3}. Other rule`),
      unit(7 + index * 2, String(301 + index * 2), "Unrelated complete operative text. ".repeat(200)));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(item.prepared)) > 2_000_000);
  item.prepared.relationships = [{ kind: "publisher_link", href: "#200", label: "Scope", locator: "103" }];
  const original = structuredClone(item);
  await withReader(item, "current", async reader => {
    const scope = { kind: "current" } as const, active = AbortSignal.timeout(15_000);
    const discovery = { search: async () => ({ candidates: ["hit"], sparseAvailable: true, denseAvailable: true }),
      readCandidate: async () => ({ work: "work", source: { inventory: item.inventory, prepared: item.prepared },
        unitMetadata: item.prepared.units[2] }) };
    const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: reader, provisions: reader.provisions });
    await corpus.search("permit", scope, active);
    const [description] = await corpus.describeCandidates(["hit"], scope, active, true);
    assert.equal(description.readRange?.kind, "provision");
    assert.equal(description.readRange?.unitCount, 3);
    assert.ok(description.readRange!.textByteCount! < 500);
    assert.ok(description.readRange!.sections![0].textByteCount! > 2_000_000);
    const packet = modelResearchDiscovery([{ ...description, id: "c1", scope, query: "permit", queries: ["permit"], ranks: [] }]);
    assert.equal(packet.unreadCandidates[0].readRange?.textByteCount, description.readRange?.textByteCount);
    assert.ok(packet.unreadCandidates[0].readRange!.sections![0].textByteCount! > 2_000_000);
    assert.ok(Object.values(packet.candidateSourceSections).flat().some(section => section.textByteCount! > 2_000_000),
      "the shared section directory keeps extent metadata through model projection");
    const locator = await corpus.resolve("hit", scope, active);
    assert.ok(locator);
    const provision = await readOfficialProvision(locator, corpus, scope, active);
    assert.equal(Buffer.byteLength(provision.text), description.readRange!.textByteCount);
    assert.match(provision.text, /согласие/);
    assert.match(provision.text, /private events are exempt/);
    assert.doesNotMatch(provision.text, /Unrelated complete operative text/);
    const [scopeCandidate] = await corpus.findInSource("hit", "Governing scope:", scope, active);
    const scopeLocator = await corpus.resolve(scopeCandidate, scope, active);
    assert.ok(scopeLocator);
    const governing = await readOfficialProvision(scopeLocator, corpus, scope, active);
    assert.match(governing.text, /only to public events/);
    assert.equal(provision.editionObservation?.selectedEdition, governing.editionObservation?.selectedEdition);
    assert.match(provision.text, /private events are exempt/, "the earlier complete article remains unchanged");
  });
  assert.deepEqual(item, original);
});

test("an uncertain article boundary requires an explicit broader read instead of implicit document hydration", async () => {
  const item = source();
  item.prepared.units[1].text = "Unclosed quotation: «";
  await withReader(item, "current", async reader => {
    const scope = { kind: "current" } as const;
    await assert.rejects(reader.provisions.lookup({ ...target, scope, wholeSection: false }, signal()),
      /COMPLETE_PROVISION_SELECTION_REQUIRED/);
    const explicit = await reader.provisions.lookup({ ...target, scope, wholeDocument: true }, signal());
    assert.ok(explicit);
    assert.equal(explicit.locator.sourceStructure?.rangeKind, "document");
    const provision = await readOfficialProvision(explicit.locator, reader, scope, signal());
    assert.match(provision.text, /Unclosed quotation/);
    assert.match(provision.text, /Its complete exception/);
  });
});

test("whole-document reference navigation retains every originating passage", async () => {
  const item = source();
  item.prepared.relationships.push({ kind: "publisher_link", href: "#200", label: "Other rule", locator: "201" });
  await withReader(item, "current", async reader => {
    const receipt = await reader.provisions.lookup({ ...target, wholeDocument: true, scope: { kind: "current" } }, signal());
    assert.ok(receipt);
    const provision = await readOfficialProvision(receipt.locator, reader, { kind: "current" }, signal());
    const [link] = researchReferences([provision], new Set());
    assert.deepEqual(link.origins, [
      { position: "101", ordinal: 1, precedingHeadingPosition: "100" },
      { position: "201", ordinal: 3, precedingHeadingPosition: "200" },
    ]);
    assert.deepEqual(provision.operativeReferences![0].origins?.map(origin => origin.text), ["A complete rule.", "Its complete exception."]);
    assert.deepEqual(link.texts, ["Other rule"]);
  });
});

test("publisher contents navigate to complete sections only after selected-source boundary validation", async () => {
  const item = source();
  item.prepared.relationships = [
    { kind: "publisher_link", href: "#collapse100", label: "Chapter one", locator: "" },
    { kind: "publisher_link", href: "#collapse102", label: "Not a safe heading", locator: "" },
    { kind: "publisher_link", href: "#collapse300", label: "Heading without body", locator: "" },
  ];
  item.prepared.units = [
    { ordinal: 0, locator: "100", language: "en", text: "Chapter one", hierarchy: ["Chapter one"] },
    { ordinal: 1, locator: "101", language: "en", text: "Article 1. Rule", hierarchy: ["Chapter one"] },
    { ordinal: 2, locator: "102", language: "en", text: "Complete rule and exception.", hierarchy: ["Chapter one"] },
    { ordinal: 3, locator: "200", language: "en", text: "Chapter two", hierarchy: ["Chapter two"] },
    { ordinal: 4, locator: "201", language: "en", text: "Article 2. Procedure", hierarchy: ["Chapter two"] },
    { ordinal: 5, locator: "202", language: "en", text: "Complete procedure.", hierarchy: ["Chapter two"] },
    { ordinal: 6, locator: "300", language: "en", text: "Heading without body", hierarchy: ["Heading without body"] },
  ];
  const before = structuredClone(item);
  await withReader(item, "current", async reader => {
    const discovery = { search: async () => ({ candidates: ["hit"], sparseAvailable: true, denseAvailable: true }),
      readCandidate: async () => ({ work: "work", source: { inventory: item.inventory,
        prepared: { work: "work", publisher_contents: [
          { position: "100", title: "Chapter one" }, { position: "102", title: "Not a safe heading" },
          { position: "300", title: "Heading without body" }, { position: "200", title: "Wrong captured title" },
        ] } }, unitMetadata: item.prepared.units[1] }) };
    let fullDescriptions = 0;
    const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: reader,
      deferSourceNavigation: true, provisions: { ...reader.provisions, describeRange: async () => {
        fullDescriptions++; throw new Error("No full range enumeration needed");
      } } });
    const scope = { kind: "current" } as const, active = signal();
    await corpus.search("rule", scope, active);
    const [preview] = await corpus.describeCandidates(["hit"], scope, active);
    assert.equal(preview.readRange, undefined);
    assert.deepEqual(preview.publisherContents?.map(entry => entry.position), ["100", "102", "300", "200"]);
    assert.equal(fullDescriptions, 0);
    const locator = await corpus.resolve("hit", scope, active, "100");
    assert.ok(locator);
    const bytes = await corpus.get(locator.objectKey, active);
    assert.match(Buffer.from(bytes!).toString(), /Complete rule and exception/);
    assert.doesNotMatch(Buffer.from(bytes!).toString(), /Complete procedure/);
    await assert.rejects(corpus.resolve("hit", scope, active, "102"), /SECTION/);
    await assert.rejects(corpus.resolve("hit", scope, active, "300"), /PUBLISHER_SECTION_UNAVAILABLE/);
    await assert.rejects(corpus.resolve("hit", scope, active, "200"), /PUBLISHER_HEADING_UNAVAILABLE/);
    await assert.rejects(corpus.resolve("hit", scope, active, "999"), /No full range enumeration/);
    await assert.rejects(corpus.resolve("hit", { kind: "historical", at: "2020-01-01" }, active, "100"), /NOT_DISCOVERED/);
    assert.deepEqual(item, before);
  });
});

test("annex-aware section choices preserve exact v1 reads and offer the complete introductory section", async () => {
  const item = source(), parent = "Chapter A. General rules", intro = "Chapter 1. Scope", procedure = "Chapter 2. Procedure";
  item.prepared.units = [
    { ordinal: 0, locator: "root", language: "en", hierarchy: [parent], text: parent },
    { ordinal: 1, locator: "annex", language: "en", hierarchy: [parent], text: "ANNEX 2" },
    { ordinal: 2, locator: "title", language: "en", hierarchy: [parent], text: "Rules for distinct recipients" },
    { ordinal: 3, locator: "intro", language: "en", hierarchy: [parent, intro], text: intro },
    { ordinal: 4, locator: "scope", language: "en", hierarchy: [parent, intro], text: "Only the stated recipients qualify." },
    { ordinal: 5, locator: "procedure", language: "en", hierarchy: [parent, procedure], text: procedure },
    { ordinal: 6, locator: "101", language: "en", hierarchy: [parent, procedure], text: "The complete procedure." },
  ];
  await withReader(item, "current", async reader => {
    const request = { ...target, scope: { kind: "current" } as const };
    const range = await reader.provisions.describeRange!(request, signal());
    assert.deepEqual(range?.sourceSections?.map(section => section.position), ["intro", "procedure"]);
    for (const section of range!.sourceSections!) assert.match(section.title, /preceding annex context: ANNEX 2 \/ Rules for distinct recipients/);
    const receipt = await reader.provisions.lookup({ ...request, position: "procedure", wholeSection: true }, signal());
    assert.ok(receipt);
    assert.match(receipt.locator.objectKey, /^legal-evidence\/prepared-section-v1\//);
    assert.equal(Buffer.from(await reader.get(receipt.locator.objectKey, signal())).toString(),
      [item.prepared.title, procedure, "The complete procedure."].join("\n\n"));
    assert.equal(receipt.locator.sourceStructure?.annexContext?.[0].units[1].text, "Rules for distinct recipients");
    const scope = await reader.provisions.lookup({ ...request, position: "intro", wholeSection: true }, signal());
    assert.ok(scope);
    assert.match(Buffer.from(await reader.get(scope.locator.objectKey, signal())).toString(), /Only the stated recipients qualify\./);
  });
});

test("retained act titles preserve composed adjacent and reference reads with exact parent identity", async () => {
  const item = source();
  await withReader(item, "current", async reader => {
    const { createStoredCorpus } = await import("../lib/legal-answer-workflow/stored-corpus");
    const discovery = { search: async () => ({ candidates: ["hit"], sparseAvailable: true, denseAvailable: true }),
      readCandidate: async () => ({ work: "work", source: item, unitMetadata: item.prepared.units[1] }) };
    const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: reader, provisions: reader.provisions });
    const scope = { kind: "current" } as const;
    await corpus.search("rule", scope, signal());
    const parent = await corpus.resolve("hit", scope, signal());
    assert.ok(parent);
    const adjacent = await corpus.resolveAdjacent(parent.identity, "next", scope, signal());
    const reference = await corpus.resolveReference(parent.identity, "https://lex.uz/docs/123#200", scope, signal());
    assert.ok(adjacent && reference);
    assert.deepEqual(adjacent, reference);
    assert.equal(parent.sourceTitle, "Artificial act");
    assert.equal(adjacent.sourceTitle, "Artificial act");
    const bytes = await corpus.get(adjacent.objectKey, signal());
    assert.ok(bytes);
    assert.match(Buffer.from(bytes).toString(), /Its complete exception/);
    await assert.rejects(reader.provisions.adjacent!({ parent: { ...parent, sourceTitle: "Another act" },
      direction: "next", scope }, signal()), /ADJACENT_PARENT_UNAVAILABLE/);
  });
});

test("complete provision receipts expose applicability notices alongside the complete law", async () => {
  const item = source();
  const notice = "This artificial instrument ceased to apply on the recorded date.";
  const annotation = { kind: "publisher_status", text: "A separate transition may apply." };
  Object.assign(item.prepared, { header: [notice], notices: [annotation] });
  await withReader(item, "current", async reader => {
    const receipt = await reader.provisions.lookup({ ...target, scope: { kind: "current" } }, signal());
    assert.deepEqual(receipt?.locator.sourceNotes, [notice, JSON.stringify(annotation)]);
    const bytes = await reader.get(receipt!.locator.objectKey, signal());
    assert.ok(bytes);
    assert.match(Buffer.from(bytes).toString(), /A complete rule/);
    assert.equal(Buffer.from(bytes).toString().includes(notice), true);
  });
});

test("section navigation excludes isolated headings whose stored paths do not include their children", async () => {
  const item = source();
  item.prepared.units = [
    { ordinal: 0, locator: "chapter", language: "en", hierarchy: ["Chapter A"], text: "Chapter A" },
    { ordinal: 1, locator: "section", language: "en", hierarchy: ["Section A"], text: "Section A" },
    { ordinal: 2, locator: "100", language: "en", hierarchy: ["Section A"], text: "Article 1. Rule" },
    { ordinal: 3, locator: "101", language: "en", hierarchy: ["Section A"], text: "A complete rule." },
  ];
  await withReader(item, "current", async reader => {
    const range = await reader.provisions.describeRange!({ ...target, scope: { kind: "current" } }, signal());
    assert.deepEqual(range?.sourceSections?.map(section => section.position), ["section"]);
    const receipt = await reader.provisions.lookup({ ...target, position: "section", wholeSection: true,
      scope: { kind: "current" } }, signal());
    assert.match(Buffer.from(await reader.get(receipt!.locator.objectKey, signal())).toString(), /A complete rule/);
  });
});

test("historical selection resolves the same act at the requested capture outside search hits", async () => {
  for (const status of ["unique", "missing", "ambiguous", "fallback", "mismatched"] as const) {
    const older = source("01.01.2020"), dated = source(status === "fallback" || status === "mismatched" ? "15.06.2021 12" : "15.06.2021");
    dated.inventory.id = "dated"; dated.prepared.work = "dated";
    dated.prepared.selected_edition = ["01.06.2021"];
    dated.prepared.units[1].text = "The dated complete rule.";
    const scope = { kind: "historical" as const, at: "2021-06-15" };
    const referenceUrls: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      response.setHeader("x-juro-worker-sha256", hash); response.setHeader("content-type", "application/json");
      if (body.reference) { assert.deepEqual(body.reference.scope, scope); referenceUrls.push(body.reference.url); }
      const referenceStatus = status === "fallback" ? (body.reference?.url.includes("ONDATE") ? "missing" : "unique")
        : status === "mismatched" ? "unique" : status;
      response.end(JSON.stringify({ package_sha256: hash, work_index_sha256: hash,
        ...(body.reference ? { reference_status: referenceStatus } : {}),
        sources: body.reference ? referenceStatus === "unique" ? { dated } : {} : { work: older } }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const reader = createPreparedStoredReader({ release: release("history"), worker: {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, workerSha256: hash, token } });
      const read = reader.provisions.lookup({ ...target, scope }, signal());
      if (status !== "unique" && status !== "fallback") {
        await assert.rejects(read, status === "mismatched" ? /REFERENCE_SOURCE_MISMATCH/ : /PREPARED_TEMPORAL_UNAVAILABLE/);
        assert.deepEqual(referenceUrls, status === "missing"
          ? ["https://lex.uz/docs/123?ONDATE=15.06.2021", "https://lex.uz/docs/123"]
          : ["https://lex.uz/docs/123?ONDATE=15.06.2021"]);
        continue;
      }
      const found = await read; assert.ok(found);
      assert.deepEqual(referenceUrls, status === "fallback"
        ? ["https://lex.uz/docs/123?ONDATE=15.06.2021", "https://lex.uz/docs/123"]
        : ["https://lex.uz/docs/123?ONDATE=15.06.2021"]);
      assert.equal(found.locator.applicableAt, scope.at);
      assert.match(found.locator.snapshot, /:dated$/);
      assert.match(Buffer.from(await reader.get(found.locator.objectKey, signal())).toString(), /dated complete rule/);
      assert.equal(found.locator.editionObservation?.selectedEdition, "01.06.2021");
      await assert.rejects(reader.provisions.lookup({ ...target, position: "absent", scope }, signal()));
      await assert.rejects(reader.provisions.lookup({ ...target, language: "ru", scope }, signal()));
      const prior = await reader.provisions.lookup({ ...target, scope: { kind: "historical", at: "2020-01-01" } }, signal());
      assert.ok(prior); assert.notEqual(prior.locator.identity, found.locator.identity);
      assert.match(prior.locator.snapshot, /:work$/);
    } finally {
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});

test("literal source lookup exposes every matching position and preserves complete reads", async () => {
  const item = source();
  item.prepared.units[1].text = "Written notice is required.";
  item.prepared.units[3].text = "Written notice is waived only by consent.";
  await withReader(item, "current", async reader => {
    const scope = { kind: "current" } as const;
    const matches = await reader.provisions.findInSource!({ work: "work", language: "en", scope, contains: "WRITTEN NOTICE" }, signal());
    assert.deepEqual(matches.map(match => match.position), ["101", "201"]);
    for (const match of matches) {
      const found = await reader.provisions.lookup({ work: "work", language: "en", scope, position: match.position }, signal());
      assert.ok(found);
      const text = Buffer.from(await reader.get(found.locator.objectKey, signal())).toString();
      assert.match(text, /Article [12]\./);
      assert.ok(text.includes(match.text));
    }
    assert.deepEqual(await reader.provisions.findInSource!({ work: "work", language: "en", scope, contains: "Absent phrase" }, signal()), []);
  });
});

test("a discovered article offers an explicit complete-section read without expanding its default read", async () => {
  const item = source();
  item.prepared.units = ["Chapter A", "Article 1. Rule", "A complete rule.", "Article 2. Exception",
    "Its complete exception.", "Chapter B", "Article 3. Unrelated", "Unrelated text."].map((text, ordinal) => ({
    ordinal, locator: String(ordinal), language: "en", text, hierarchy: [ordinal < 5 ? "Chapter A" : "Chapter B"],
  }));
  await withReader(item, "current", async reader => {
    const { createStoredCorpus } = await import("../lib/legal-answer-workflow/stored-corpus");
    const discovery = { search: async () => ({ candidates: ["hit"], sparseAvailable: true, denseAvailable: true }),
      readCandidate: async () => ({ work: "work", source: item, unitMetadata: item.prepared.units[2] }) };
    const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: reader, provisions: reader.provisions });
    const scope = { kind: "current" } as const;
    await corpus.search("rule", scope, signal());
    const [candidate] = await corpus.describeCandidates(["hit"], scope, signal());
    assert.deepEqual(candidate.readRange?.sections?.map(({ position, title }) => ({ position, title })),
      [{ position: "0", title: "Chapter A" }]);
    const article = await corpus.resolve("hit", scope, signal());
    assert.ok(article);
    assert.doesNotMatch(Buffer.from(await reader.get(article.objectKey, signal())).toString(), /complete exception/);
    assert.deepEqual(candidate.readRange?.sourceSections?.map(section => section.title), ["Chapter A", "Chapter B"]);
    const otherSection = await corpus.resolve("hit", scope, signal(), "5");
    assert.ok(otherSection);
    assert.match(Buffer.from(await reader.get(otherSection.objectKey, signal())).toString(), /Unrelated text/);
    await assert.rejects(corpus.resolve("hit", scope, signal(), "7"), /CANDIDATE_SECTION_INVALID/);
    const section = await corpus.resolve("hit", scope, signal(), "0");
    assert.ok(section);
    const text = Buffer.from(await reader.get(section.objectKey, signal())).toString();
    assert.match(text, /A complete rule/);
    assert.match(text, /Its complete exception/);
    assert.doesNotMatch(text, /Unrelated/);
    assert.equal(corpus.receipt(section.identity)?.sectionTitle, "Chapter A");
  });
});

test("section expansion offers the nearest complete section rather than every encompassing part", async () => {
  const item = source();
  item.prepared.units = [
    { text: "Part One", hierarchy: ["Part One"] },
    { text: "Chapter A", hierarchy: ["Part One", "Chapter A"] },
    { text: "Article 1. Rule", hierarchy: ["Part One", "Chapter A"] },
    { text: "Complete rule.", hierarchy: ["Part One", "Chapter A"] },
    { text: "Chapter B", hierarchy: ["Part One", "Chapter B"] },
    { text: "Article 2. Other subject", hierarchy: ["Part One", "Chapter B"] },
    { text: "Unrelated rule.", hierarchy: ["Part One", "Chapter B"] },
  ].map((unit, ordinal) => ({ ...unit, ordinal, locator: String(ordinal), language: "en" }));
  await withReader(item, "current", async reader => {
    const range = await reader.provisions.describeRange!({ work: "work", position: "3", language: "en", scope: { kind: "current" } }, signal());
    assert.deepEqual(range.sections?.map(section => section.title), ["Part One > Chapter A"]);
  });
});

test("section navigation distinguishes repeated headings by their stored parent path", async () => {
  const item = source();
  item.prepared.units = [
    { text: "Chapter A", hierarchy: ["Chapter A"] },
    { text: "General rules", hierarchy: ["Chapter A", "General rules"] },
    { text: "Article 1. First rule", hierarchy: ["Chapter A", "General rules"] },
    { text: "Complete first rule.", hierarchy: ["Chapter A", "General rules"] },
    { text: "Chapter B", hierarchy: ["Chapter B"] },
    { text: "General rules", hierarchy: ["Chapter B", "General rules"] },
    { text: "Article 2. Second rule", hierarchy: ["Chapter B", "General rules"] },
    { text: "Complete second rule.", hierarchy: ["Chapter B", "General rules"] },
  ].map((unit, ordinal) => ({ ...unit, ordinal, locator: String(ordinal), language: "en" }));
  await withReader(item, "current", async reader => {
    const range = await reader.provisions.describeRange!({ work: "work", position: "3", language: "en", scope: { kind: "current" } }, signal());
    assert.deepEqual(range.sections?.map(section => [section.position, section.title]), [["1", "Chapter A > General rules"]]);
    assert.deepEqual(range.sourceSections?.map(section => [section.position, section.title]),
      [["1", "Chapter A > General rules"], ["5", "Chapter B > General rules"]]);
  });
});

test("discovery ranges use complete stored units even when the search catalog omits units", async () => {
  const base = source();
  const item = { ...base, prepared: { ...base.prepared,
    header: ["Artificial status: replaced"], notices: ["Not applicable after the recorded repeal date"] } };
  await withReader(item, "current", async reader => {
    const { createStoredCorpus } = await import("../lib/legal-answer-workflow/stored-corpus");
    const { researchCandidates } = await import("../lib/legal-answer-workflow/research-context");
    const { discoverReadCandidates } = await import("../lib/legal-answer-workflow/candidate-selection");
    const { units, ...projection } = item.prepared;
    const discovery = { search: async () => ({ candidates: ["100", "101", "200"], sparseAvailable: true, denseAvailable: true }),
      readCandidate: async (identity: string) => ({ work: "work",
        source: { inventory: item.inventory, prepared: projection }, unitMetadata: units.find(unit => unit.locator === identity)! }) };
    const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: reader, provisions: reader.provisions });
    const failures: { candidate: string; scope: { kind: "current" }; code: string }[] = [];
    const candidates = await discoverReadCandidates({ interpretation: { queries: ["rule"], scopes: [{ kind: "current" }] },
      corpus, signal: signal(), searches: new Set(), failures, limits: [] });
    assert.deepEqual(failures, []);
    assert.equal(candidates.length, 3);
    const groups = researchCandidates(candidates);
    assert.deepEqual(groups[0].readRange?.sourceNotes,
      ["Artificial status: replaced", "Not applicable after the recorded repeal date"]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].matches.length, 2);
    assert.equal(groups[0].readRange?.kind, "provision");
    assert.equal(groups[1].readRange?.kind, "provision");
    assert.notEqual(groups[0].readRange?.key, groups[1].readRange?.key);
    const receipt = await reader.provisions.lookup({ ...target, scope: { kind: "current" } }, signal());
    assert.equal(receipt?.articleTitle, "Article 1. Rule");
    assert.equal("units" in projection, false);
  });
});

test("authenticated references resolve an undiscovered stored document in the parent's temporal scope", async () => {
  for (const wholeDocument of [false, true]) for (const historical of [false, true]) {
    const scope = historical ? { kind: "historical" as const, at: "2020-01-01" } : { kind: "current" as const };
    const parent = source(historical ? "01.01.2020" : null), child = source(historical ? "01.01.2020" : null);
    const referenceUrl = "https://lex.uz/docs/999" + (wholeDocument ? "" : "#200");
    parent.prepared.relationships[0].href = referenceUrl;
    child.inventory.id = "other"; child.inventory.context.source = "999";
    child.inventory.url = child.inventory.url.replace("/123", "/999");
    child.prepared.work = "other"; child.prepared.source = "999";
    for (const unit of child.prepared.units) unit.language = "uz-Cyrl";
    child.prepared.units.at(-1)!.language = "en";
    Object.assign(child.prepared, { tables: [{ locator: "101", rows: [[{ text: "Complete table condition", colspan: 2 }]] }] });
    const rejectedDefault = source();
    rejectedDefault.inventory.id = "default"; rejectedDefault.inventory.context.source = "999";
    rejectedDefault.inventory.url = "https://lex.uz/docs/999";
    rejectedDefault.prepared.work = "default"; rejectedDefault.prepared.source = "999";
    let calls = 0;
    const server = createServer(async (request, response) => {
      calls++;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(request.url, "/read-sources");
      assert.deepEqual(body.artifacts, artifacts);
      response.setHeader("x-juro-worker-sha256", hash); response.setHeader("content-type", "application/json");
      if (body.reference) {
        assert.deepEqual(body.reference.scope, scope);
        assert.ok(["https://lex.uz/docs/999", ...(historical ? ["https://lex.uz/docs/999?ONDATE=01.01.2020"] : [])].includes(body.reference.url));
        response.end(JSON.stringify({ package_sha256: hash, work_index_sha256: hash,
          reference_status: "unique", sources: { other: child } }));
      } else {
        assert.ok(body.works.length === 1 && ["work", "default"].includes(body.works[0]));
        response.end(JSON.stringify({ package_sha256: hash, work_index_sha256: hash,
          sources: body.works[0] === "default" ? { default: rejectedDefault } : { work: parent } }));
      }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const worker = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, workerSha256: hash, token };
      const reader = createPreparedStoredReader({ release: release(historical ? "history" : "current"), worker });
      if (historical) await assert.rejects(reader.provisions.lookup({ ...target, work: "default", scope }, signal()), /CORPUS_SOURCE_IDENTITY/);
      const first = await reader.provisions.lookup({ ...target, scope }, signal()); assert.ok(first);
      const request = { parent: first.locator, url: referenceUrl, scope };
      if (wholeDocument) {
        await assert.rejects(reader.provisions.reference(request, signal()), /COMPLETE_PROVISION_SELECTION_REQUIRED/);
        // The same authenticated source remains available through an explicit
        // document selection, rather than an act-level link's implicit expansion.
        const explicit = await reader.provisions.lookup({ work: "other", position: "100", language: "uz-Cyrl", scope, wholeDocument: true }, signal());
        assert.ok(explicit);
        const text = Buffer.from(await reader.get(explicit.locator.objectKey, signal())).toString();
        for (const unit of child.prepared.units) assert.ok(text.includes(unit.text));
        assert.ok(text.includes("Complete table condition [row span 1; column span 2]"));
      } else {
        const found = await reader.provisions.reference(request, signal());
        assert.equal(found?.articleTitle, "Article 2. Other rule");
        assert.equal(found?.locator.sourceStructure?.rangeKind, "article");
        assert.equal(found?.language, "uz-Cyrl", "preserve the target language, not the parent's language");
        assert.equal(found?.locator.applicableAt, historical ? "2020-01-01" : undefined);
        assert.match(Buffer.from(await reader.get(found!.locator.objectKey, signal())).toString(), /Its complete exception/);
        assert.deepEqual(await reader.provisions.reference(request, signal()), found);
      }
      assert.equal(calls, historical ? 3 : 2, "rejected default metadata cannot block the dated reference; successful reads remain cached");
    } finally {
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});

test("reference discovery cannot substitute a document, edition or generation and keeps missing targets unavailable", async () => {
  for (const fragment of ["", "#200"]) for (const variant of ["missing", "ambiguous", "document", "edition", "generation"] as const) {
    const parent = source(), child = source(variant === "edition" ? "01.01.2020" : null);
    parent.prepared.relationships[0].href = "https://lex.uz/docs/999" + fragment;
    const id = variant === "document" ? "888" : "999";
    child.inventory.id = "other"; child.inventory.context.source = id;
    child.inventory.url = child.inventory.url.replace("/123", `/${id}`);
    child.prepared.work = "other"; child.prepared.source = id;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      response.setHeader("x-juro-worker-sha256", hash); response.setHeader("content-type", "application/json");
      const absent = variant === "missing" || variant === "ambiguous";
      response.end(JSON.stringify({ package_sha256: body.reference && variant === "generation" ? "f".repeat(64) : hash,
        work_index_sha256: hash, ...(body.reference ? { reference_status: absent ? variant : "unique" } : {}),
        sources: body.reference ? absent ? {} : { other: child } : { work: parent } }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const reader = createPreparedStoredReader({ release: release("current"), worker: {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, workerSha256: hash, token } });
      const scope = { kind: "current" as const }, first = await reader.provisions.lookup({ ...target, scope }, signal());
      assert.ok(first);
      const result = reader.provisions.reference({ parent: first.locator, url: "https://lex.uz/docs/999" + fragment, scope }, signal());
      if (variant === "missing" || variant === "ambiguous") assert.equal(await result, null);
      else await assert.rejects(result, variant === "document" ? /REFERENCE_SOURCE_MISMATCH/
        : variant === "edition" ? fragment ? /PREPARED_TEMPORAL_UNAVAILABLE/ : /COMPLETE_PROVISION_SELECTION_REQUIRED/ : /SOURCE_CATALOG_MISMATCH/);
    } finally {
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});

test("prepared corpus reads do not re-certify legacy capture status", async () => {
  for (const status of ["conflict", "unavailable"]) {
    const item = { ...source(), current_capture: status };
    await withReader(item, "current", async reader => {
      const receipt = await reader.provisions.lookup({ ...target, scope: { kind: "current" } }, signal());
      assert.ok(receipt);
      assert.match(Buffer.from(await reader.get(receipt.locator.objectKey, signal())).toString(), /A complete rule/);
    });
  }
});

test("a saved provision reopens from its retained generation when active answer configuration is absent", async () => {
  await withReader(source(), "current", async (reader, worker) => {
    const receipt = await reader.provisions.lookup({ ...target, scope: { kind: "current" } }, signal());
    assert.ok(receipt);
    const expected = await reader.get(receipt.locator.objectKey, signal());
    const routing = resolveSavedSourceRoute(Buffer.from(JSON.stringify({ currentRelease: release("current") })), hash, {
      LEGAL_ANSWER_RETAINED_SOURCES: JSON.stringify([{ packageSha256: hash, workIndexSha256: hash,
        url: worker.url, workerSha256: hash, tokenEnvironment: "SAVED_TOKEN" }]), SAVED_TOKEN: token,
    });
    assert.deepEqual(await createPreparedStoredReader(routing).get(receipt.locator.objectKey, signal()), expected);
  });
});

test("a current search release cannot authorize a historical lookup", async () => {
  await withReader(source("01.01.2020"), "current", async reader => {
    await assert.rejects(reader.provisions.lookup({ ...target, scope: { kind: "historical", at: "2020-01-01" } }, signal()), /CORPUS_SCOPE_MISMATCH/);
  });
});

test("stored historical evidence keeps its requested legal date and captured observation", async () => {
  await withReader(source("01.01.2020"), "history", async reader => {
    const receipt = await reader.provisions.lookup({ ...target, scope: { kind: "historical", at: "2020-01-01" } }, signal());
    assert.equal(receipt?.locator.applicableAt, "2020-01-01");
    assert.equal(receipt?.locator.temporalState, "historical_only");
    assert.equal(receipt?.locator.editionObservation?.observedAt, "2020-01-01T00:00:00.000Z");
    await assert.rejects(reader.provisions.lookup({ ...target, scope: { kind: "historical", at: "2019-01-01" } }, signal()), /PREPARED_TEMPORAL_UNAVAILABLE/);
  });
});

test("undated prepared current captures remain readable with an unknown edition selector", async () => {
  const item = source(); item.prepared.selected_edition = [];
  await withReader(item, "current", async reader => {
    const receipt = await reader.provisions.lookup({ ...target, scope: { kind: "current" } }, signal());
    assert.ok(receipt);
    assert.equal(receipt.locator.editionObservation?.selectedEdition, null);
    assert.equal(receipt.locator.editionObservation?.observedAt, "2020-01-01T00:00:00.000Z");
    assert.equal(receipt.locator.applicableAt, undefined);
    const provision = await readOfficialProvision(receipt.locator, reader, { kind: "current" }, signal());
    assert.equal(provision.editionObservation?.selectedEdition, null);
    assert.match(provision.text, /A complete rule/);
  });
});

test("absent historical selectors and ambiguous current selectors remain unavailable", async () => {
  const historical = source("01.01.2020"); historical.prepared.selected_edition = [];
  await withReader(historical, "history", async reader => {
    await assert.rejects(reader.provisions.lookup({ ...target, scope: { kind: "historical", at: "2020-01-01" } }, signal()), /PREPARED_TEMPORAL_UNAVAILABLE/);
  });
  await withReader(historical, "current", async reader => {
    await assert.rejects(reader.provisions.lookup({ ...target, scope: { kind: "current" } }, signal()), /PREPARED_TEMPORAL_UNAVAILABLE/);
  });
  const current = source(); current.prepared.selected_edition = ["01.01.2020", "01.01.2021"];
  await withReader(current, "current", async reader => {
    await assert.rejects(reader.provisions.lookup({ ...target, scope: { kind: "current" } }, signal()), /PREPARED_TEMPORAL_UNAVAILABLE/);
  });
});

test("authenticated exact references read complete stored sibling provisions", async () => {
  await withReader(source(), "current", async reader => {
    const first = await reader.provisions.lookup({ ...target, scope: { kind: "current" } }, signal());
    assert.ok(first);
    const sameRange = await reader.provisions.lookup({ ...target, position: "100", scope: { kind: "current" } }, signal());
    assert.deepEqual(sameRange, first);
    const second = await reader.provisions.reference({ parent: first.locator, url: "https://lex.uz/docs/123#200", scope: { kind: "current" } }, signal());
    assert.equal(second?.articleTitle, "Article 2. Other rule");
    assert.match(Buffer.from(await reader.get(second!.locator.objectKey, signal())).toString(), /Its complete exception/);
    await assert.rejects(reader.provisions.reference({ parent: first.locator, url: "https://lex.uz/docs/999#200", scope: { kind: "current" } }, signal()), /REFERENCE_NOT_AUTHENTICATED/);
  });
});

test("an unavailable candidate cannot poison references into a successfully loaded source", async () => {
  await withReader(source(), "current", async reader => {
    await assert.rejects(reader.provisions.lookup({ ...target, work: "unavailable", scope: { kind: "current" } }, signal()));
    const first = await reader.provisions.lookup({ ...target, scope: { kind: "current" } }, signal());
    assert.ok(first);
    const second = await reader.provisions.reference({ parent: first.locator, url: "https://lex.uz/docs/123#200", scope: { kind: "current" } }, signal());
    assert.equal(second?.articleTitle, "Article 2. Other rule");
  });
});

test("chapter references require explicit section selection and preserve the section citation label", async () => {
  const item = source();
  item.prepared.units[2] = { ...item.prepared.units[2], text: "Chapter A", hierarchy: ["Chapter A"] };
  item.prepared.units[3].hierarchy = ["Chapter A"];
  await withReader(item, "current", async reader => {
    const parent = await reader.provisions.lookup({ ...target, scope: { kind: "current" } }, signal());
    assert.ok(parent);
    await assert.rejects(reader.provisions.reference({ parent: parent.locator,
      url: "https://lex.uz/docs/123#200", scope: { kind: "current" } }, signal()), /COMPLETE_PROVISION_SELECTION_REQUIRED/);
    const section = await reader.provisions.lookup({ work: "work", position: "200", language: "en",
      scope: { kind: "current" }, wholeSection: true }, signal());
    assert.ok(section);
    assert.equal(section.sectionTitle, "Chapter A");
    assert.equal(section.articleTitle, null);
    const text = Buffer.from(await reader.get(section.locator.objectKey, signal())).toString();
    assert.match(text, /Its complete exception/);
    assert.ok(!text.includes("Article 1"));
    const [citation] = buildCorpusCitations([{ ...section.locator, text }], { receipt: () => section },
      { generationSha256: hash, namespace: `legal-prepared-${hash}` });
    assert.equal(citation.source.article, "Chapter A");
    assert.equal(citation.receipt.articleNumber, null);
    assert.match(citation.receipt.r2Key, /prepared-section-v1/);
  });
});

test("adjacent complete provisions retain their parent's captured historical edition and separate citations", async () => {
  const scope = { kind: "historical" as const, at: "2020-01-01" };
  await withReader(source("01.01.2020"), "history", async reader => {
    const parent = await reader.provisions.lookup({ ...target, scope }, signal());
    assert.ok(parent);
    const next = await reader.provisions.adjacent!({ parent: parent.locator, direction: "next", scope }, signal());
    assert.equal(next?.articleTitle, "Article 2. Other rule");
    assert.notEqual(next?.locator.identity, parent.locator.identity);
    assert.equal(next?.locator.applicableAt, "2020-01-01");
    assert.equal(next?.locator.sourceUrl, "https://lex.uz/docs/123?ONDATE=01.01.2020#200");
    assert.match(Buffer.from(await reader.get(next!.locator.objectKey, signal())).toString(), /Its complete exception/);
    const previous = await reader.provisions.adjacent!({ parent: next!.locator, direction: "previous", scope }, signal());
    assert.equal(previous?.locator.identity, parent.locator.identity);
    assert.equal(await reader.provisions.adjacent!({ parent: next!.locator, direction: "next", scope }, signal()), null);
    await assert.rejects(reader.provisions.adjacent!({ parent: { ...parent.locator, identity: "unread" }, direction: "next", scope }, signal()), /ADJACENT_PARENT_UNAVAILABLE/);
  });
});

for (const capability of ["current", "history"] as const) test(`opening article reads preserve ${capability} parent custody and canonical citations`, async () => {
  const item = source(capability === "history" ? "01.01.2020" : null);
  for (const unit of item.prepared.units) { unit.ordinal++; unit.hierarchy = ["Chapter 1. Artificial rules"]; }
  item.prepared.units.unshift({ ordinal: 0, locator: "chapter", language: "en", hierarchy: ["Chapter 1. Artificial rules"], text: "Chapter 1. Artificial rules" });
  await withReader(item, capability, async reader => {
    const scope = capability === "current" ? { kind: "current" } as const : { kind: "historical", at: "2020-01-01" } as const;
    const parent = await reader.provisions.lookup({ work: "work", position: "201", language: "en", scope }, signal());
    assert.ok(parent);
    const first = await reader.provisions.introductory!({ parent: parent.locator, scope }, signal());
    assert.ok(first);
    assert.equal(first.articleTitle, "Article 1. Rule");
    assert.deepEqual(first.locator.editionObservation, parent.locator.editionObservation);
    assert.equal(first.locator.applicableAt, parent.locator.applicableAt);
    const exact = await reader.provisions.lookup({ work: "work", position: "100", language: "en", scope }, signal());
    assert.deepEqual(first, exact);
    const { createStoredCorpus } = await import("../lib/legal-answer-workflow/stored-corpus");
    const discovery = { search: async () => ({ candidates: ["hit"], sparseAvailable: true, denseAvailable: true }),
      readCandidate: async () => ({ work: "work", source: item, unitMetadata: item.prepared.units.at(-1)! }) };
    const corpus = createStoredCorpus({ current: discovery, history: discovery, objects: reader, provisions: reader.provisions });
    await corpus.search("procedure", scope, signal());
    const resolved = await corpus.resolve("hit", scope, signal());
    assert.ok(resolved);
    assert.deepEqual(await corpus.resolveIntroductory(resolved.identity, scope, signal()), first.locator);
    assert.deepEqual(await corpus.resolveIntroductory(resolved.identity, scope, signal()), first.locator);

    assert.equal(await reader.provisions.introductory!({ parent: first.locator, scope }, signal()), null);
    await assert.rejects(reader.provisions.introductory!({ parent: { ...parent.locator, sourceTitle: "Other" }, scope }, signal()), /INTRODUCTORY_PARENT_UNAVAILABLE/);
  });
});
