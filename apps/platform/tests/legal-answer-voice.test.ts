import { legalEntryFixture } from "./helpers/legal-entry-agent";
import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { initializeVoiceRecording, saveEditedVoiceTranscript } from "../lib/ai/voice-recording";
import { validateAnswerVoice } from "../lib/legal-answer-workflow/voice-input";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { protectIdentityValue } from "../lib/auth/keyring";
import { executeSignedInAnswer } from "../lib/legal-answer-workflow/signed-request";

test("voice publication binds the verified transcript and rolls back if it changes", async () => {
  for (const changed of [false, true]) {
    const fixture = await legalAnswerStorageFixture();
    try {
      const keyring = { activeVersion: "test", versions: new Map([["test", {
        aead: new Uint8Array(32).fill(7), hmac: new Uint8Array(32).fill(8),
      }]]) };
      const { recording } = await initializeVoiceRecording({ db: fixture.d1, workspaceId: "w", userId: "u",
        idempotencyKey: "voice-fixture", requestHash: "b".repeat(64), intent: { mimeType: "audio/webm",
          sizeBytes: 10, durationMs: 1000, sha256: "a".repeat(64), locale: "en" } });
      const encrypted = await protectIdentityValue(keyring, fixture.input.question,
        { purpose: "voice-transcript-v1", subjectId: "u", recordId: recording.id });
      fixture.sqlite.prepare(`UPDATE voice_recordings SET status='transcribed',transcript_ciphertext=?,
        transcript_iv=?,transcript_key_version=?,transcribed_at=? WHERE id=?`)
        .run(encrypted.ciphertext, encrypted.iv, encrypted.keyVersion, new Date().toISOString(), recording.id);
      recording.status = "transcribed";
      await saveEditedVoiceTranscript({ db: fixture.d1, keyring, recording, transcript: fixture.input.question });
      const input = { ...fixture.input, recordingId: recording.id, keyring };
      await assert.rejects(() => validateAnswerVoice({ ...input, userId: "foreign" }), /VOICE_RECORDING_UNAVAILABLE/);
      await assert.rejects(() => validateAnswerVoice({ ...input, question: "Other transcript" }), /VOICE_TRANSCRIPT_MISMATCH/);
      const voice = await validateAnswerVoice(input);
      if (changed) await saveEditedVoiceTranscript({ db: fixture.d1, keyring, recording, transcript: "Changed" });
      if (changed) {
        await assert.rejects(() => persistSignedInAnswer({ ...fixture.input, voice }));
        assert.equal(fixture.sqlite.prepare("SELECT count(*) AS n FROM conversation_messages").get()?.n, 0);
      } else {
        let calls = 0, validations = 0;
        const request = { ...fixture.input, idempotencyKey: "voice-run", voiceRecordingId: recording.id,
          language: "en" as const, format: "detailed" as const, mode: "fast" as const, documentIds: [] };
        const dependencies: Parameters<typeof executeSignedInAnswer>[1] = {
          model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28", sourceVersionHash: "fixture",
          privateObjects: { get: async () => null },
          validateVoice: async args => { validations++; return validateAnswerVoice({ ...args, keyring }); },
          createExecution: async () => ({
            model: legalEntryFixture({ complete: async ({ stage }) => {
              calls++;
              return stage === "interpret" ? { needsClarification: false, complexity: "difficult", requirements: [{ id: "r", question: "Artificial rule?" }],
                queries: ["artificial rule"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] }
                : { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "r", description: "Unavailable" }] };
            } }),
            corpus: { search: async () => ({ candidates: [], sparseAvailable: true, denseAvailable: true }),
              resolve: async () => null, get: async () => null }, citations: async () => [], usage: () => fixture.input.usage,
          }),
        };
        const saved = await executeSignedInAnswer(request, dependencies);
        assert.equal(saved.kind, "completed");
        if (saved.kind !== "completed") throw new Error("Expected completion");
        assert.deepEqual(await executeSignedInAnswer(request, dependencies), saved);
        assert.equal(calls, 2);
        assert.equal(validations, 1);
        const message = fixture.sqlite.prepare("SELECT id FROM conversation_messages WHERE conversation_id=? AND author_type='user'").get(saved.conversationId);
        assert.deepEqual({ ...fixture.sqlite.prepare("SELECT status,conversation_id,message_id FROM voice_recordings WHERE id=?").get(recording.id) },
          { status: "submitted", conversation_id: saved.conversationId, message_id: message?.id });
      }
    } finally { fixture.sqlite.close(); }
  }
});
