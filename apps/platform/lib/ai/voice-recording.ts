import { z } from "zod";

import {
  parseIdentityKeyring,
  protectIdentityValue,
  revealIdentityValue,
  type IdentityKeyring,
} from "../auth/keyring";
import type { PlatformLocale } from "../platform/routing";

export const VOICE_MAX_BYTES = 25 * 1024 * 1024;
export const VOICE_MAX_DURATION_MS = 5 * 60 * 1_000;
export const VOICE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const allowedMimeTypes = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

const voiceIntentSchema = z.object({
  mimeType: z.string().trim().toLowerCase().refine((value) => allowedMimeTypes.has(value)),
  sizeBytes: z.number().int().min(1).max(VOICE_MAX_BYTES),
  durationMs: z.number().int().min(1).max(VOICE_MAX_DURATION_MS),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  locale: z.enum(["ru", "uz", "en"]),
}).strict();

const transcriptSchema = z.object({
  transcript: z.string().trim().min(1).max(8_000),
}).strict();

export type VoiceIntent = z.infer<typeof voiceIntentSchema>;

export type VoiceRecordingRow = {
  id: string;
  workspaceId: string;
  userId: string;
  conversationId: string | null;
  caseId: string | null;
  messageId: string | null;
  idempotencyKey: string;
  requestHash: string;
  objectKey: string;
  quarantineKey: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  sha256: string;
  locale: PlatformLocale;
  status: string;
  transcriptCiphertext: string | null;
  transcriptIv: string | null;
  transcriptKeyVersion: string | null;
  provider: string | null;
  model: string | null;
  errorCode: string | null;
  expiresAt: string;
  uploadedAt: string | null;
  transcribedAt: string | null;
  submittedAt: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const VOICE_SELECT = `
  id,workspace_id AS workspaceId,user_id AS userId,
  conversation_id AS conversationId,case_id AS caseId,message_id AS messageId,
  idempotency_key AS idempotencyKey,request_hash AS requestHash,
  object_key AS objectKey,quarantine_key AS quarantineKey,mime_type AS mimeType,
  size_bytes AS sizeBytes,duration_ms AS durationMs,sha256,locale,status,
  transcript_ciphertext AS transcriptCiphertext,transcript_iv AS transcriptIv,
  transcript_key_version AS transcriptKeyVersion,provider,model,error_code AS errorCode,
  expires_at AS expiresAt,uploaded_at AS uploadedAt,transcribed_at AS transcribedAt,
  submitted_at AS submittedAt,deleted_at AS deletedAt,purged_at AS purgedAt,
  created_at AS createdAt,updated_at AS updatedAt`;

export class VoiceRecordingError extends Error {
  constructor(
    public readonly code:
      | "INVALID_VOICE_REQUEST"
      | "INVALID_IDEMPOTENCY_KEY"
      | "VOICE_IDEMPOTENCY_CONFLICT"
      | "VOICE_RECORDING_NOT_FOUND"
      | "VOICE_UPLOAD_STATE_INVALID"
      | "VOICE_UPLOAD_INTEGRITY_FAILED"
      | "VOICE_FORMAT_UNSUPPORTED"
      | "VOICE_TRANSCRIPTION_BUSY"
      | "VOICE_TRANSCRIPTION_UNAVAILABLE"
      | "VOICE_SPEECH_UNAVAILABLE"
      | "VOICE_TRANSCRIPT_INVALID"
      | "VOICE_TRANSCRIPT_MISMATCH"
      | "VOICE_ENCRYPTION_UNAVAILABLE",
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VoiceRecordingError";
  }
}

export function parseVoiceIntent(input: unknown): VoiceIntent {
  const parsed = voiceIntentSchema.safeParse(input);
  if (!parsed.success) {
    throw new VoiceRecordingError("INVALID_VOICE_REQUEST", 400, "Некорректные параметры голосовой записи.");
  }
  return parsed.data;
}

export function parseVoiceTranscript(input: unknown): string {
  const parsed = transcriptSchema.safeParse(input);
  if (!parsed.success) {
    throw new VoiceRecordingError("VOICE_TRANSCRIPT_INVALID", 400, "Проверьте распознанный текст перед отправкой.");
  }
  return parsed.data.transcript;
}

export function parseVoiceIdempotencyKey(value: string | null): string {
  const key = value?.trim() || "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new VoiceRecordingError("INVALID_IDEMPOTENCY_KEY", 400, "Некорректный идентификатор загрузки.");
  }
  return key;
}

export async function hashVoiceIntent(intent: VoiceIntent): Promise<string> {
  return sha256Hex(JSON.stringify({
    durationMs: intent.durationMs,
    locale: intent.locale,
    mimeType: intent.mimeType,
    sha256: intent.sha256,
    sizeBytes: intent.sizeBytes,
  }));
}

export function voiceKeyring(raw: string | null | undefined): IdentityKeyring {
  try {
    return parseIdentityKeyring(raw);
  } catch {
    throw new VoiceRecordingError(
      "VOICE_ENCRYPTION_UNAVAILABLE",
      503,
      "Голосовой режим временно недоступен: защищённое хранилище не настроено.",
    );
  }
}

export async function initializeVoiceRecording(input: {
  db: D1Database;
  workspaceId: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  intent: VoiceIntent;
  now?: string;
}): Promise<{ recording: VoiceRecordingRow; replay: boolean }> {
  const existing = await byIdempotency(input.db, input.userId, input.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      throw new VoiceRecordingError("VOICE_IDEMPOTENCY_CONFLICT", 409, "Повторная загрузка не совпадает с исходной.");
    }
    return { recording: existing, replay: true };
  }
  const id = crypto.randomUUID();
  const now = input.now ?? new Date().toISOString();
  const expiresAt = new Date(Date.parse(now) + VOICE_RETENTION_MS).toISOString();
  const suffix = extensionForMime(input.intent.mimeType);
  const objectKey = `voice/${input.workspaceId}/${id}/original.${suffix}`;
  const quarantineKey = `voice/${input.workspaceId}/${id}/upload.${suffix}`;
  try {
    await input.db.prepare(`INSERT INTO voice_recordings (
      id,workspace_id,user_id,idempotency_key,request_hash,object_key,quarantine_key,
      mime_type,size_bytes,duration_ms,sha256,locale,status,expires_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'initiated',?,?,?)`).bind(
      id, input.workspaceId, input.userId, input.idempotencyKey, input.requestHash,
      objectKey, quarantineKey, input.intent.mimeType, input.intent.sizeBytes,
      input.intent.durationMs, input.intent.sha256, input.intent.locale, expiresAt, now, now,
    ).run();
  } catch (error) {
    const replay = await byIdempotency(input.db, input.userId, input.idempotencyKey);
    if (replay?.requestHash === input.requestHash) return { recording: replay, replay: true };
    throw error;
  }
  const recording = await voiceRecordingForUser(input.db, id, input.workspaceId, input.userId);
  if (!recording) throw new TypeError("VOICE_RECORDING_INSERT_NOT_VISIBLE");
  return { recording, replay: false };
}

export async function voiceRecordingForUser(
  db: D1Database,
  id: string,
  workspaceId: string,
  userId: string,
): Promise<VoiceRecordingRow | null> {
  return db.prepare(`SELECT ${VOICE_SELECT} FROM voice_recordings WHERE id=? AND workspace_id=? AND user_id=? LIMIT 1`)
    .bind(id, workspaceId, userId).first<VoiceRecordingRow>();
}

export async function markVoiceUploaded(input: {
  db: D1Database;
  recording: VoiceRecordingRow;
  now?: string;
}): Promise<void> {
  const now = input.now ?? new Date().toISOString();
  const result = await input.db.prepare(`UPDATE voice_recordings
    SET status='uploaded',uploaded_at=?,error_code=NULL,updated_at=?
    WHERE id=? AND workspace_id=? AND user_id=? AND status IN ('initiated','uploaded')`)
    .bind(now, now, input.recording.id, input.recording.workspaceId, input.recording.userId).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new VoiceRecordingError("VOICE_UPLOAD_STATE_INVALID", 409, "Запись уже обработана или удалена.");
  }
}

export async function finalizeVoiceRecording(input: {
  db: D1Database;
  bucket: R2Bucket;
  quarantineBucket: R2Bucket;
  recording: VoiceRecordingRow;
  now?: string;
}): Promise<VoiceRecordingRow> {
  if (input.recording.status === "ready" || input.recording.status === "transcribed" || input.recording.status === "submitted") {
    return input.recording;
  }
  if (input.recording.status !== "uploaded") {
    throw new VoiceRecordingError("VOICE_UPLOAD_STATE_INVALID", 409, "Сначала завершите загрузку аудио.");
  }
  const object = await input.quarantineBucket.get(input.recording.quarantineKey);
  if (!object) throw new VoiceRecordingError("VOICE_UPLOAD_INTEGRITY_FAILED", 422, "Загруженное аудио не найдено.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== input.recording.sizeBytes || await sha256Hex(bytes) !== input.recording.sha256) {
    await input.quarantineBucket.delete(input.recording.quarantineKey);
    throw new VoiceRecordingError("VOICE_UPLOAD_INTEGRITY_FAILED", 422, "Размер или контрольная сумма аудио не совпадает.");
  }
  if (!matchesAudioSignature(input.recording.mimeType, bytes)) {
    await input.quarantineBucket.delete(input.recording.quarantineKey);
    throw new VoiceRecordingError("VOICE_FORMAT_UNSUPPORTED", 415, "Формат аудио не подтверждён по содержимому файла.");
  }
  await input.bucket.put(input.recording.objectKey, bytes, {
    httpMetadata: { contentType: input.recording.mimeType },
    customMetadata: { sha256: input.recording.sha256, retention: "voice-30d" },
  });
  const stored = await input.bucket.head(input.recording.objectKey);
  if (!stored || stored.size !== input.recording.sizeBytes) {
    await input.bucket.delete(input.recording.objectKey);
    throw new VoiceRecordingError("VOICE_UPLOAD_INTEGRITY_FAILED", 422, "Private R2 не подтвердил сохранение аудио.");
  }
  await input.quarantineBucket.delete(input.recording.quarantineKey);
  const now = input.now ?? new Date().toISOString();
  await input.db.prepare(`UPDATE voice_recordings SET status='ready',error_code=NULL,updated_at=?
    WHERE id=? AND workspace_id=? AND user_id=? AND status='uploaded'`)
    .bind(now, input.recording.id, input.recording.workspaceId, input.recording.userId).run();
  const updated = await voiceRecordingForUser(input.db, input.recording.id, input.recording.workspaceId, input.recording.userId);
  if (!updated) throw new TypeError("VOICE_RECORDING_FINALIZE_NOT_VISIBLE");
  return updated;
}

export async function saveEditedVoiceTranscript(input: {
  db: D1Database;
  keyring: IdentityKeyring;
  recording: VoiceRecordingRow;
  transcript: string;
  now?: string;
}): Promise<void> {
  if (input.recording.status !== "transcribed") {
    throw new VoiceRecordingError("VOICE_UPLOAD_STATE_INVALID", 409, "Запись уже отправлена или недоступна.");
  }
  const protectedTranscript = await protectIdentityValue(input.keyring, input.transcript, voiceTranscriptContext(input.recording));
  const now = input.now ?? new Date().toISOString();
  const result = await input.db.prepare(`UPDATE voice_recordings SET
    transcript_ciphertext=?,transcript_iv=?,transcript_key_version=?,updated_at=?
    WHERE id=? AND workspace_id=? AND user_id=? AND status='transcribed'`).bind(
      protectedTranscript.ciphertext, protectedTranscript.iv, protectedTranscript.keyVersion, now,
      input.recording.id, input.recording.workspaceId, input.recording.userId,
    ).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new VoiceRecordingError("VOICE_UPLOAD_STATE_INVALID", 409, "Запись уже отправлена или недоступна.");
  }
}

export async function assertVoiceTranscriptMatches(input: {
  db: D1Database;
  keyring: IdentityKeyring;
  recordingId: string;
  workspaceId: string;
  userId: string;
  question: string;
}): Promise<VoiceRecordingRow> {
  const recording = await voiceRecordingForUser(input.db, input.recordingId, input.workspaceId, input.userId);
  if (!recording || recording.status !== "transcribed") {
    throw new VoiceRecordingError("VOICE_RECORDING_NOT_FOUND", 404, "Голосовая запись недоступна.");
  }
  if (await revealVoiceTranscript(input.keyring, recording) !== input.question.trim()) {
    throw new VoiceRecordingError("VOICE_TRANSCRIPT_MISMATCH", 409, "Сначала подтвердите изменённый текст голосовой записи.");
  }
  return recording;
}

export function linkVoiceRecordingStatement(input: {
  db: D1Database;
  recordingId: string;
  workspaceId: string;
  userId: string;
  conversationId: string;
  messageId: string;
  caseId: string | null;
  now: string;
}): D1PreparedStatement {
  return input.db.prepare(`UPDATE voice_recordings SET status='submitted',conversation_id=?,message_id=?,case_id=?,submitted_at=?,updated_at=?
    WHERE id=? AND workspace_id=? AND user_id=? AND status='transcribed'`).bind(
      input.conversationId, input.messageId, input.caseId, input.now, input.now,
      input.recordingId, input.workspaceId, input.userId,
    );
}

export async function deleteVoiceRecording(input: {
  db: D1Database;
  bucket: R2Bucket;
  quarantineBucket: R2Bucket;
  recording: VoiceRecordingRow;
  now?: string;
}): Promise<void> {
  await Promise.all([
    input.bucket.delete(input.recording.objectKey),
    input.quarantineBucket.delete(input.recording.quarantineKey),
  ]);
  const now = input.now ?? new Date().toISOString();
  await input.db.prepare(`UPDATE voice_recordings SET
    status='deleted',transcript_ciphertext=NULL,transcript_iv=NULL,transcript_key_version=NULL,
    error_code=NULL,deleted_at=?,updated_at=? WHERE id=? AND workspace_id=? AND user_id=? AND status<>'purged'`)
    .bind(now, now, input.recording.id, input.recording.workspaceId, input.recording.userId).run();
}

export async function purgeExpiredVoiceRecordings(input: {
  db: D1Database;
  bucket: R2Bucket;
  quarantineBucket: R2Bucket;
  now?: string;
  limit?: number;
}): Promise<{ eligible: number; purged: number }> {
  const now = input.now ?? new Date().toISOString();
  if (!await voiceSchemaAvailable(input.db)) return { eligible: 0, purged: 0 };
  const rows = await input.db.prepare(`SELECT ${VOICE_SELECT} FROM voice_recordings
    WHERE expires_at<=? AND status<>'purged' ORDER BY expires_at,id LIMIT ?`)
    .bind(now, Math.min(Math.max(input.limit ?? 100, 1), 500)).all<VoiceRecordingRow>();
  let purged = 0;
  for (const recording of rows.results) {
    await Promise.all([
      input.bucket.delete(recording.objectKey),
      input.quarantineBucket.delete(recording.quarantineKey),
    ]);
    const result = await input.db.prepare(`UPDATE voice_recordings SET
      status='purged',transcript_ciphertext=NULL,transcript_iv=NULL,transcript_key_version=NULL,
      error_code=NULL,purged_at=?,updated_at=? WHERE id=? AND expires_at<=? AND status<>'purged'`)
      .bind(now, now, recording.id, now).run();
    purged += Number(result.meta?.changes ?? 0);
  }
  return { eligible: rows.results.length, purged };
}

async function byIdempotency(db: D1Database, userId: string, key: string) {
  return db.prepare(`SELECT ${VOICE_SELECT} FROM voice_recordings WHERE user_id=? AND idempotency_key=? LIMIT 1`)
    .bind(userId, key).first<VoiceRecordingRow>();
}

export async function revealVoiceTranscript(keyring: IdentityKeyring, recording: VoiceRecordingRow): Promise<string> {
  if (!recording.transcriptCiphertext || !recording.transcriptIv || !recording.transcriptKeyVersion) {
    throw new VoiceRecordingError("VOICE_TRANSCRIPT_INVALID", 409, "Распознанный текст недоступен.");
  }
  try {
    return await revealIdentityValue(keyring, {
      ciphertext: recording.transcriptCiphertext,
      iv: recording.transcriptIv,
      keyVersion: recording.transcriptKeyVersion,
    }, voiceTranscriptContext(recording));
  } catch {
    throw new VoiceRecordingError("VOICE_ENCRYPTION_UNAVAILABLE", 503, "Распознанный текст временно недоступен.");
  }
}

export function voiceTranscriptContext(recording: Pick<VoiceRecordingRow, "id" | "userId">) {
  return { purpose: "voice-transcript-v1", subjectId: recording.userId, recordId: recording.id };
}

async function voiceSchemaAvailable(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='voice_recordings'").first<{ count: number }>();
  return Number(row?.count ?? 0) === 1;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "audio/webm") return "webm";
  if (mimeType === "audio/mp4") return "mp4";
  if (mimeType === "audio/mpeg") return "mp3";
  return "wav";
}

function matchesAudioSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === "audio/webm") return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  if (mimeType === "audio/mp4") return bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") {
    return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE";
  }
  if (mimeType === "audio/mpeg") {
    return startsWith(bytes, [0x49, 0x44, 0x33]) || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  }
  return false;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
