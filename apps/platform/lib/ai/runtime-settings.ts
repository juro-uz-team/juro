import { z } from "zod";

import type { PlatformStaffAccess } from "../auth/staff-access";
import type { BuilderRuntimeEnv } from "../document-builder/storage/runtime";
import { runtimeEnv } from "../document-builder/storage/runtime";
import { DEFAULT_ANTHROPIC_MODEL, OPENAI_FAST_CHAT_MODEL, OPENAI_DEEP_CHAT_MODEL } from "./provider-models";
import { aiText, type AiOutputLocale } from "./localization";

const zeroHash = "0".repeat(64);
const modelSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
export const aiResponseToneSchema = z.enum(["clear", "formal", "concise"]);
export const aiRuntimeConfigInputSchema = z.object({
  expectedVersion: z.number().int().min(0),
  openaiChatModel: modelSchema,
  openaiDeepModel: modelSchema,
  anthropicChatFallbackModel: modelSchema,
  anthropicDocumentModel: modelSchema,
  openaiDocumentFallbackModel: modelSchema,
  responseTone: aiResponseToneSchema,
  reason: z.string().trim().min(10).max(500),
}).strict();

export type AiResponseTone = z.infer<typeof aiResponseToneSchema>;
export type AiRuntimeSettings = {
  environment: "development" | "staging" | "production";
  version: number;
  openaiChatModel: string;
  openaiDeepModel: string;
  anthropicChatFallbackModel: string;
  anthropicDocumentModel: string;
  openaiDocumentFallbackModel: string;
  responseTone: AiResponseTone;
  configHash: string;
  source: "environment" | "database";
  createdAt: string | null;
};

export type AiRuntimeModelAllowlist = {
  openai: string[];
  anthropic: string[];
};

type ConfigRow = {
  id: string;
  environment: AiRuntimeSettings["environment"];
  version: number;
  openaiChatModel: string;
  openaiDeepModel: string;
  anthropicChatFallbackModel: string;
  anthropicDocumentModel: string;
  openaiDocumentFallbackModel: string;
  responseTone: AiResponseTone;
  reason: string;
  actorUserId: string;
  actorSessionId: string;
  actorAssignmentId: string;
  actorMfaVerifiedAt: string;
  previousHash: string;
  configHash: string;
  eventHash: string;
  createdAt: string;
};
export type AiRuntimeConfigHistoryRow = ConfigRow;

export class AiRuntimeSettingsError extends Error {
  constructor(
    public readonly code: "AI_SETTINGS_INVALID" | "AI_SETTINGS_MODEL_NOT_ALLOWED" | "AI_SETTINGS_VERSION_CONFLICT" | "AI_SETTINGS_INTEGRITY_FAILED" | "AI_SETTINGS_UNAVAILABLE",
    public readonly status: number,
  ) {
    super(code);
    this.name = "AiRuntimeSettingsError";
  }
}

export function aiRuntimeModelAllowlist(env: BuilderRuntimeEnv = runtimeEnv()): AiRuntimeModelAllowlist {
  const openai = uniqueModels([
    OPENAI_FAST_CHAT_MODEL,
    OPENAI_DEEP_CHAT_MODEL,
    env.OPENAI_CHAT_MODEL,
    env.OPENAI_DEEP_MODEL,
    env.OPENAI_FALLBACK_MODEL,
    env.OPENAI_MODEL,
  ], "gpt-5.6-terra");
  const anthropic = uniqueModels([
    env.ANTHROPIC_DOCUMENT_MODEL,
    env.ANTHROPIC_FALLBACK_MODEL,
  ], DEFAULT_ANTHROPIC_MODEL);
  return { openai, anthropic };
}

export async function resolveAiRuntimeSettings(input: {
  db?: D1Database;
  env?: BuilderRuntimeEnv;
} = {}): Promise<AiRuntimeSettings> {
  const env = input.env ?? runtimeEnv();
  const environment = runtimeEnvironment(env);
  const defaults = await defaultSettings(env, environment);
  if (!input.db) return defaults;
  let rows: ConfigRow[];
  try {
    const result = await input.db.prepare(
      `SELECT id,environment,version,openai_chat_model AS openaiChatModel,
        openai_deep_model AS openaiDeepModel,anthropic_chat_fallback_model AS anthropicChatFallbackModel,
        anthropic_document_model AS anthropicDocumentModel,openai_document_fallback_model AS openaiDocumentFallbackModel,
        response_tone AS responseTone,reason,actor_user_id AS actorUserId,actor_session_id AS actorSessionId,
        actor_assignment_id AS actorAssignmentId,actor_mfa_verified_at AS actorMfaVerifiedAt,
        previous_hash AS previousHash,config_hash AS configHash,event_hash AS eventHash,created_at AS createdAt
       FROM ai_runtime_config_versions WHERE environment=? ORDER BY version ASC`,
    ).bind(environment).all<ConfigRow>();
    rows = result.results;
  } catch (error) {
    if (error instanceof Error && /no such table:\s*ai_runtime_config_versions/i.test(error.message)) return defaults;
    throw new AiRuntimeSettingsError("AI_SETTINGS_UNAVAILABLE", 503);
  }
  if (!rows.length) return defaults;
  await verifyChain(rows, env);
  const latest = rows.at(-1)!;
  return rowToSettings(latest);
}

export async function listAiRuntimeSettingsHistory(input: {
  db: D1Database;
  env?: BuilderRuntimeEnv;
}): Promise<{ current: AiRuntimeSettings; allowlist: AiRuntimeModelAllowlist; history: ConfigRow[] }> {
  const env = input.env ?? runtimeEnv();
  const environment = runtimeEnvironment(env);
  const rows = await input.db.prepare(
    `SELECT id,environment,version,openai_chat_model AS openaiChatModel,
      openai_deep_model AS openaiDeepModel,anthropic_chat_fallback_model AS anthropicChatFallbackModel,
      anthropic_document_model AS anthropicDocumentModel,openai_document_fallback_model AS openaiDocumentFallbackModel,
      response_tone AS responseTone,reason,actor_user_id AS actorUserId,actor_session_id AS actorSessionId,
      actor_assignment_id AS actorAssignmentId,actor_mfa_verified_at AS actorMfaVerifiedAt,
      previous_hash AS previousHash,config_hash AS configHash,event_hash AS eventHash,created_at AS createdAt
     FROM ai_runtime_config_versions WHERE environment=? ORDER BY version ASC`,
  ).bind(environment).all<ConfigRow>();
  if (rows.results.length) await verifyChain(rows.results, env);
  return {
    current: rows.results.length ? await rowToSettings(rows.results.at(-1)!) : await defaultSettings(env, environment),
    allowlist: aiRuntimeModelAllowlist(env),
    history: [...rows.results].reverse().slice(0, 50),
  };
}

export async function createAiRuntimeSettingsVersion(input: {
  db: D1Database;
  env?: BuilderRuntimeEnv;
  staff: PlatformStaffAccess;
  settings: z.input<typeof aiRuntimeConfigInputSchema>;
  now?: Date;
}): Promise<AiRuntimeSettings> {
  const parsed = aiRuntimeConfigInputSchema.safeParse(input.settings);
  if (!parsed.success) throw new AiRuntimeSettingsError("AI_SETTINGS_INVALID", 400);
  if (parsed.data.openaiChatModel !== OPENAI_FAST_CHAT_MODEL || parsed.data.openaiDeepModel !== OPENAI_DEEP_CHAT_MODEL) {
    throw new AiRuntimeSettingsError("AI_SETTINGS_MODEL_NOT_ALLOWED", 400);
  }
  const env = input.env ?? runtimeEnv();
  const environment = runtimeEnvironment(env);
  const current = await resolveAiRuntimeSettings({ db: input.db, env });
  if (current.version !== parsed.data.expectedVersion) {
    throw new AiRuntimeSettingsError("AI_SETTINGS_VERSION_CONFLICT", 409);
  }
  assertAllowedModels(parsed.data, aiRuntimeModelAllowlist(env));
  const now = (input.now ?? new Date()).toISOString();
  const version = current.version + 1;
  const previous = await input.db.prepare(
    "SELECT event_hash AS eventHash FROM ai_runtime_config_versions WHERE environment=? ORDER BY version DESC LIMIT 1",
  ).bind(environment).first<{ eventHash: string }>();
  const previousHash = previous?.eventHash ?? zeroHash;
  const configHash = await configDigest({
    environment,
    version,
    ...parsed.data,
  });
  const id = crypto.randomUUID();
  const assignmentId = input.staff.assignmentIds[0];
  if (!assignmentId) throw new AiRuntimeSettingsError("AI_SETTINGS_INVALID", 400);
  const eventHash = await sha256({
    id, environment, version, configHash, reason: parsed.data.reason,
    actorUserId: input.staff.userId, actorSessionId: input.staff.sessionId,
    actorAssignmentId: assignmentId, actorMfaVerifiedAt: input.staff.mfaVerifiedAt,
    previousHash, createdAt: now,
  });
  try {
    await input.db.prepare(
      `INSERT INTO ai_runtime_config_versions
       (id,environment,version,openai_chat_model,openai_deep_model,anthropic_chat_fallback_model,
        anthropic_document_model,openai_document_fallback_model,response_tone,reason,actor_user_id,
        actor_session_id,actor_assignment_id,actor_mfa_verified_at,previous_hash,config_hash,event_hash,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id, environment, version, parsed.data.openaiChatModel, parsed.data.openaiDeepModel,
      parsed.data.anthropicChatFallbackModel, parsed.data.anthropicDocumentModel,
      parsed.data.openaiDocumentFallbackModel, parsed.data.responseTone, parsed.data.reason,
      input.staff.userId, input.staff.sessionId, assignmentId, input.staff.mfaVerifiedAt,
      previousHash, configHash, eventHash, now,
    ).run();
  } catch (error) {
    if (error instanceof Error && /VERSION_CONFLICT|CHAIN_CONFLICT|UNIQUE constraint/i.test(error.message)) {
      throw new AiRuntimeSettingsError("AI_SETTINGS_VERSION_CONFLICT", 409);
    }
    if (error instanceof Error && /ACCESS_DENIED/i.test(error.message)) {
      throw new AiRuntimeSettingsError("AI_SETTINGS_INVALID", 403);
    }
    throw error;
  }
  return {
    environment,
    version,
    openaiChatModel: parsed.data.openaiChatModel,
    openaiDeepModel: parsed.data.openaiDeepModel,
    anthropicChatFallbackModel: parsed.data.anthropicChatFallbackModel,
    anthropicDocumentModel: parsed.data.anthropicDocumentModel,
    openaiDocumentFallbackModel: parsed.data.openaiDocumentFallbackModel,
    responseTone: parsed.data.responseTone,
    configHash,
    source: "database",
    createdAt: now,
  };
}

export function aiResponseToneInstruction(tone: AiResponseTone, locale: AiOutputLocale): string {
  if (tone === "formal") return aiText(locale, "Используй формальный, точный и профессиональный тон без канцелярской перегрузки.", "Rasmiy, aniq va professional ohangdan foydalan, ortiqcha idoraviy uslubdan qoch.", "Use a formal, precise and professional tone without unnecessary legalese.");
  if (tone === "concise") return aiText(locale, "Пиши максимально кратко, но не опускай правовые основания, риски и необходимые действия.", "Juda qisqa yoz, ammo huquqiy asoslar, xavflar va zarur harakatlarni qoldirma.", "Be as concise as possible without omitting the legal basis, risks or required actions.");
  return aiText(locale, "Пиши ясным профессиональным языком, объясняя юридические термины простыми словами.", "Huquqiy atamalarni sodda so‘zlar bilan tushuntirib, aniq professional tilda yoz.", "Use clear professional English and explain legal terms in plain language.");
}

async function defaultSettings(env: BuilderRuntimeEnv, environment: AiRuntimeSettings["environment"]): Promise<AiRuntimeSettings> {
  const allowlist = aiRuntimeModelAllowlist(env);
  const openaiChatModel = OPENAI_FAST_CHAT_MODEL;
  const openaiDeepModel = OPENAI_DEEP_CHAT_MODEL;
  const anthropicDocumentModel = env.ANTHROPIC_DOCUMENT_MODEL && allowlist.anthropic.includes(env.ANTHROPIC_DOCUMENT_MODEL)
    ? env.ANTHROPIC_DOCUMENT_MODEL : allowlist.anthropic[0];
  const anthropicChatFallbackModel = env.ANTHROPIC_FALLBACK_MODEL && allowlist.anthropic.includes(env.ANTHROPIC_FALLBACK_MODEL)
    ? env.ANTHROPIC_FALLBACK_MODEL : anthropicDocumentModel;
  const openaiDocumentFallbackModel = env.OPENAI_FALLBACK_MODEL && allowlist.openai.includes(env.OPENAI_FALLBACK_MODEL)
    ? env.OPENAI_FALLBACK_MODEL : openaiDeepModel;
  const config = {
    environment, version: 0, openaiChatModel, openaiDeepModel, anthropicChatFallbackModel,
    anthropicDocumentModel, openaiDocumentFallbackModel, responseTone: "clear" as const,
  };
  return { ...config, configHash: await configDigest(config), source: "environment", createdAt: null };
}

async function verifyChain(rows: ConfigRow[], env: BuilderRuntimeEnv): Promise<void> {
  const allowlist = aiRuntimeModelAllowlist(env);
  // Previously accepted Sol records remain authenticated history, never chat routing.
  allowlist.openai.push("gpt-5.6-sol");
  let previousHash = zeroHash;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    try {
      assertAllowedModels(row, allowlist);
      if (row.version !== index + 1 || row.previousHash !== previousHash) throw new Error("chain");
      const expectedConfigHash = await configDigest(row);
      const expectedEventHash = await sha256({
        id: row.id, environment: row.environment, version: row.version, configHash: row.configHash,
        reason: row.reason, actorUserId: row.actorUserId, actorSessionId: row.actorSessionId,
        actorAssignmentId: row.actorAssignmentId, actorMfaVerifiedAt: row.actorMfaVerifiedAt,
        previousHash: row.previousHash, createdAt: row.createdAt,
      });
      if (row.configHash !== expectedConfigHash || row.eventHash !== expectedEventHash) throw new Error("digest");
      previousHash = row.eventHash;
    } catch {
      throw new AiRuntimeSettingsError("AI_SETTINGS_INTEGRITY_FAILED", 503);
    }
  }
}

function assertAllowedModels(value: {
  openaiChatModel: string;
  openaiDeepModel: string;
  anthropicChatFallbackModel: string;
  anthropicDocumentModel: string;
  openaiDocumentFallbackModel: string;
}, allowlist: AiRuntimeModelAllowlist): void {
  const openai = [value.openaiChatModel, value.openaiDeepModel, value.openaiDocumentFallbackModel];
  const anthropic = [value.anthropicChatFallbackModel, value.anthropicDocumentModel];
  if (openai.some((model) => !allowlist.openai.includes(model)) || anthropic.some((model) => !allowlist.anthropic.includes(model))) {
    throw new AiRuntimeSettingsError("AI_SETTINGS_MODEL_NOT_ALLOWED", 400);
  }
}

async function rowToSettings(row: ConfigRow): Promise<AiRuntimeSettings> {
  const settings: AiRuntimeSettings = {
    environment: row.environment,
    version: row.version,
    openaiChatModel: OPENAI_FAST_CHAT_MODEL,
    openaiDeepModel: OPENAI_DEEP_CHAT_MODEL,
    anthropicChatFallbackModel: row.anthropicChatFallbackModel,
    anthropicDocumentModel: row.anthropicDocumentModel,
    openaiDocumentFallbackModel: row.openaiDocumentFallbackModel,
    responseTone: row.responseTone,
    configHash: row.configHash,
    source: "database",
    createdAt: row.createdAt,
  };
  // Audit the effective configuration while preserving the immutable stored chain.
  settings.configHash = await configDigest(settings);
  return settings;
}

function runtimeEnvironment(env: BuilderRuntimeEnv): AiRuntimeSettings["environment"] {
  return env.APP_ENV === "staging" || env.APP_ENV === "production" ? env.APP_ENV : "development";
}

function uniqueModels(values: Array<string | undefined>, fallback: string): string[] {
  const models = [...new Set(values.filter((value): value is string => modelSchema.safeParse(value).success))];
  return models.length ? models : [fallback];
}

async function configDigest(value: {
  environment: AiRuntimeSettings["environment"];
  version: number;
  openaiChatModel: string;
  openaiDeepModel: string;
  anthropicChatFallbackModel: string;
  anthropicDocumentModel: string;
  openaiDocumentFallbackModel: string;
  responseTone: AiResponseTone;
}): Promise<string> {
  return sha256({
    environment: value.environment,
    version: value.version,
    openaiChatModel: value.openaiChatModel,
    openaiDeepModel: value.openaiDeepModel,
    anthropicChatFallbackModel: value.anthropicChatFallbackModel,
    anthropicDocumentModel: value.anthropicDocumentModel,
    openaiDocumentFallbackModel: value.openaiDocumentFallbackModel,
    responseTone: value.responseTone,
  });
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
