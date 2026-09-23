import {assertSafeWrite, withApiErrors} from "../../../../../../../lib/document-builder/auth/api";
import {runtimeEnv, requireR2} from "../../../../../../../lib/document-builder/storage/runtime";
import {legalChatOwner} from "../../../../../../../lib/legal-chat/http-owner";
import {transcribeRecording} from "../../../../../../../lib/legal-chat/voice";
import {voiceKeyring, voiceRecordingForUser} from "../../../../../../../lib/ai/voice-recording";
import {voiceLocale, voiceProblem, voiceResponse, voiceErrorResponse} from "../../../../../../../lib/ai/voice-http";
import {assertOperationalFeatureEnabled, operationalEnvironment} from "../../../../../../../lib/operations/operational-feature-flags";

export const POST = withApiErrors(async (request: Request, context: {params: Promise<{recordingId: string}>}) => {
  assertSafeWrite(request);
  const owner = await legalChatOwner(request), locale = voiceLocale(request);
  if (!owner) return voiceProblem("VOICE_RECORDING_NOT_FOUND", 404, locale);
  const env = runtimeEnv();
  await assertOperationalFeatureEnabled({db: owner.db, environment: operationalEnvironment(env.APP_ENV), key: "voice_mode"});
  const {recordingId} = await context.params;
  const recording = await voiceRecordingForUser(owner.db, recordingId, owner.workspaceId, owner.userId);
  if (!recording) return voiceProblem("VOICE_RECORDING_NOT_FOUND", 404, locale);
  try {
    const result = await transcribeRecording({db: owner.db, bucket: requireR2(), recording,
      keyring: voiceKeyring(env.IDENTITY_KEYRING), apiKey: env.OPENAI_API_KEY || (env.AI_PROVIDER === "openai" ? env.AI_PROVIDER_API_KEY : "") || "",
      model: env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe", signal: request.signal});
    return voiceResponse({recordingId, transcript: result.transcript});
  } catch (error) {return voiceErrorResponse(error, locale) ?? Promise.reject(error);}
});
