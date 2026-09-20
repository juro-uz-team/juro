import assert from "node:assert/strict";
import test from "node:test";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";
import { changeAnalysisCaseLink } from "../lib/document-analysis/analysis-case-link";
import {
  chunkUserDocument,
  deleteUserDocumentVectorsForAnalysis,
  deleteUserDocumentVectorsForOwner,
  executeUserDocumentIndexJob,
  scheduleUserDocumentIndexStatements,
  scheduleTrustedUserDocumentIndexStatements,
  searchUserDocumentEvidence,
  searchUserDocuments,
} from "../lib/document-analysis/user-document-vectors";
import {
  readLegalDocumentContext,
} from "../lib/legal-chat/document-context";
import { parsePrivateDocumentLocator } from "../lib/document-analysis/private-document-locator";

const now = "2026-08-04T12:00:00.000Z";

test("private document auto-trust scheduling is fail-closed behind its release flag", () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const input = {
      analysisId: "analysis-a",
      documentVersionId: "analysis-version-a",
      workspaceId: "workspace-a",
      ownerUserId: "user-a",
      sourceHash: "a".repeat(64),
      language: "ru" as const,
      now,
    };
    assert.equal(scheduleTrustedUserDocumentIndexStatements({
      DB: d1,
      LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST: "false",
    }, input).length, 0);
    assert.equal(scheduleTrustedUserDocumentIndexStatements({
      DB: d1,
      LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST: "true",
    }, input).length, 2);
  } finally {
    sqlite.close();
  }
});

class FakeVectorize {
  readonly vectors = new Map<string, VectorizeVector>();
  readonly deleted: string[] = [];
  tamper: ((vector: VectorizeVector) => VectorizeVector) | null = null;
  failAfterUpsert = false;

  async upsert(vectors: VectorizeVector[]) {
    for (const vector of vectors) this.vectors.set(vector.id, vector);
    if (this.failAfterUpsert) throw new Error("VECTORIZE_ACK_LOST");
    return { mutationId: `mutation-${this.vectors.size}` };
  }

  async getByIds(ids: string[]) {
    return ids.flatMap((id) => {
      const vector = this.vectors.get(id);
      return vector ? [vector] : [];
    });
  }

  async query() {
    const matches = [...this.vectors.values()].map((stored) => {
      const vector = this.tamper ? this.tamper(stored) : stored;
      return { ...vector, values: undefined, score: 0.91 };
    });
    return { matches, count: matches.length };
  }

  async deleteByIds(ids: string[]) {
    this.deleted.push(...ids);
    for (const id of ids) this.vectors.delete(id);
    return { mutationId: `delete-${this.deleted.length}` };
  }
}

class FakeBucket {
  readonly objects = new Map<string, { bytes: Uint8Array; digest: ArrayBuffer }>();

  async putText(key: string, text: string) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    this.objects.set(key, { bytes, digest });
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async get(key: string) {
    const item = this.objects.get(key);
    if (!item) return null;
    return {
      size: item.bytes.byteLength,
      checksums: { sha256: item.digest },
      async arrayBuffer() { return item.bytes.slice().buffer; },
    };
  }
}

function embeddingFetch(): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string[]; dimensions: number };
    assert.equal(body.dimensions, 1536);
    return Response.json({
      object: "list",
      model: "text-embedding-3-large",
      data: body.input.map((_value, index) => ({ object: "embedding", index, embedding: Array.from({ length: 1536 }, () => index / 100) })),
      usage: { prompt_tokens: body.input.length * 11, total_tokens: body.input.length * 11 },
    }, { headers: { "x-request-id": `req_${body.input.length}` } });
  };
}

function seedIdentity(
  sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"],
  userId: string,
  workspaceId: string,
) {
  sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES (?,?,?,?)")
    .run(userId, `${userId}@example.test`, now, now);
  sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run(workspaceId, "individual", workspaceId, now, now);
  sqlite.prepare(`INSERT INTO workspace_members
    (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
    VALUES (?,?,?,'owner','active',?,?,?)`).run(`${workspaceId}:${userId}`, workspaceId, userId, now, now, now);
}

function seedAnalysis(
  sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"],
  input: { userId: string; workspaceId: string; analysisId: string; versionId: string; r2Key: string; text: string; sha256: string },
) {
  sqlite.prepare(`INSERT INTO document_files
    (id,workspace_id,owner_user_id,kind,r2_key,file_name,mime_type,size_bytes,sha256,created_at,updated_at)
    VALUES (?,?,?,'analysis_safe',?,'contract.pdf','application/pdf',10,?,?,?)`).run(
    `${input.analysisId}-file`, input.workspaceId, input.userId, `safe/${input.analysisId}`, "f".repeat(64), now, now,
  );
  sqlite.prepare(`INSERT INTO document_analyses
    (id,workspace_id,owner_user_id,uploaded_file_id,status,consent_version,created_at,updated_at)
    VALUES (?,?,?,?,'completed','2026-08-04',?,?)`).run(
    input.analysisId, input.workspaceId, input.userId, `${input.analysisId}-file`, now, now,
  );
  sqlite.prepare(`INSERT INTO analysis_document_versions
    (id,analysis_id,workspace_id,owner_user_id,version,parent_version_id,source_kind,r2_key,
     file_name,mime_type,size_bytes,sha256,idempotency_key,selection_sha256,revision_ids_json,created_by_user_id,created_at)
    VALUES (?,?,?,?,1,NULL,'extracted',?,'contract.normalized-v1.md','text/markdown; charset=utf-8',?,?,NULL,NULL,'[]',NULL,?)`).run(
    input.versionId, input.analysisId, input.workspaceId, input.userId, input.r2Key,
    new TextEncoder().encode(input.text).byteLength, input.sha256, now,
  );
}

test("user document chunking is deterministic, overlapping and bounded", () => {
  const text = Array.from({ length: 700 }, (_, index) => `Пункт ${index}. Обязательство стороны.`).join("\n");
  const first = chunkUserDocument(text);
  const second = chunkUserDocument(text);
  assert.deepEqual(first, second);
  assert.ok(first.length > 1);
  assert.ok(first.length <= 300);
  assert.equal(first[0]?.start, 0);
  assert.ok((first[1]?.start ?? 0) < (first[0]?.end ?? 0));

  const windowsText = "  Заголовок\r\nПервое условие.\r\nОплата до 10 числа.  ";
  const windowsChunk = chunkUserDocument(windowsText)[0]!;
  assert.equal(
    windowsText.slice(windowsChunk.start, windowsChunk.end).replace(/\r\n?/g, "\n").trim(),
    windowsChunk.text,
  );
});

test("vector IDs are durable before an ambiguous upsert and analysis deletion verifies their absence", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const bucket = new FakeBucket();
  const vectorize = new FakeVectorize();
  try {
    seedIdentity(sqlite, "user-a", "workspace-a");
    const text = "Синтетический договор с одним проверяемым обязательством.";
    const r2Key = "analysis-versions/workspace-a/analysis-ambiguous/1-source.md";
    const sourceHash = await bucket.putText(r2Key, text);
    seedAnalysis(sqlite, {
      userId: "user-a",
      workspaceId: "workspace-a",
      analysisId: "analysis-ambiguous",
      versionId: "analysis-version-ambiguous",
      r2Key,
      text,
      sha256: sourceHash,
    });
    await d1.batch(scheduleUserDocumentIndexStatements(d1, {
      analysisId: "analysis-ambiguous",
      documentVersionId: "analysis-version-ambiguous",
      workspaceId: "workspace-a",
      ownerUserId: "user-a",
      sourceHash,
      language: "ru",
      now,
    }));
    const env = {
      APP_ENV: "development" as const,
      DB: d1,
      BUCKET: bucket as unknown as R2Bucket,
      USER_DOCUMENTS_INDEX: vectorize as unknown as VectorizeIndex,
      OPENAI_API_KEY: "test-only-key",
      EMBEDDING_MODEL: "text-embedding-3-large",
    };
    vectorize.failAfterUpsert = true;
    await assert.rejects(executeUserDocumentIndexJob(
      env,
      "user-document-index-analysis-version-ambiguous",
      "workspace-a",
      { now: new Date(now), fetchImpl: embeddingFetch() },
    ));
    assert.equal(vectorize.vectors.size, 1);
    assert.equal((sqlite.prepare(
      "SELECT count(*) AS total FROM user_document_vector_chunks WHERE job_id='user-document-index-analysis-version-ambiguous'",
    ).get() as { total: number }).total, 1);

    vectorize.failAfterUpsert = false;
    assert.equal(await deleteUserDocumentVectorsForAnalysis(env, {
      analysisId: "analysis-ambiguous",
      workspaceId: "workspace-a",
      userId: "user-a",
    }, now), 1);
    assert.equal(vectorize.vectors.size, 0);
  } finally {
    sqlite.close();
  }
});

test("case context selects authorized matches before the document result limit", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const bucket = new FakeBucket(), vectorize = new FakeVectorize();
  try {
    seedIdentity(sqlite, "user-a", "workspace-a");
    sqlite.prepare("INSERT INTO cases (id,workspace_id,owner_user_id,account_type,locale,title,legal_area,status,current_revision,created_at,updated_at) VALUES ('selected-case','workspace-a','user-a','individual','ru','Case','contracts','open',1,?,?)").run(now, now);
    sqlite.prepare("INSERT INTO conversations (id,workspace_id,owner_user_id,case_id,title,locale,status,created_at,updated_at) VALUES ('selected-chat','workspace-a','user-a','selected-case','Private','ru','active',?,?)").run(now, now);
    const env = { APP_ENV: "development" as const, DB: d1, BUCKET: bucket as unknown as R2Bucket,
      USER_DOCUMENTS_INDEX: vectorize as unknown as VectorizeIndex, OPENAI_API_KEY: "test-only-key" };
    for (let index = 0; index < 11; index++) {
      const analysisId = `ranked-analysis-${index}`, versionId = `ranked-version-${index}`, r2Key = `analysis-versions/workspace-a/${analysisId}/1-source.md`;
      const text = `Document ${index}. Payment is due on the tenth day.`;
      const sourceHash = await bucket.putText(r2Key, text);
      seedAnalysis(sqlite, { userId: "user-a", workspaceId: "workspace-a", analysisId, versionId, r2Key, text, sha256: sourceHash });
      if (index === 10) await changeAnalysisCaseLink({ db: d1, workspaceId: "workspace-a", userId: "user-a", analysisId,
        caseId: "selected-case", idempotencyKey: "selected-ranked-case-link" });
      await d1.batch(scheduleUserDocumentIndexStatements(d1, { analysisId, documentVersionId: versionId,
        workspaceId: "workspace-a", ownerUserId: "user-a", sourceHash, language: "ru", now }));
      await executeUserDocumentIndexJob(env, `user-document-index-${versionId}`, "workspace-a", { now: new Date(now), fetchImpl: embeddingFetch() });
    }
    const result = await readLegalDocumentContext(env, { workspaceId: "workspace-a", userId: "user-a",
      conversationId: "selected-chat", query: "payment deadline" }, { fetchImpl: embeddingFetch() });
    assert.equal(result.length, 1);
    assert.match(result[0]!.text, /^Document 10\./);
  } finally { sqlite.close(); }
});

test("0080 indexes immutable text and search fails closed across tenants and tampered metadata", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const bucket = new FakeBucket();
  const vectorize = new FakeVectorize();
  try {
    seedIdentity(sqlite, "user-a", "workspace-a");
    seedIdentity(sqlite, "user-b", "workspace-b");
    sqlite.prepare(`INSERT INTO workspace_members
      (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
      VALUES ('member-b-a','workspace-a','user-b','member','active',?,?,?)`).run(now, now, now);
    const text = "Договор аренды. Арендатор оплачивает сумму до 10 числа каждого месяца. Ответственность ограничена законом.";
    const r2Key = "analysis-versions/workspace-a/analysis-a/1-source.md";
    const sourceHash = await bucket.putText(r2Key, text);
    seedAnalysis(sqlite, {
      userId: "user-a", workspaceId: "workspace-a", analysisId: "analysis-a",
      versionId: "analysis-source-analysis-a", r2Key, text, sha256: sourceHash,
    });
    await d1.batch(scheduleUserDocumentIndexStatements(d1, {
      analysisId: "analysis-a",
      documentVersionId: "analysis-source-analysis-a",
      workspaceId: "workspace-a",
      ownerUserId: "user-a",
      sourceHash,
      language: "ru",
      now,
    }));
    const env = {
      APP_ENV: "development" as const,
      DB: d1,
      BUCKET: bucket as unknown as R2Bucket,
      USER_DOCUMENTS_INDEX: vectorize as unknown as VectorizeIndex,
      OPENAI_API_KEY: "test-only-key",
      EMBEDDING_MODEL: "text-embedding-3-large",
    };
    const indexed = await executeUserDocumentIndexJob(
      env,
      "user-document-index-analysis-source-analysis-a",
      "workspace-a",
      { now: new Date(now), fetchImpl: embeddingFetch() },
    );
    assert.equal(indexed.status, "submitted");
    assert.equal(indexed.chunks, 1);
    const stored = [...vectorize.vectors.values()][0]!;
    assert.equal(stored.namespace, "workspace-a");
    assert.deepEqual(stored.metadata, {
      environment: "development",
      userId: "user-a",
      workspaceId: "workspace-a",
      caseId: "",
      documentId: "analysis-a",
      documentVersionId: "analysis-source-analysis-a",
      accessScope: "owner",
      language: "ru",
      page: 0,
      sourceHash,
    });

    const ownerResults = await searchUserDocuments(env, {
      workspaceId: "workspace-a", userId: "user-a", query: "срок оплаты",
    }, { fetchImpl: embeddingFetch() });
    assert.equal(ownerResults.length, 1);
    assert.match(ownerResults[0]!.snippet, /10 числа/);
    assert.equal("sourceHash" in ownerResults[0]!, false);
    const evidence = await searchUserDocumentEvidence(env, {
      workspaceId: "workspace-a", userId: "user-a", query: "срок оплаты",
    }, { fetchImpl: embeddingFetch() });
    assert.equal(evidence[0]?.sourceHash, sourceHash);
    assert.equal(evidence[0]?.workspaceId, "workspace-a");
    assert.equal(evidence[0]?.ownerUserId, "user-a");
    sqlite.prepare("INSERT INTO conversations (id,workspace_id,owner_user_id,title,locale,status,created_at,updated_at) VALUES ('private-chat','workspace-a','user-a','Private','ru','active',?,?)").run(now, now);
    const noFetch: typeof fetch = async () => { throw new Error("Unauthorized conversation must not trigger embedding"); };
    for (const scope of [{ userId: "user-b", workspaceId: "workspace-a" }, { userId: "user-a", workspaceId: "workspace-b" }]) {
      assert.deepEqual(await readLegalDocumentContext(env, { ...scope, conversationId: "private-chat", query: "срок оплаты" }, { fetchImpl: noFetch }), []);
    }
    const chatSources = await readLegalDocumentContext(env, {
      workspaceId: "workspace-a", userId: "user-a", conversationId: "private-chat", query: "срок оплаты",
    }, { fetchImpl: embeddingFetch(), now: new Date(now) });
    assert.equal(chatSources.length, 1);
    assert.equal(chatSources[0]?.kind, "private_document");
    assert.equal(chatSources[0]?.source.sourceClass, "USER_TRUSTED_PRIVATE");
    assert.equal(chatSources[0]?.source.sourceType, "internal");
    assert.equal(chatSources[0]?.source.verificationState, "user_supplied");
    assert.equal(parsePrivateDocumentLocator(chatSources[0]!.source.officialUrl), evidence[0]?.id);
    assert.equal(chatSources[0]?.source.spans?.[0]?.textSha256.length, 64);
    assert.equal(chatSources[0]?.text, evidence[0]?.snippet);
    assert.equal(chatSources[0]?.textSha256, chatSources[0]?.source.spans?.[0]?.textSha256);
    assert.equal("endpoint" in chatSources[0]!, false, "Private text has no legal applicability endpoint");
    sqlite.prepare("INSERT INTO cases (id,workspace_id,owner_user_id,account_type,locale,title,legal_area,status,current_revision,created_at,updated_at) VALUES ('private-case','workspace-a','user-a','individual','ru','Case','contracts','open',1,?,?)").run(now, now);
    sqlite.prepare("UPDATE conversations SET case_id='private-case' WHERE id='private-chat'").run();
    const caseContext = () => readLegalDocumentContext(env, { workspaceId: "workspace-a", userId: "user-a", conversationId: "private-chat", query: "срок оплаты" }, { fetchImpl: embeddingFetch() });
    assert.deepEqual(await caseContext(), [], "An unrelated document cannot enter a case-linked conversation");
    await changeAnalysisCaseLink({ db: d1, workspaceId: "workspace-a", userId: "user-a", analysisId: "analysis-a",
      caseId: "private-case", idempotencyKey: "link-private-document-case" });
    assert.equal((await caseContext()).length, 1);
    const memberResults = await searchUserDocuments(env, {
      workspaceId: "workspace-a", userId: "user-b", query: "срок оплаты",
    }, { fetchImpl: embeddingFetch() });
    assert.deepEqual(memberResults, []);
    const crossTenantResults = await searchUserDocuments(env, {
      workspaceId: "workspace-b", userId: "user-b", query: "срок оплаты",
    }, { fetchImpl: embeddingFetch() });
    assert.deepEqual(crossTenantResults, []);

    vectorize.tamper = (vector) => ({ ...vector, metadata: { ...vector.metadata, userId: "user-b" } });
    const tampered = await searchUserDocuments(env, {
      workspaceId: "workspace-a", userId: "user-a", query: "срок оплаты",
    }, { fetchImpl: embeddingFetch() });
    assert.deepEqual(tampered, []);
    vectorize.tamper = null;

    assert.throws(() => sqlite.prepare(`INSERT INTO user_document_index_jobs
      (id,analysis_id,document_version_id,workspace_id,owner_user_id,source_hash,language,access_scope,
       status,chunk_count,attempt_count,created_at,updated_at)
      VALUES ('cross-job','analysis-a','analysis-source-analysis-a','workspace-b','user-b',?,'ru','owner','queued',0,0,?,?)`
    ).run(sourceHash, now, now), /user document index source unavailable/);

    const deleted = await deleteUserDocumentVectorsForOwner(env, "user-a", now);
    assert.equal(deleted, 1);
    assert.equal(vectorize.deleted.length, 1);
    assert.equal((sqlite.prepare("SELECT status FROM user_document_index_jobs").get() as { status: string }).status, "delete_submitted");
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    const usage = sqlite.prepare(
      `SELECT feature,status,provider,model,input_tokens AS inputTokens,
        provider_request_id AS providerRequestId,price_version_id AS priceVersionId
       FROM ai_provider_usage_events ORDER BY created_at,id`,
    ).all() as Array<Record<string, unknown>>;
    assert.equal(usage.length, 9);
    assert.equal(usage.filter((event) => event.feature === "document_indexing").length, 1);
    assert.equal(usage.filter((event) => event.feature === "document_search").length, 8);
    assert.ok(usage.every((event) => event.status === "succeeded"));
    assert.ok(usage.every((event) => event.provider === "openai"));
    assert.ok(usage.every((event) => event.model === "text-embedding-3-large"));
    assert.ok(usage.every((event) => event.inputTokens === 11));
    assert.ok(usage.every((event) => event.providerRequestId === "req_1"));
    assert.ok(usage.every((event) => event.priceVersionId === null));
    const aggregate = sqlite.prepare(
      `SELECT sum(request_count) AS requests,sum(unpriced_request_count) AS unpriced
       FROM ai_cost_daily_aggregates`,
    ).get() as { requests: number; unpriced: number };
    assert.equal(aggregate.requests, 9);
    assert.equal(aggregate.unpriced, 9);
  } finally {
    sqlite.close();
  }
});
