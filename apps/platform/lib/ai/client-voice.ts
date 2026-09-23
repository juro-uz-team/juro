import type { PlatformLocale } from "../platform/routing";
import type { VoiceRecorderPhase } from "./voice-ui";
import { z } from "zod";

function headers(locale: PlatformLocale, workspaceId?: string) {
  return {"x-juro-csrf": "1", "x-juro-locale": locale,
    ...(workspaceId ? {"x-juro-workspace-id": workspaceId} : {})};
}
async function checked(response: Response, locale: PlatformLocale) {
  if (!response.ok) throw new Error(locale === "ru" ? "Голосовая функция временно недоступна." :
    locale === "uz" ? "Ovozli funksiya vaqtincha mavjud emas." : "The voice feature is temporarily unavailable.");
  return response;
}
export async function deleteVoiceRecording(recordingId: string, locale: PlatformLocale, workspaceId?: string) {
  await checked(await fetch(`/api/platform/voice/recordings/${encodeURIComponent(recordingId)}`,
    {method: "DELETE", headers: headers(locale, workspaceId)}), locale);
}
export async function uploadAndTranscribeVoice(input: {blob: Blob; durationMs: number; locale: PlatformLocale;
  workspaceId?: string; idempotencyKey: string; signal: AbortSignal; onPhase: (phase: VoiceRecorderPhase) => void;
  onRecording: (id: string) => void}) {
  const requestHeaders = headers(input.locale, input.workspaceId);
  const json = async (url: string, body?: unknown) => (await checked(await fetch(url, {method: "POST",
    headers: {...requestHeaders, "content-type": "application/json", "idempotency-key": input.idempotencyKey},
    body: JSON.stringify(body ?? {}), signal: input.signal}), input.locale)).json();
  input.onPhase("hashing");
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await input.blob.arrayBuffer()))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  input.signal.throwIfAborted();
  const mimeType = input.blob.type.split(";")[0];
  const created = z.object({recording: z.object({id: z.string().uuid(), status: z.string()})}).parse(
    await json("/api/platform/voice/recordings", {mimeType, sizeBytes: input.blob.size,
      durationMs: input.durationMs, locale: input.locale, sha256}));
  const recordingId = created.recording.id;
  input.onRecording(recordingId);
  const base = `/api/platform/voice/recordings/${encodeURIComponent(recordingId)}`;
  if (created.recording.status === "initiated") {
    input.onPhase("uploading");
    await checked(await fetch(base, {method: "PUT", headers: {...requestHeaders, "content-type": mimeType,
      "x-juro-file-sha256": sha256}, body: input.blob, signal: input.signal}), input.locale);
  }
  if (["initiated", "uploaded"].includes(created.recording.status)) {
    input.onPhase("finalizing"); await json(`${base}/finalize`);
  }
  input.onPhase("transcribing");
  const result = z.object({transcript: z.string()}).parse(await json(`${base}/transcribe`));
  return {recordingId, transcript: result.transcript};
}
