import assert from "node:assert/strict";
import test from "node:test";

import { parseIdentityKeyring } from "../lib/auth/keyring";
import { voiceErrorResponse, voiceLocale } from "../lib/ai/voice-http";
import {
  assertVoiceTranscriptMatches,
  finalizeVoiceRecording,
  hashVoiceIntent,
  initializeVoiceRecording,
  linkVoiceRecordingStatement,
  markVoiceUploaded,
  parseVoiceIntent,
  purgeExpiredVoiceRecordings,
  saveEditedVoiceTranscript,
  VoiceRecordingError,
} from "../lib/ai/voice-recording";
import { transcribeRecording as transcribeVoiceRecording, speakAnswer as synthesizeAssistantSpeech } from "../lib/legal-chat/voice";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const NOW = "2026-08-04T12:00:00.000Z";

test("voice API errors honor the explicit RU/UZ/EN locale without exposing internal messages", async () => {
  assert.equal(voiceLocale(new Request("https://app.juro.uz/api", { headers: { "x-juro-locale": "uz" } })), "uz");
  assert.equal(voiceLocale(new Request("https://app.juro.uz/api", { headers: { "x-juro-locale": "en" } })), "en");
  const response = voiceErrorResponse(
    new VoiceRecordingError("VOICE_TRANSCRIPTION_UNAVAILABLE", 503, "internal provider detail"),
    "uz",
  );
  assert.ok(response);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "VOICE_TRANSCRIPTION_UNAVAILABLE",
    error: "Nutqni matnga aylantirish vaqtincha mavjud emas.",
  });
  const english = voiceErrorResponse(
    new VoiceRecordingError("VOICE_TRANSCRIPTION_UNAVAILABLE", 503, "internal provider detail"),
    "en",
  );
  assert.ok(english);
  assert.deepEqual(await english.json(), {
    code: "VOICE_TRANSCRIPTION_UNAVAILABLE",
    error: "Speech transcription is temporarily unavailable.",
  });
  assert.equal(parseVoiceIntent({
    mimeType: "audio/webm",
    sizeBytes: 8,
    durationMs: 1_000,
    sha256: "a".repeat(64),
    locale: "en",
  }).locale, "en");
});

function encodedKey(seed: number): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function keyring() {
  return parseIdentityKeyring(JSON.stringify({
    active: "v1",
    versions: { v1: { aead: encodedKey(1), hmac: encodedKey(33) } },
  }));
}

class MemoryR2 {
  objects = new Map<string, { bytes: Uint8Array; type: string; metadata: Record<string, string> }>();

  async put(key: string, value: ReadableStream | ArrayBuffer | Uint8Array, options?: R2PutOptions) {
    let bytes: Uint8Array;
    if (value instanceof ReadableStream) bytes = new Uint8Array(await new Response(value).arrayBuffer());
    else if (value instanceof Uint8Array) bytes = new Uint8Array(value);
    else bytes = new Uint8Array(value);
    this.objects.set(key, {
      bytes,
      type: options?.httpMetadata && "contentType" in options.httpMetadata ? options.httpMetadata.contentType || "application/octet-stream" : "application/octet-stream",
      metadata: options?.customMetadata ?? {},
    });
    return { key, size: bytes.byteLength } as R2Object;
  }

  async get(key: string) {
    const value = this.objects.get(key);
    if (!value) return null;
    return {
      key,
      size: value.bytes.byteLength,
      customMetadata: value.metadata,
      httpMetadata: { contentType: value.type },
      arrayBuffer: async () => value.bytes.slice().buffer,
      body: new Blob([Uint8Array.from(value.bytes).buffer]).stream(),
    } as unknown as R2ObjectBody;
  }

  async head(key: string) {
    const value = this.objects.get(key);
    return value ? ({ key, size: value.bytes.byteLength, customMetadata: value.metadata } as R2Object) : null;
  }

  async delete(key: string | string[]) {
    for (const item of Array.isArray(key) ? key : [key]) this.objects.delete(item);
  }
}

function seedTenant(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"]) {
  sqlite.prepare("INSERT INTO workspaces (id,type,name,locale,created_at,updated_at) VALUES (?,'individual',?,'ru',?,?)")
    .run("workspace-voice", "Voice tenant", NOW, NOW);
  sqlite.prepare("INSERT INTO user_profiles (id,email,full_name,locale,account_type,default_workspace_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("user-voice", "voice@example.test", "Voice User", "ru", "individual", "workspace-voice", NOW, NOW);
  sqlite.prepare("INSERT INTO workspace_members (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES (?,?,?,'owner','active',?,?,?)")
    .run("member-voice", "workspace-voice", "user-voice", NOW, NOW, NOW);
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("voice upload, private R2 finalize, provider transcription, encrypted edit, chat link, and purge form one tenant-safe lifecycle", async () => {
  const fixture = sqliteD1Fixture();
  const primary = new MemoryR2();
  const quarantine = new MemoryR2();
  try {
    seedTenant(fixture.sqlite);
    const bytes = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
    const intent = parseVoiceIntent({
      mimeType: "audio/webm",
      sizeBytes: bytes.byteLength,
      durationMs: 12_000,
      sha256: await sha256(bytes),
      locale: "ru",
    });
    const initialized = await initializeVoiceRecording({
      db: fixture.d1,
      workspaceId: "workspace-voice",
      userId: "user-voice",
      idempotencyKey: "voice-request-0001",
      requestHash: await hashVoiceIntent(intent),
      intent,
      now: NOW,
    });
    assert.equal(initialized.replay, false);
    assert.doesNotMatch(initialized.recording.objectKey, /voice@example|Voice User/);
    await quarantine.put(initialized.recording.quarantineKey, bytes, {
      httpMetadata: { contentType: "audio/webm" },
      customMetadata: { sha256: intent.sha256 },
    });
    await markVoiceUploaded({ db: fixture.d1, recording: initialized.recording, now: NOW });
    const uploaded = { ...initialized.recording, status: "uploaded" };
    const ready = await finalizeVoiceRecording({
      db: fixture.d1,
      bucket: primary as unknown as R2Bucket,
      quarantineBucket: quarantine as unknown as R2Bucket,
      recording: uploaded,
      now: NOW,
    });
    assert.equal(ready.status, "ready");
    assert.equal(quarantine.objects.size, 0);
    assert.ok(primary.objects.has(ready.objectKey));

    const providerRequest: { current: Request | null } = { current: null };
    await assert.rejects(transcribeVoiceRecording({db:fixture.d1,bucket:primary as unknown as R2Bucket,
      keyring:keyring(),apiKey:"test-openai-key",model:"gpt-4o-transcribe",recording:ready,now:NOW,
      fetcher:async()=>{throw Error("Provider unavailable");}}),VoiceRecordingError);
    assert.equal(fixture.sqlite.prepare("SELECT status FROM voice_recordings WHERE id=?").get(ready.id)?.status,"failed");
    const transcribed = await transcribeVoiceRecording({
      db: fixture.d1,
      bucket: primary as unknown as R2Bucket,
      keyring: keyring(),
      apiKey: "test-openai-key",
      model: "gpt-4o-transcribe",
      recording: ready,
      now: NOW,
      fetcher: async (input, init) => {
        providerRequest.current = new Request(input, init);
        return Response.json({ text: "Работодатель задерживает зарплату" });
      },
    });
    assert.equal(transcribed.transcript, "Работодатель задерживает зарплату");
    assert.equal(providerRequest.current?.url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(providerRequest.current?.headers.get("authorization"), "Bearer test-openai-key");
    const form = await providerRequest.current?.formData();
    assert.equal(form?.get("model"), "gpt-4o-transcribe");
    assert.equal(form?.get("language"), "ru");
    const stored = fixture.sqlite.prepare("SELECT transcript_ciphertext AS ciphertext,transcript_iv AS iv,status FROM voice_recordings WHERE id=?")
      .get(ready.id) as { ciphertext: string; iv: string; status: string };
    assert.equal(stored.status, "transcribed");
    assert.doesNotMatch(stored.ciphertext, /Работодатель|зарплату/iu);
    const replay=await transcribeVoiceRecording({db:fixture.d1,bucket:primary as unknown as R2Bucket,
      keyring:keyring(),apiKey:"test-openai-key",model:"gpt-4o-transcribe",recording:ready,now:NOW,
      fetcher:async()=>assert.fail("A replay must not call the provider")});
    assert.equal(replay.transcript,transcribed.transcript);
    await assert.rejects(transcribeVoiceRecording({db:fixture.d1,bucket:primary as unknown as R2Bucket,
      keyring:keyring(),apiKey:"test-openai-key",model:"gpt-4o-transcribe",recording:{...ready,userId:"other-user"},now:NOW,
      fetcher:async()=>assert.fail("Another user must not reach the provider")}),
      (error:unknown)=>error instanceof VoiceRecordingError&&error.code==='VOICE_RECORDING_NOT_FOUND');

    await saveEditedVoiceTranscript({
      db: fixture.d1,
      keyring: keyring(),
      recording: transcribed.recording,
      transcript: "Работодатель задерживает зарплату два месяца",
      now: NOW,
    });
    const confirmed = await assertVoiceTranscriptMatches({
      db: fixture.d1,
      keyring: keyring(),
      recordingId: ready.id,
      workspaceId: "workspace-voice",
      userId: "user-voice",
      question: "Работодатель задерживает зарплату два месяца",
    });
    fixture.sqlite.prepare("INSERT INTO conversations (id,workspace_id,owner_user_id,title,locale,status,created_at,updated_at) VALUES (?,?,?,?,'ru','active',?,?)")
      .run("conversation-voice", "workspace-voice", "user-voice", "Voice question", NOW, NOW);
    fixture.sqlite.prepare("INSERT INTO conversation_messages (id,conversation_id,author_type,content,created_at) VALUES (?,?, 'user',?,?)")
      .run("message-voice", "conversation-voice", "Работодатель задерживает зарплату два месяца", NOW);
    await fixture.d1.batch([linkVoiceRecordingStatement({
      db: fixture.d1,
      recordingId: confirmed.id,
      workspaceId: "workspace-voice",
      userId: "user-voice",
      conversationId: "conversation-voice",
      messageId: "message-voice",
      caseId: null,
      now: NOW,
    })]);
    const linked = fixture.sqlite.prepare("SELECT status,conversation_id AS conversationId,message_id AS messageId FROM voice_recordings WHERE id=?")
      .get(ready.id) as { status: string; conversationId: string; messageId: string };
    assert.deepEqual({ ...linked }, { status: "submitted", conversationId: "conversation-voice", messageId: "message-voice" });

    const retention = await purgeExpiredVoiceRecordings({
      db: fixture.d1,
      bucket: primary as unknown as R2Bucket,
      quarantineBucket: quarantine as unknown as R2Bucket,
      now: "2026-09-03T12:00:01.000Z",
    });
    assert.deepEqual(retention, { eligible: 1, purged: 1 });
    assert.equal(primary.objects.size, 0);
    const purged = fixture.sqlite.prepare("SELECT status,transcript_ciphertext AS transcript FROM voice_recordings WHERE id=?").get(ready.id) as { status: string; transcript: string | null };
    assert.deepEqual({ ...purged }, { status: "purged", transcript: null });
    assert.deepEqual(fixture.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    fixture.sqlite.close();
  }
});

test("TTS is server-side, bounded to a configured model/voice, and returns provider audio without persisting it", async () => {
  const request: { current: Request | null } = { current: null };
  const response = await synthesizeAssistantSpeech({
    apiKey: "test-openai-key",
    model: "gpt-4o-mini-tts",
    voice: "marin",
    text: "Краткий юридический ответ",
    locale: "ru",
    fetcher: async (input, init) => {
      request.current = new Request(input, init);
      return new Response(Uint8Array.from([0x49, 0x44, 0x33]), { headers: { "content-type": "audio/mpeg" } });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(request.current?.url, "https://api.openai.com/v1/audio/speech");
  assert.equal(request.current?.headers.get("authorization"), "Bearer test-openai-key");
  assert.ok(request.current);
  const body = JSON.parse(await request.current.text()) as Record<string, unknown>;
  assert.deepEqual({ model: body.model, voice: body.voice, responseFormat: body.response_format }, {
    model: "gpt-4o-mini-tts", voice: "marin", responseFormat: "mp3",
  });
  assert.match(String(body.instructions), /AI-озвучивание/);
});

test("English TTS sends an explicit English voice instruction", async () => {
  let providerRequest: Request | null = null;
  await synthesizeAssistantSpeech({
    apiKey: "test-openai-key",
    model: "gpt-4o-mini-tts",
    voice: "cedar",
    text: "A concise legal answer",
    locale: "en",
    fetcher: async (input, init) => {
      providerRequest = new Request(input, init);
      return new Response(Uint8Array.from([0x49, 0x44, 0x33]), { headers: { "content-type": "audio/mpeg" } });
    },
  });
  assert.ok(providerRequest);
  const body = JSON.parse(await (providerRequest as Request).text()) as Record<string, unknown>;
  assert.match(String(body.instructions), /Speak calmly, professionally and clearly/);
});

test("voice retention is inert before migration 0066", async () => {
  const db = {
    prepare() { return { async first() { return { count: 0 }; } }; },
  } as unknown as D1Database;
  const bucket = new MemoryR2() as unknown as R2Bucket;
  assert.deepEqual(await purgeExpiredVoiceRecordings({ db, bucket, quarantineBucket: bucket, now: NOW }), {
    eligible: 0,
    purged: 0,
  });
});
