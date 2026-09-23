import {z} from "zod";
import {assertSafeWrite, withApiErrors} from "../../../../../lib/document-builder/auth/api";
import {runtimeEnv} from "../../../../../lib/document-builder/storage/runtime";
import {legalChatOwner} from "../../../../../lib/legal-chat/http-owner";
import {speakAnswer} from "../../../../../lib/legal-chat/voice";
import {voiceLocale, voiceProblem, voiceErrorResponse} from "../../../../../lib/ai/voice-http";
import {assertOperationalFeatureEnabled, operationalEnvironment} from "../../../../../lib/operations/operational-feature-flags";
import {parseJsonRequest} from "../../../../../lib/request-body";

const schema = z.object({assistantMessageId: z.string().uuid(), voice: z.enum(["marin", "cedar"]), locale: z.enum(["ru", "uz", "en"])}).strict();
export const POST = withApiErrors(async (request: Request) => {
  assertSafeWrite(request);
  const owner = await legalChatOwner(request), locale = voiceLocale(request);
  if (!owner) return voiceProblem("VOICE_RESPONSE_NOT_FOUND", 404, locale);
  const parsed = await parseJsonRequest(request, schema, 4096);
  if (!parsed.ok) return voiceProblem("INVALID_VOICE_REQUEST", 400, locale);
  const env = runtimeEnv();
  await assertOperationalFeatureEnabled({db: owner.db, environment: operationalEnvironment(env.APP_ENV), key: "voice_mode"});
  const message = await owner.db.prepare(`SELECT m.content FROM conversation_messages m
    JOIN conversations c ON c.id=m.conversation_id WHERE m.id=? AND m.author_type='assistant'
    AND c.workspace_id=? AND c.owner_user_id=?`).bind(parsed.data.assistantMessageId, owner.workspaceId, owner.userId).first<{content: string}>();
  if (!message) return voiceProblem("VOICE_RESPONSE_NOT_FOUND", 404, locale);
  try {return await speakAnswer({apiKey: env.OPENAI_API_KEY || (env.AI_PROVIDER === "openai" ? env.AI_PROVIDER_API_KEY : "") || "",
    model: env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: parsed.data.voice, locale: parsed.data.locale,
    text: message.content, signal: request.signal});
  } catch (error) {return voiceErrorResponse(error, locale) ?? Promise.reject(error);}
});
