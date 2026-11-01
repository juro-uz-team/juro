import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { loadPrivateAnswerDocuments } from "../lib/legal-answer-workflow/private-documents";
import { executeSignedInAnswer } from "../lib/legal-answer-workflow/signed-request";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { openPrivateSavedCitation } from "../lib/legal-answer-workflow/private-citation";
import { handleSavedCitationHttp } from "../lib/legal-answer-workflow/citation-http";
import { loadAnswerContext } from "../lib/legal-answer-workflow/history";
import { reserveAiRun } from "../lib/ai/run-store";

test("private context requires owned clean immutable text and rejects foreign access before object I/O", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const now = new Date().toISOString(), text = "Artificial private agreement: notice is disputed. ".repeat(9000);
    const bytes = Buffer.from(text), hash = createHash("sha256").update(bytes).digest("hex"), sourceHash = "a".repeat(64);
    fixture.sqlite.prepare(`INSERT INTO document_files
      (id,owner_user_id,kind,r2_key,file_name,mime_type,size_bytes,workspace_id,sha256,created_at,updated_at)
      VALUES('file','u','analysis_quarantined','safe/file','Agreement.pdf','application/pdf',100,'w',?,?,?)`).run(sourceHash, now, now);
    fixture.sqlite.prepare(`INSERT INTO document_analyses
      (id,workspace_id,owner_user_id,uploaded_file_id,status,consent_version,created_at,updated_at)
      VALUES('analysis','w','u','file','quarantined','fixture',?,?)`).run(now, now);
    fixture.sqlite.prepare(`INSERT INTO file_scan_results
      (id,analysis_id,file_id,workspace_id,owner_user_id,verdict,provider,engine,engine_version,signature_version,
       provider_scan_id,source_sha256,response_sha256,threats_json,completed_at,created_at)
      VALUES('scan','analysis','file','w','u','clean','fixture','fixture','1','1','scan',?,?,'[]',?,?)`)
      .run(sourceHash, sourceHash, now, now);
    fixture.sqlite.prepare("UPDATE document_files SET kind='analysis_safe' WHERE id='file'").run();
    fixture.sqlite.prepare("UPDATE document_analyses SET status='completed',summary_json='{}',result_sha256=? WHERE id='analysis'")
      .run(sourceHash);
    fixture.sqlite.prepare(`INSERT INTO analysis_document_versions
      (id,analysis_id,workspace_id,owner_user_id,version,source_kind,r2_key,file_name,mime_type,size_bytes,sha256,created_at)
      VALUES('version','analysis','w','u',1,'extracted','analysis-versions/text','Agreement.md',
        'text/markdown; charset=utf-8',?,?,?)`).run(bytes.length, hash, now);
    let reads = 0;
    const input = { db: fixture.d1, workspaceId: "w", userId: "u", conversationId: null,
      documentIds: ["version"], signal: new AbortController().signal,
      objects: { get: async () => { reads++; return bytes; } } };
    assert.deepEqual(await loadPrivateAnswerDocuments(input), [{ id: "version", text }]);
    reads = 0;
    await assert.rejects(() => loadPrivateAnswerDocuments({ ...input, userId: "other" }), /PRIVATE_DOCUMENT_UNAVAILABLE/);
    assert.equal(reads, 0);
    fixture.sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES('other','other@example.test',?,?)").run(now, now);
    fixture.sqlite.prepare(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
      VALUES('other-member','w','other','member','active',?,?,?)`).run(now, now, now);
    await assert.rejects(() => loadPrivateAnswerDocuments({ ...input, userId: "other" }), /PRIVATE_DOCUMENT_UNAVAILABLE/);
    fixture.sqlite.prepare(`INSERT INTO user_document_index_jobs
      (id,analysis_id,document_version_id,workspace_id,owner_user_id,source_hash,language,access_scope,status,created_at,updated_at)
      VALUES('job','analysis','version','w','u',?,'unknown','workspace','submitted',?,?)`).run(hash, now, now);
    assert.deepEqual(await loadPrivateAnswerDocuments({ ...input, userId: "other" }), [{ id: "version", text }]);
    await assert.rejects(() => executeSignedInAnswer({ ...input, question: "Explain my artificial agreement", language: "en",
      format: "short", mode: "fast", idempotencyKey: "private-publication", submittedAt: Date.now(), deadlineMs: 30_000 }, {
      model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-29", sourceVersionHash: "fixture", privateObjects: input.objects,
      createExecution: async () => ({
        model: legalEntryFixture({ complete: async ({ stage }) => {
          if (stage === "interpret") return { needsClarification: false, complexity: "difficult", requirements: [{ id: "r", question: "Artificial agreement rule?" }],
            queries: ["artificial agreement"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
          fixture.sqlite.prepare("UPDATE document_files SET archived_at=? WHERE id='file'").run(now);
          return { support: [], selectedIds: [], gaps: [{ requirementId: "r", description: "Rule unavailable." }], recovery: [] };
        } }),
        corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
          resolve: async () => null, get: async () => null }, citations: async () => [], usage: () => fixture.input.usage,
      }),
    }));
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n, 0);
    fixture.sqlite.prepare("UPDATE document_files SET archived_at=NULL WHERE id='file'").run();
    const saved = await persistSignedInAnswer({ ...fixture.input, documentIds: ["version"] });
    assert.ok(saved.responseMessageId);
    const historyInput = { ...input, conversationId: saved.conversationId, parentBranchId: saved.branchId };
    assert.deepEqual((await loadAnswerContext(historyInput)).documentIds, ["version"]);
    fixture.sqlite.prepare("UPDATE document_files SET archived_at=? WHERE id='file'").run(now);
    await assert.rejects(() => loadAnswerContext(historyInput), /PRIVATE_DOCUMENT_UNAVAILABLE/);
    fixture.sqlite.prepare("UPDATE document_files SET archived_at=NULL WHERE id='file'").run();
    for (const operation of ["follow_up", "regenerate", "edit"] as const) {
      await assert.rejects(() => executeSignedInAnswer({ ...historyInput, documentIds: [],
        question: operation === "regenerate" ? fixture.input.question : "Follow up on the agreement",
        language: "en", format: "short", mode: "fast", idempotencyKey: `context-${operation}`,
        submittedAt: Date.now(), deadlineMs: 30_000,
        branch: { operation, responseMessageId: saved.responseMessageId } }, {
        model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-29", sourceVersionHash: "fixture", privateObjects: input.objects,
        createExecution: async ({ request }) => {
          assert.deepEqual(request.privateDocuments, [{ id: "version", text }]);
          assert.equal(request.history.length, operation === "follow_up" ? 2 : 0);
          throw new Error("VERIFIED_ATTACHMENT_CONTEXT");
        },
      }), /VERIFIED_ATTACHMENT_CONTEXT/);
    }
    await assert.rejects(() => executeSignedInAnswer({ ...historyInput, documentIds: [],
      question: "Follow up on the artificial agreement", language: "en", format: "short", mode: "fast",
      idempotencyKey: "history-private-publication", submittedAt: Date.now(), deadlineMs: 30_000,
      branch: { operation: "follow_up", responseMessageId: saved.responseMessageId } }, {
      model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-29", sourceVersionHash: "fixture", privateObjects: input.objects,
      createExecution: async ({ request }) => {
        assert.equal(request.history.length, 2);
        assert.deepEqual(request.privateDocuments, [{ id: "version", text }]);
        return {
          model: legalEntryFixture({ complete: async ({ stage }) => {
            if (stage === "interpret") return { needsClarification: false, complexity: "difficult", requirements: [{ id: "r", question: "Agreement?" }],
              queries: ["agreement"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
            fixture.sqlite.prepare("UPDATE document_files SET archived_at=? WHERE id='file'").run(now);
            return { support: [], selectedIds: [], gaps: [{ requirementId: "r", description: "Unavailable." }], recovery: [] };
          } }),
          corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
            resolve: async () => null, get: async () => null }, citations: async () => [], usage: () => fixture.input.usage,
        };
      },
    }));
    assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n, 2);
    fixture.sqlite.prepare("UPDATE document_files SET archived_at=NULL WHERE id='file'").run();
    const vectorId = `ud_${"a".repeat(61)}`, sourceUrl = `juro-private://document/${vectorId}`;
    fixture.sqlite.prepare("UPDATE user_document_index_jobs SET status='processing' WHERE id='job'").run();
    fixture.sqlite.prepare(`INSERT INTO user_document_vector_chunks
      (id,job_id,vector_id,chunk_index,char_start,char_end,page,status,submitted_at)
      VALUES('chunk','job',?,0,0,?,0,'submitted',?)`).run(vectorId, text.length, now);
    fixture.sqlite.prepare("UPDATE user_document_index_jobs SET status='submitted' WHERE id='job'").run();
    fixture.sqlite.prepare(`INSERT INTO legal_source_references
      (id,ai_run_id,conversation_id,message_id,source_kind,source_locale,source_url,canonical_url,title,
       retrieved_at,validated_at,content_sha256,fetch_status,citation_validation_status,created_at,answer_source_id)
      VALUES('private-reference',?,?,?,'internal','unknown',?,?,'Agreement',?,?,?,'success','validated',?,'private-source')`)
      .run(fixture.input.runId, saved.conversationId, saved.responseMessageId, sourceUrl, sourceUrl, now, now, hash, now);
    const citation = { ...input, sourceUrl, sourceId: "private-source", messageId: saved.responseMessageId };
    assert.equal((await openPrivateSavedCitation(citation))?.text, text);
    const citationHttp = await handleSavedCitationHttp(new Request(`https://juro.example/api/platform/ai/citations/${saved.responseMessageId}?${
      new URLSearchParams({ sourceUrl, sourceId: "private-source" })}`), saved.responseMessageId, {
      authenticate: async () => ({ db: fixture.d1, workspaceId: "w", userId: "u" }),
      objects: { get: async () => bytes },
    });
    assert.equal(citationHttp.status, 200);
    const details = await citationHttp.json();
    assert.equal(details.privateSource, true);
    assert.equal(details.text, text);
    reads = 0;
    assert.equal(await openPrivateSavedCitation({ ...citation, userId: "other" }), null);
    assert.equal(reads, 0);
    assert.equal(await openPrivateSavedCitation({ ...citation, sourceId: "wrong-source" }), null);
    await assert.rejects(() => openPrivateSavedCitation({ ...citation, objects: { get: async () => {
      fixture.sqlite.prepare("UPDATE user_document_vector_chunks SET status='deleted',deleted_at=? WHERE id='chunk'").run(now);
      return bytes;
    } } }), /PRIVATE_CITATION_ACCESS_CHANGED/);
    assert.equal(await openPrivateSavedCitation(citation), null);
    await assert.rejects(() => loadAnswerContext(historyInput), /HISTORY_PRIVATE_CONTEXT_UNAVAILABLE/);
    reads = 0;
    await assert.rejects(() => loadPrivateAnswerDocuments({ ...input,
      objects: { get: async () => Buffer.from("Changed text") } }), /PRIVATE_DOCUMENT_INTEGRITY/);
    fixture.sqlite.prepare("UPDATE document_files SET archived_at=? WHERE id='file'").run(now);
    await assert.rejects(() => loadPrivateAnswerDocuments(input), /PRIVATE_DOCUMENT_UNAVAILABLE/);
    assert.equal(reads, 0);
    fixture.sqlite.prepare("UPDATE document_files SET archived_at=NULL WHERE id='file'").run();
    await assert.rejects(() => loadPrivateAnswerDocuments({ ...input, objects: { get: async () => {
      fixture.sqlite.prepare("UPDATE document_files SET archived_at=? WHERE id='file'").run(now);
      return bytes;
    } } }), /PRIVATE_DOCUMENT_UNAVAILABLE/);
    fixture.sqlite.prepare("UPDATE document_files SET archived_at=NULL WHERE id='file'").run();
    const inheritedIds = Array.from({ length: 13 }, (_, index) => `inherited-${index}`);
    const inheritedText = Buffer.from("Complete attached agreement context.");
    const inheritedHash = createHash("sha256").update(inheritedText).digest("hex");
    for (const id of inheritedIds) {
      fixture.sqlite.prepare(`INSERT INTO document_files
        (id,owner_user_id,kind,r2_key,file_name,mime_type,size_bytes,workspace_id,sha256,created_at,updated_at)
        VALUES(?,'u','analysis_quarantined',?,'Agreement.pdf','application/pdf',100,'w',?,?,?)`)
        .run(id, `safe/${id}`, sourceHash, now, now);
      fixture.sqlite.prepare(`INSERT INTO document_analyses
        (id,workspace_id,owner_user_id,uploaded_file_id,status,consent_version,created_at,updated_at)
        VALUES(?,'w','u',?,'quarantined','fixture',?,?)`).run(id, id, now, now);
      fixture.sqlite.prepare(`INSERT INTO file_scan_results
        (id,analysis_id,file_id,workspace_id,owner_user_id,verdict,provider,engine,engine_version,signature_version,
         provider_scan_id,source_sha256,response_sha256,threats_json,completed_at,created_at)
        VALUES(?,?,?,'w','u','clean','fixture','fixture','1','1',?,?,?,'[]',?,?)`)
        .run(id, id, id, id, sourceHash, sourceHash, now, now);
      fixture.sqlite.prepare("UPDATE document_files SET kind='analysis_safe' WHERE id=?").run(id);
      fixture.sqlite.prepare("UPDATE document_analyses SET status='completed',summary_json='{}',result_sha256=? WHERE id=?")
        .run(sourceHash, id);
      fixture.sqlite.prepare(`INSERT INTO analysis_document_versions
        (id,analysis_id,workspace_id,owner_user_id,version,source_kind,r2_key,file_name,mime_type,size_bytes,sha256,created_at)
        VALUES(?,?,'w','u',1,'extracted',?,'Agreement.md','text/markdown; charset=utf-8',?,?,?)`)
        .run(id, id, `analysis-versions/${id}`, inheritedText.length, inheritedHash, now);
    }
    const inherited = { ...input, documentIds: inheritedIds, objects: { get: async () => inheritedText } };
    assert.deepEqual(await loadPrivateAnswerDocuments(inherited), inheritedIds.map(id => ({ id, text: inheritedText.toString() })));
    const inheritedReservation = await reserveAiRun({ ...fixture.input, idempotencyKey: "inherited-context", requestHash: "inherited-context" });
    assert.equal(inheritedReservation.kind, "reserved");
    if (inheritedReservation.kind !== "reserved") throw new Error("Expected new reservation");
    const inheritedSaved = await persistSignedInAnswer({ ...fixture.input, ...inheritedReservation,
      idempotencyKey: "inherited-context", documentIds: inheritedIds });
    assert.deepEqual((await loadAnswerContext({ ...inherited, conversationId: inheritedSaved.conversationId,
      parentBranchId: inheritedSaved.branchId })).documentIds, inheritedIds);
  } finally { fixture.sqlite.close(); }
});
