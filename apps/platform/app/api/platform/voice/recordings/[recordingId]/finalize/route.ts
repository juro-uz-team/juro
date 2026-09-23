import { assertSafeWrite, withApiErrors } from "../../../../../../../lib/document-builder/auth/api";
import { requireD1, requireQuarantineR2, requireR2, runtimeEnv } from "../../../../../../../lib/document-builder/storage/runtime";
import { finalizeVoiceRecording, voiceRecordingForUser } from "../../../../../../../lib/ai/voice-recording";
import { publicVoiceRecording, voiceErrorResponse, voiceLocale, voiceProblem, voiceResponse } from "../../../../../../../lib/ai/voice-http";
import { legalChatOwner } from "../../../../../../../lib/legal-chat/http-owner";
import {
  assertOperationalFeatureEnabled,
  operationalEnvironment,
  OperationalFeatureError,
  operationalFeatureMessage,
} from "../../../../../../../lib/operations/operational-feature-flags";

type Context = { params: Promise<{ recordingId: string }> };

export const POST = withApiErrors(async function POST(request: Request, context: Context) {
  assertSafeWrite(request);
  const owner = await legalChatOwner(request);
  if (!owner) throw new Error("WORKSPACE_UNAVAILABLE");
  const user = {id: owner.userId}, workspace = {id: owner.workspaceId};
  const { recordingId } = await context.params;
  const recording = await voiceRecordingForUser(requireD1(), recordingId, workspace.id, user.id);
  const locale = voiceLocale(request, recording?.locale ?? "ru");
  if (!recording) return voiceProblem("VOICE_RECORDING_NOT_FOUND", 404, locale);
  try {
    await assertOperationalFeatureEnabled({
      db: requireD1(),
      environment: operationalEnvironment(runtimeEnv().APP_ENV),
      key: "voice_mode",
    });
    const updated = await finalizeVoiceRecording({
      db: requireD1(), bucket: requireR2(), quarantineBucket: requireQuarantineR2(), recording,
    });
    return voiceResponse({ recording: publicVoiceRecording(updated) });
  } catch (error) {
    if (error instanceof OperationalFeatureError) {
      return voiceResponse({ code: error.code, error: operationalFeatureMessage(locale) }, 503);
    }
    return voiceErrorResponse(error, locale) ?? Promise.reject(error);
  }
});
