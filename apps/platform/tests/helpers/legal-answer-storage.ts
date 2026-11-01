import { sqliteD1Fixture } from "./sqlite-d1";
import { readFileSync } from "node:fs";
import { reserveAiRun } from "../../lib/ai/run-store";
import { serializeLegalOutcome } from "../../lib/legal-answer-workflow/serialization";

export async function legalAnswerStorageFixture() {
  const { sqlite, d1 } = sqliteD1Fixture();
  // Mirror retained PostgreSQL receipt columns absent from the historical SQLite migrations.
  sqlite.exec("ALTER TABLE legal_source_references ADD COLUMN evidence_receipt_json TEXT");
  const languageMigration = readFileSync(new URL("../../drizzle/0158_private_document_citation_languages.sql", import.meta.url), "utf8");
  for (const statement of languageMigration.split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
  sqlite.exec("ALTER TABLE legal_source_references ADD COLUMN answer_source_id TEXT");
  const now = new Date().toISOString();
  sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES(?,?,?,?)").run("u", "fixture@example.test", now, now);
  sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES(?,?,?,?,?)").run("w", "individual", "Fixture", now, now);
  sqlite.prepare(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
    VALUES('member','w','u','owner','active',?,?,?)`).run(now, now, now);
  const input = { db: d1, submittedAt: Date.now(), deadlineMs: 30_000,
    workspaceId: "w", userId: "u", idempotencyKey: "fixture-key", requestHash: "fixture-hash",
    conversationId: null, provider: "openai", model: "gpt-6-luna", answerMode: "detailed" as const,
    reasoningMode: "deep" as const, legalDatabaseAsOf: "2026-10-28", instructionHash: "instructions", sourceVersionHash: "sources" };
  const reservation = await reserveAiRun(input);
  if (reservation.kind !== "reserved") throw new Error("Fixture reservation failed");
  const response = serializeLegalOutcome({ kind: "insufficient_evidence", checkedEvidence: [], clarificationQuestions: [],
    gaps: [{ requirementId: "r", description: "Artificial rule unavailable." }] },
  { question: "Artificial question", language: "en", format: "detailed", mode: "deep", actor: { tenantId: "w", userId: "u" },
    submittedAt: Date.now(), deadlineMs: 30_000, history: [], privateDocuments: [] },
  { sources: [], legalDatabaseAsOf: "2026-10-28" });
  return { sqlite, d1, input: { ...input, ...reservation, question: "Artificial question", response,
    signal: new AbortController().signal,
    usage: { providerResponseId: null, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, attempts: 0, latencyMs: 10 },
  } };
}
