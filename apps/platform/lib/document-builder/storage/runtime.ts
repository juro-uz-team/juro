import { env } from "cloudflare:workers";

export interface BuilderRuntimeEnv {
  APP_ENV?: "development" | "staging" | "production";
  ASSETS?: Fetcher;
  WORKER_VERSION?: WorkerVersionMetadata;
  LEGAL_RUNTIME_BUILD_ID?: string;
  DB?: D1Database;
  BUCKET?: R2Bucket;
  QUARANTINE_BUCKET?: R2Bucket;
  PLATFORM_ANALYTICS?: AnalyticsEngineDataset;
  LEX_UZ_INDEX?: VectorizeIndex;
  ADVICE_UZ_INDEX?: VectorizeIndex;
  USER_DOCUMENTS_INDEX?: VectorizeIndex;
  EMBEDDING_MODEL?: string;
  LEGAL_LEX_INGESTION_ENABLED?: string;
  LEGAL_LEX_RSS_DISCOVERY_ENABLED?: string;
  LEGAL_ADVICE_INGESTION_ENABLED?: string;
  LEGAL_DIRECT_RETRIEVAL_ENABLED?: string;
  LEGAL_SOURCE_STAFF_API_ENABLED?: string;
  LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST?: string;
  LEGAL_RETRIEVAL_SERVICE?: Fetcher;
  LEGAL_RETRIEVAL_ENVIRONMENT?: "development" | "staging" | "production";
  LAWYER_PROFILE_DIRECTORY_ENABLED?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_CHAT_MODEL?: string;
  /** Dedicated low-latency legal retrieval planner. */
  OPENAI_RETRIEVAL_MODEL?: string;
  OPENAI_DEEP_MODEL?: string;
  OPENAI_FALLBACK_MODEL?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
  OPENAI_TTS_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_DOCUMENT_MODEL?: string;
  ANTHROPIC_FALLBACK_MODEL?: string;
  AI_PROVIDER?: string;
  AI_PROVIDER_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  OPERATIONS_ALERT_EMAIL?: string;
  STATUS_HOSTNAME?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  GUEST_AI_ENABLED?: string;
  STAGING_LEGAL_EVALUATION_ENABLED?: string;
  STAGING_LEGAL_EVALUATION_TOKEN?: string;
  APP_URL?: string;
  PUBLIC_SITE_URL?: string;
  ADMIN_CONSOLE_ORIGIN?: string;
  PAYMENT_PROVIDER?: string;
  PAYMENT_API_KEY?: string;
  PAYMENT_WEBHOOK_SECRET?: string;
  PAYMENT_FOUNDATION_ENABLED?: string;
  PAYMENT_SANDBOX_ENABLED?: string;
  PAYMENT_PRODUCTION_APPROVED?: string;
  PAYMENT_SANDBOX_WEBHOOK_SECRET?: string;
  ALLOW_PLATFORM_AUTH_HEADERS?: string;
  LOCAL_AUTH_BYPASS?: string;
  LOCAL_AUTH_EMAIL?: string;
  LOCAL_AUTH_FULL_NAME?: string;
  LEGISLATION_FEED_PROVIDER?: string;
  LEGISLATION_FEED_API_KEY?: string;
  IDENTITY_KEYRING?: string;
  IDENTITY_PROTECTION_MODE?: string;
  MALWARE_SCANNER?: Fetcher;
  MALWARE_SCAN_QUEUE?: Queue;
  MALWARE_SCAN_ENABLED?: string;
  PUBLIC_DOCUMENT_URL_IMPORT_ENABLED?: string;
}

export class ServiceUnavailableError extends Error {
  readonly code: "D1_UNAVAILABLE" | "R2_UNAVAILABLE";

  constructor(code: "D1_UNAVAILABLE" | "R2_UNAVAILABLE", message: string) {
    super(message);
    this.name = "ServiceUnavailableError";
    this.code = code;
  }
}

export function runtimeEnv(): BuilderRuntimeEnv {
  return env as unknown as BuilderRuntimeEnv;
}

export function requireD1(): D1Database {
  const db = runtimeEnv().DB;
  if (!db) {
    throw new ServiceUnavailableError(
      "D1_UNAVAILABLE",
      "Хранилище документов временно недоступно: отсутствует Cloudflare D1 binding DB.",
    );
  }
  return db;
}

export function requireR2(): R2Bucket {
  const bucket = runtimeEnv().BUCKET;
  if (!bucket) {
    throw new ServiceUnavailableError(
      "R2_UNAVAILABLE",
      "Файловое хранилище временно недоступно: отсутствует Cloudflare R2 binding BUCKET.",
    );
  }
  return bucket;
}

export function requireQuarantineR2(): R2Bucket {
  const bucket = runtimeEnv().QUARANTINE_BUCKET;
  if (!bucket) {
    throw new ServiceUnavailableError(
      "R2_UNAVAILABLE",
      "Карантинное файловое хранилище временно недоступно: отсутствует Cloudflare R2 binding QUARANTINE_BUCKET.",
    );
  }
  return bucket;
}
