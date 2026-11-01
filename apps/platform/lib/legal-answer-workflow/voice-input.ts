import type { IdentityKeyring } from "../auth/keyring";
import { revealVoiceTranscript, voiceRecordingForUser } from "../ai/voice-recording";
import { withinSignal } from "./lifetime";

export type VerifiedAnswerVoice = {
  recordingId: string; ciphertext: string; iv: string; keyVersion: string;
};

export async function validateAnswerVoice(input: {
  db: D1Database; workspaceId: string; userId: string; recordingId: string;
  question: string; keyring: IdentityKeyring; signal: AbortSignal;
}): Promise<VerifiedAnswerVoice> {
  const recording = await withinSignal(input.signal, () => voiceRecordingForUser(
    input.db, input.recordingId, input.workspaceId, input.userId));
  if (!recording || recording.status !== "transcribed" || recording.deletedAt || recording.purgedAt
    || !Number.isFinite(Date.parse(recording.expiresAt)) || Date.parse(recording.expiresAt) <= Date.now()
    || recording.messageId || recording.conversationId) throw new Error("VOICE_RECORDING_UNAVAILABLE");
  if (await withinSignal(input.signal, () => revealVoiceTranscript(input.keyring, recording)) !== input.question.trim()) {
    throw new Error("VOICE_TRANSCRIPT_MISMATCH");
  }
  return { recordingId: recording.id, ciphertext: recording.transcriptCiphertext!,
    iv: recording.transcriptIv!, keyVersion: recording.transcriptKeyVersion! };
}

/** Compare the encrypted version and claim once inside the answer publication transaction. */
export function answerVoiceStatements(input: {
  db: D1Database; workspaceId: string; userId: string; conversationId: string;
  requestMessageId: string; now: string; voice?: VerifiedAnswerVoice;
}): D1PreparedStatement[] {
  if (!input.voice) return [];
  const voice = input.voice;
  return [input.db.prepare(`UPDATE voice_recordings SET status='submitted',conversation_id=?,message_id=?,
    submitted_at=?,updated_at=? WHERE id=? AND workspace_id=? AND user_id=? AND status='transcribed'
    AND deleted_at IS NULL AND purged_at IS NULL AND conversation_id IS NULL AND message_id IS NULL
    AND expires_at>? AND transcript_ciphertext=? AND transcript_iv=? AND transcript_key_version=?`)
    .bind(input.conversationId, input.requestMessageId, input.now, input.now, voice.recordingId,
      input.workspaceId, input.userId, input.now, voice.ciphertext, voice.iv, voice.keyVersion),
  input.db.prepare(`SELECT CASE WHEN changes()=1 THEN 1
    ELSE json_extract('VOICE_PUBLICATION_CONFLICT','$') END AS owned`)];
}
