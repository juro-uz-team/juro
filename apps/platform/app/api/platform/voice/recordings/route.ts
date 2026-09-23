import { assertSafeWrite, withApiErrors } from "../../../../../lib/document-builder/auth/api";
import { requireD1, runtimeEnv } from "../../../../../lib/document-builder/storage/runtime";
import {
  hashVoiceIntent,
  initializeVoiceRecording,
  parseVoiceIdempotencyKey,
  parseVoiceIntent,
} from "../../../../../lib/ai/voice-recording";
import { publicVoiceRecording, voiceErrorResponse, voiceLocale, voiceProblem, voiceResponse } from "../../../../../lib/ai/voice-http";
import { legalChatOwner } from "../../../../../lib/legal-chat/http-owner";
import { assertOperationalFeatureEnabled, operationalEnvironment, OperationalFeatureError, operationalFeatureMessage } from "../../../../../lib/operations/operational-feature-flags";

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const owner = await legalChatOwner(request);
  if (!owner) throw new Error("WORKSPACE_UNAVAILABLE");
  const user = {id: owner.userId}, workspace = {id: owner.workspaceId};
  const locale = voiceLocale(request);
  try {
    try {
      await assertOperationalFeatureEnabled({ db: requireD1(), environment: operationalEnvironment(runtimeEnv().APP_ENV), key: "voice_mode" });
    } catch (error) {
      if (!(error instanceof OperationalFeatureError)) throw error;
      return voiceResponse({ code: error.code, error: operationalFeatureMessage(locale) }, 503);
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return voiceProblem("INVALID_CONTENT_TYPE", 415, locale);
    }
    const intent = parseVoiceIntent(await request.json());
    const idempotencyKey = parseVoiceIdempotencyKey(request.headers.get("idempotency-key"));
    const result = await initializeVoiceRecording({
      db: requireD1(), workspaceId: workspace.id, userId: user.id,
      idempotencyKey, requestHash: await hashVoiceIntent(intent), intent,
    });
    const recording = publicVoiceRecording(result.recording);
    return voiceResponse({
      recording,
      upload: { method: "PUT", url: `/api/platform/voice/recordings/${encodeURIComponent(recording.id)}` },
    }, result.replay ? 200 : 201, { location: `/api/platform/voice/recordings/${encodeURIComponent(recording.id)}` });
  } catch (error) {
    return voiceErrorResponse(error, locale) ?? Promise.reject(error);
  }
});
