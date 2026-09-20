import assert from "node:assert/strict";
import test from "node:test";
import { decodeSavedLegalAnswer, publicConversationTurn, readSavedLegalAnswer } from "../lib/legal-chat/saved-answer";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const historical = {
    responseKind: "clarification_required", summary: "Нужно уточнить дату события.",
    answer: "Без даты нельзя определить применимую редакцию.", language: "ru", jurisdiction: "UZ",
    answerMode: "detailed", reasoningMode: "fast", clarificationQuestions: ["Когда произошло событие?"],
    confirmedFindings: [], assumptions: [], risks: [], sources: [], requiredDocuments: [], actionPlan: [],
    deadlines: [], successOutlook: null, urgency: "normal", suggestedDocument: null, suggestLawyer: false,
    legalDatabaseAsOf: "unavailable",
};

test("history keeps legacy display text while withholding raw stored metadata", () => {
  const turn = {
    branchId: "branch", parentBranchId: null, requestMessageId: "question", responseMessageId: "answer",
    question: "Question", answer: "Stored answer", createdAt: "2026-09-14T00:00:00.000Z",
    structuredJson: JSON.stringify({ privateDiagnostics: "not public" }),
  };
  const projected = publicConversationTurn(turn);
  assert.equal(projected.answer, turn.answer);
  assert.equal(projected.result, null);
  assert.equal("structuredJson" in projected, false);
  assert.equal("parentBranchId" in projected, false);
  assert.equal(JSON.stringify(projected).includes("not public"), false);
  assert.deepEqual(publicConversationTurn({ ...turn, structuredJson: JSON.stringify(historical) }).result, historical);
  assert.equal(publicConversationTurn({ ...turn, structuredJson: "{invalid" }).result, null);
  assert.equal(publicConversationTurn({ ...turn, structuredJson: null }).result, null);
});

test("historical saved answers decode without inventing evidence or rewriting their content", () => {
  assert.deepEqual(decodeSavedLegalAnswer(JSON.stringify(historical)), historical);
  assert.throws(() => decodeSavedLegalAnswer("{invalid"));
  assert.throws(() => decodeSavedLegalAnswer(JSON.stringify({ ...historical, sources: [{ sourceId: "invented" }] })));
});

test("a saved answer is available only to its owner in the selected workspace", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const now = "2026-09-14T00:00:00.000Z";
    sqlite.prepare("INSERT INTO user_profiles(id,email,locale,created_at,updated_at) VALUES (?,?,?,?,?)").run("owner", "owner@example.test", "ru", now, now);
    sqlite.prepare("INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual',?,'ru',?,?)").run("workspace", "Workspace", now, now);
    sqlite.prepare("INSERT INTO conversations(id,workspace_id,owner_user_id,title,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("conversation", "workspace", "owner", "Saved question", "ru", now, now);
    sqlite.prepare("INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at) VALUES (?,?,'assistant',?,?,?)").run("answer", "conversation", historical.answer, JSON.stringify(historical), now);
    const input = { db: d1, userId: "owner", workspaceId: "workspace", conversationId: "conversation" };
    assert.equal((await readSavedLegalAnswer(input))?.result.answer, historical.answer);
    assert.equal(await readSavedLegalAnswer({ ...input, userId: "someone-else" }), null);
    assert.equal(await readSavedLegalAnswer({ ...input, workspaceId: "another-workspace" }), null);
    assert.equal(await readSavedLegalAnswer({ ...input, responseMessageId: "another-answer" }), null);
  } finally { sqlite.close(); }
});
