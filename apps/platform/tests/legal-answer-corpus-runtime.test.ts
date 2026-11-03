import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createCorpusRuntime } from "../lib/legal-answer-workflow/corpus-runtime";
import { readOfficialProvision } from "../lib/legal-answer-workflow/evidence";
import { createAnswerExecution } from "../lib/legal-answer-workflow/execution";
import { executeSignedInAnswer } from "../lib/legal-answer-workflow/signed-request";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { ProviderReceiptJournal } from "../lib/legal-answer-workflow/receipt-journal";
import { createPreparedStoredReader } from "../lib/legal-answer-workflow/prepared-stored-reader";
import { savedCitationDetails } from "../lib/legal-answer-workflow/citation-details";
import { legalChatResponseSchema } from "../lib/ai/legal-chat-schema";

test("runtime loads complete stored provisions and persists citations without publisher access or source writes", async () => {
  const hash = "a".repeat(64), workerHash = "b".repeat(64), token = "t".repeat(40);
  const artifacts = { packageSha256: hash, vectorCompletionSha256: hash, vectorIdentitySha256: hash,
    membershipSha256: hash, workIndexSha256: hash, navigationSha256: hash, sparseSha256: hash };
  const release = (capability: "current" | "history") => ({ id: `fixture-${capability}`, capability, environment: "staging",
    instances: [{ id: "fixture-instance", shardId: "fixture-shard" }],
    configuration: { backend: "prepared-corpus-v1", navigationBackend: "pgvector", identity: "fixture-config",
      embeddingModel: "openai/text-embedding-3-large", dimensions: 3072, artifacts,
      evidenceSemantics: "discovery-only", categoryRanking: { mode: "disabled" },
      gatewayIdentity: "fixture-gateway", providerProjectIdentity: "fixture-project",
      gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false } });
  const unit = { ordinal: 1, locator: "11", language: "en", text: "Discovery preview only.", hierarchy: [] };
  const sources = { work: { current_capture: "unique", inventory: { id: "work", kind: "document", state: "done", url: "https://lex.uz/docs/123",
    raw_hash: hash, context: { source: "123" }, receipt: { sha256: hash, status: 200, observed: 1577836800 } },
    prepared: { work: "work", source: "123", title: "Artificial Act", gaps: [], tables: [], relationships: [],
      requested_edition: null, selected_edition: ["01.01.2020"], units: [
        { ...unit, ordinal: 0, locator: "10", text: "Article 1. Rule" },
        { ...unit, text: "Authenticated complete rule." },
        { ...unit, ordinal: 2, locator: "12", text: "Exception for private events." },
      ] } } };
  const paths: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    paths.push(request.url!);
    response.setHeader("x-juro-worker-sha256", workerHash);
    response.setHeader("content-type", "application/json");
    if (request.url === "/search") response.end(JSON.stringify({ version: body.version, releaseId: body.releaseId,
      environment: body.environment, configuration: body.configuration, requestSha256: body.requestSha256,
      lanes: { dense: "complete", sparse: "complete" }, hits: [{ vectorOrdinal: 7, membershipOrdinal: 9,
        vectorRank: 1, vectorScore: 0.5, keywordRank: 1, keywordScore: 0.5, fusionScore: 0.5 }] }));
    else if (request.url === "/read-exact") response.end(JSON.stringify({ package_sha256: hash,
      membership_sha256: hash, work_index_sha256: hash, vector_completion_sha256: hash,
      sources, units: { "work:1": unit }, records: [{ vector_ordinal: 7, membership_ordinal: 9, work: "work", unit: "work:1", status: "discovery_only" }] }));
    else if (request.url === "/read-sources") response.end(JSON.stringify({ package_sha256: hash, work_index_sha256: hash, sources }));
    else response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const worker = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token, workerSha256: workerHash };
    const objects = new Map<string, Uint8Array>();
    const configuration: Parameters<typeof createCorpusRuntime>[0] = { current: { release: release("current"), worker },
      history: { release: release("history"), worker }, generationSha256: hash,
      submittedAt: Date.now(), deadlineMs: 30_000,
      embed: async () => Array.from({ length: 3072 }, () => 0.01),
      store: { namespace: `legal-prepared-${hash}`,
        get: async key => { const bytes = objects.get(key); return bytes ? { key, size: bytes.length, bytes: async () => new Uint8Array(bytes) } : null; },
        put: async () => { throw new Error("SOURCE_WRITES_FORBIDDEN"); } },
    };
    const runtime = createCorpusRuntime(configuration);
    const scope = { kind: "current" as const }, signal = AbortSignal.timeout(3000);
    const hits = await runtime.corpus.search("artificial rule", scope, signal);
    const locator = await runtime.corpus.resolve(hits.candidates[0], scope, signal);
    assert.ok(locator);
    const evidence = await readOfficialProvision(locator, runtime.corpus, scope, signal);
    assert.match(evidence.text, /Exception for private events/);
    assert.doesNotMatch(evidence.text, /Discovery preview/);
    assert.deepEqual(paths, ["/search", "/read-exact", "/read-sources"]);
    assert.equal(objects.size, 0);
    assert.equal(runtime.citations([evidence])[0].receipt.r2Key, locator.objectKey);
    const fixture = await legalAnswerStorageFixture();
    const journal = new ProviderReceiptJournal(":memory:");
    try {
      const categories: string[] = [], attributedRuns = new Set<string>();
      let generationCalls = 0, embeddingCalls = 0;
      const delivered = await executeSignedInAnswer({ db: fixture.d1, workspaceId: "w", userId: "u",
        conversationId: null, question: "Explain the artificial rule and its exception", language: "en", format: "detailed",
        mode: "deep", documentIds: [], idempotencyKey: "composed-runtime", submittedAt: Date.now(), deadlineMs: 30_000,
        signal: new AbortController().signal }, {
        model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28", sourceVersionHash: hash,
        privateObjects: { get: async () => null },
        createExecution: async ({ request, runId, model }) => createAnswerExecution({ request, runId, model,
          apiKey: "fixture", corpus: configuration, embeddingInputRate: 130_000,
          ledger: { reserve: value => { categories.push(value.category); return `reservation-${categories.length}`; },
            dispatch: () => {}, cancel: () => {}, settle: () => {} },
          receipt: async record => { journal.append(record); attributedRuns.add(record.runId); },
          fetchEmbedding: async () => { embeddingCalls++; return Response.json({ model: "text-embedding-3-large",
            usage: { prompt_tokens: 10, total_tokens: 10 },
            data: [{ object: "embedding", index: 0, embedding: Array.from({ length: 3072 }, () => 0.01) }] }); },
          generation: { purpose: "qualification", phase: "final", rates: { input: 100_000, cachedInput: 10_000, output: 500_000,
            longContext: { input: 200_000, cachedInput: 20_000, output: 750_000 } },
            fetchImpl: async (_url, init) => {
              if (String(_url).endsWith("/input_tokens")) return Response.json({ input_tokens: 100 });
              generationCalls++;
              const body = JSON.parse(String(init?.body));
              const envelope = JSON.parse(body.input.at(-1).output ?? body.input[0].content);
              const packet = envelope.packet ?? envelope;
              const sourceIds = packet.evidence?.map((item: { identity: string }) => item.identity);
              const requirementId = packet.interpretation?.requirements[0].id;
              if (body.text.format.name === "legal_write") assert.equal(requirementId, "question");
              const content = body.text.format.name === "legal_interpret" ? { conversationReply: null,
                interpretation: { needsClarification: false, complexity: "difficult",
                queries: { en: "artificial rule", ru: "искусственное правило", "uz-Latn": "suniy qoida" },
                scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [],
              } } : !sourceIds.length ? { decision: "research", content: null,
                gaps: [{ requirementId, description: "Read the complete artificial rule." }],
                actions: packet.unreadCandidates.map((item: { id: string }) => ({ requirementId, candidateId: item.id })) }
                : { decision: "answer", gaps: [], actions: [], content: { summary: "The rule applies except to private events.", summarySourceIds: sourceIds,
                issues: [{ title: "Rule", explanation: [{ statement: "The rule applies except to private events.", sourceIds }], requirementIds: [requirementId], actions: [] }],
                conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [],
                clarificationQuestions: [], urgency: "normal" } };
              if (body.text.format.name === "legal_write") assert.ok(body.text.format.schema.properties.turn);
              const wireContent = body.text.format.name === "legal_write" ? { turn: content } : content;
              const output = "interpretation" in content ? [{ type: "function_call", call_id: `call-${generationCalls}`,
                name: "search_law", arguments: JSON.stringify(content.interpretation) }]
                : content.decision === "research" ? [{ type: "function_call", call_id: `call-${generationCalls}`,
                  name: "research_law", arguments: JSON.stringify({ actions: content.actions, coverageUpdates: [] }) }]
                  : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(wireContent) }] }];
              return Response.json({ id: `resp-${generationCalls}`, model: "gpt-6-luna", service_tier: "default", status: "completed",
                usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50 },
                output });
            } },
        }),
      });
      assert.equal(delivered.kind, "completed");
      if (delivered.kind !== "completed") throw new Error("Expected persisted delivery");
      assert.ok(delivered.response && typeof delivered.response === "object" && "responseKind" in delivered.response);
      assert.equal(delivered.response.responseKind, "answer");
      assert.equal(generationCalls, 2, "initial research supplies complete evidence without an extra navigation-only model call");
      assert.equal(embeddingCalls, 4);
      assert.deepEqual(categories, ["generation", "embedding", "embedding", "embedding", "embedding", "generation"]);
      assert.deepEqual([...attributedRuns], [delivered.runId]);
      const receipts = journal.records(delivered.runId);
      assert.equal(receipts.filter(record => record.category === "generation" && record.receipt.event === "settled").length, 2);
      assert.equal(receipts.filter(record => record.category === "embedding" && record.receipt.event === "settled").length, 4);
      assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM legal_source_references WHERE ai_run_id=?").get(delivered.runId)?.n, 1);
      const freshReader = createPreparedStoredReader({ release: release("current"), worker });
      const savedSource = legalChatResponseSchema.parse(delivered.response).sources[0];
      const reopen = { db: fixture.d1, workspaceId: "w", userId: "u", messageId: delivered.responseMessageId!,
        sourceId: savedSource.sourceId, sourceUrl: savedSource.originalUrl, signal: AbortSignal.timeout(3000),
        objects: { get: (key: string, _identity: unknown, signal: AbortSignal) => freshReader.get(key, signal) } };
      const saved = await savedCitationDetails(reopen);
      assert.match(saved!.text, /Authenticated complete rule/);
      assert.match(saved!.text, /Exception for private events/);
      assert.equal(saved!.fullArticle, true);
      assert.equal(saved!.verifiedAt, "2020-01-01T00:00:00.000Z");
      assert.equal(await savedCitationDetails({ ...reopen, userId: "another-user" }), null);
      assert.equal(objects.size, 0);
    } finally { journal.close(); fixture.sqlite.close(); }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
