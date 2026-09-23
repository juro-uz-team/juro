import { assertSafeWrite, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { requireD1, requireQuarantineR2, requireR2, runtimeEnv } from "../../../../../../lib/document-builder/storage/runtime";
import {
  deleteVoiceRecording,
  markVoiceUploaded,
  parseVoiceTranscript,
  saveEditedVoiceTranscript,
  voiceKeyring,
  voiceRecordingForUser,
} from "../../../../../../lib/ai/voice-recording";
import { publicVoiceRecording, voiceErrorResponse, voiceLocale, voiceProblem, voiceResponse } from "../../../../../../lib/ai/voice-http";
import { legalChatOwner } from "../../../../../../lib/legal-chat/http-owner";
import { requiredContentLength } from "../../../../../../lib/request-body";
import {
  assertOperationalFeatureEnabled,
  operationalEnvironment,
  OperationalFeatureError,
  operationalFeatureMessage,
} from "../../../../../../lib/operations/operational-feature-flags";

type Context = { params: Promise<{ recordingId: string }> };

async function contextFor(request: Request, context: Context) {
  assertSafeWrite(request);
  const owner = await legalChatOwner(request);
  if (!owner) throw new Error("WORKSPACE_UNAVAILABLE");
  const user = {id: owner.userId}, workspace = {id: owner.workspaceId};
  const { recordingId } = await context.params;
  const recording = await voiceRecordingForUser(requireD1(), recordingId, workspace.id, user.id);
  return { user, workspace, recording };
}

export const PUT = withApiErrors(async function PUT(request: Request, context: Context) {
  const state = await contextFor(request, context);
  const locale = voiceLocale(request, state.recording?.locale ?? "ru");
  if (!state.recording) return voiceProblem("VOICE_RECORDING_NOT_FOUND", 404, locale);
  try {
    await assertOperationalFeatureEnabled({
      db: requireD1(),
      environment: operationalEnvironment(runtimeEnv().APP_ENV),
      key: "voice_mode",
    });
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    const contentLength = requiredContentLength(request, state.recording.sizeBytes);
    const sha256 = request.headers.get("x-juro-file-sha256")?.trim().toLowerCase();
    if (
      contentType !== state.recording.mimeType
      || !contentLength.ok
      || contentLength.bytes !== state.recording.sizeBytes
      || sha256 !== state.recording.sha256
      || !request.body
    ) {
      return voiceProblem("VOICE_UPLOAD_INTEGRITY_FAILED", 422, locale);
    }
    if (state.recording.status === "uploaded") {
      const existing = await requireQuarantineR2().head(state.recording.quarantineKey);
      if (existing?.size === state.recording.sizeBytes) return voiceResponse({ recording: publicVoiceRecording(state.recording) });
    }
    if (state.recording.status !== "initiated") {
      return voiceProblem("VOICE_UPLOAD_STATE_INVALID", 409, locale);
    }
    const stored = await requireQuarantineR2().put(state.recording.quarantineKey, request.body, {
      httpMetadata: { contentType: state.recording.mimeType },
      customMetadata: { sha256: state.recording.sha256, lifecycle: "voice-quarantine" },
    });
    if (!stored || stored.size !== state.recording.sizeBytes) {
      await requireQuarantineR2().delete(state.recording.quarantineKey);
      return voiceProblem("VOICE_UPLOAD_INTEGRITY_FAILED", 422, locale);
    }
    await markVoiceUploaded({ db: requireD1(), recording: state.recording });
    const updated = await voiceRecordingForUser(requireD1(), state.recording.id, state.workspace.id, state.user.id);
    return voiceResponse({ recording: updated ? publicVoiceRecording(updated) : publicVoiceRecording(state.recording) });
  } catch (error) {
    if (error instanceof OperationalFeatureError) {
      return voiceResponse({ code: error.code, error: operationalFeatureMessage(locale) }, 503);
    }
    return voiceErrorResponse(error, locale) ?? Promise.reject(error);
  }
});

export const PATCH = withApiErrors(async function PATCH(request: Request, context: Context) {
  const state = await contextFor(request, context);
  const locale = voiceLocale(request, state.recording?.locale ?? "ru");
  if (!state.recording) return voiceProblem("VOICE_RECORDING_NOT_FOUND", 404, locale);
  try {
    const transcript = parseVoiceTranscript(await request.json());
    await saveEditedVoiceTranscript({
      db: requireD1(), keyring: voiceKeyring(runtimeEnv().IDENTITY_KEYRING),
      recording: state.recording, transcript,
    });
    return voiceResponse({ ok: true });
  } catch (error) {
    return voiceErrorResponse(error, locale) ?? Promise.reject(error);
  }
});

export const DELETE = withApiErrors(async function DELETE(request: Request, context: Context) {
  const state = await contextFor(request, context);
  const locale = voiceLocale(request, state.recording?.locale ?? "ru");
  if (!state.recording) return voiceResponse({ ok: true });
  try {
    await deleteVoiceRecording({
      db: requireD1(), bucket: requireR2(), quarantineBucket: requireQuarantineR2(),
      recording: state.recording,
    });
    return voiceResponse({ ok: true });
  } catch (error) {
    return voiceErrorResponse(error, locale) ?? Promise.reject(error);
  }
});
