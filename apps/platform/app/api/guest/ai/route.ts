import { z } from "zod";

import { ApiAuthError, assertSafeWrite } from "../../../../lib/auth/safe-write";
import { parseJsonRequest } from "../../../../lib/auth/input";
import {
  guestAiTurnstileAction,
  validateTurnstile,
} from "../../../../lib/auth/turnstile";
import {
  IdentityKeyringError,
  parseIdentityKeyring,
} from "../../../../lib/auth/keyring";
import { authRequestSecurityContext } from "../../../../lib/auth/request-security-evidence";
import { AiUnavailableError } from "../../../../lib/document-builder/ai/openai";
import {
  requireD1,
  runtimeEnv,
} from "../../../../lib/document-builder/storage/runtime";
import {
  aiProviderStatus,
  legalAiProvider,
} from "../../../../lib/ai/provider";
import {
  enforceLegalDatabaseFreshness,
  parseLegalChatResponse,
} from "../../../../lib/ai/legal-chat-schema";
import { createLegalAiGateway } from "../../../../lib/ai/legal-ai-gateway";
import { legalResearchFailureReason } from "../../../../lib/ai/legal-answer-failure";
import {
  legalDatabaseFreshnessFromAsOf,
} from "../../../../lib/legal/verified-retrieval";
import {
  LEGAL_RETRIEVAL_BUDGET_MS,
  LEGAL_RETRIEVAL_STAGE_TIMEOUT_MS,
  legalRetrievalEnvironment,
  retrieveCorpusAwareLegalSources,
  shouldRetrieveSecondaryInternet,
} from "../../../../lib/legal-corpus/chat-retrieval";
import {recoverLegalSourceCoverage, type LegalSourceCoverageRecovery} from "../../../../lib/legal-corpus/source-coverage-recovery";
import {
  fallbackLegalRetrievalUnderstanding,
  targetQuestionPlanningHints,
  understandLegalRetrievalQuery,
} from "../../../../lib/legal/legal-retrieval-understanding";
import {
  retrieveSecondaryInternetSources,
  type SecondaryInternetRetrieval,
} from "../../../../lib/legal/secondary-internet-retrieval";
import { legalCitationStatements } from "../../../../lib/legal/direct-citation-store";
import { validateFinalSourceObservations } from "../../../../lib/legal/final-source-observation";
import { createSourceObservationClient } from "../../../../lib/legal-corpus/source-observation-service";
import { observeCurrentLexDocument } from "../../../../lib/legal/lex-document-status";
import {
  createAiExecutionBudget,
  type AiExecutionBudget,
} from "../../../../lib/ai/execution-budget";
import { tryRecordAiSloTelemetry } from "../../../../lib/ai/slo-telemetry";
import {
  assertProviderCallAllowed,
  parseProviderEnvironment,
  ProviderCostControlError,
} from "../../../../lib/ai/provider-cost-control";
import {createLegalProviderUsageCollector} from "../../../../lib/ai/legal-provider-usage";
import { parseLegalApplicabilityDate } from "../../../../lib/legal/applicability-date";
import { sha256Json } from "../../../../lib/ai/run-store";
import {
  GuestAiError,
  clearGuestSessionCookie,
  completeGuestAiRun,
  createGuestAiSession,
  failGuestAiRun,
  guestAiEnabled,
  guestSessionCookie,
  latestGuestAiRun,
  latestGuestAiClarificationRun,
  reserveGuestAiRun,
  resolveGuestAiSession,
  revealGuestAiRunQuestion,
  revealGuestAiRunResult,
  type GuestAiRun,
  type GuestAiSession,
} from "../../../../lib/ai/guest-session";
import { resolveAiRuntimeSettings } from "../../../../lib/ai/runtime-settings";
import {
  aiDiscoveryLocale,
  aiText,
  parseAiOutputLocale,
  type AiOutputLocale,
} from "../../../../lib/ai/localization";
import {
  assertOperationalFeatureEnabled,
  operationalEnvironment,
  OperationalFeatureError,
  operationalFeatureMessage,
} from "../../../../lib/operations/operational-feature-flags";

const GUEST_INSTRUCTION_VERSION = "juro-guest-legal-chat-v1";
const requestSchema = z.object({
  question: z.string().trim().min(5).max(4_000),
  locale: z.enum(["ru", "uz", "en"]),
  turnstileToken: z.string().trim().max(2_048).optional(),
  legalContextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

function json(
  body: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  return Response.json(body, { status, headers });
}

function rethrowGuestCancellation(error: unknown, signal: AbortSignal): void {
  if (signal.aborted) signal.throwIfAborted();
  if (error instanceof Error && error.name === "AbortError") throw error;
}

type GuestAiSloContext = {
  db: D1Database;
  budget: AiExecutionBudget;
  correlationId: string | null;
  answerMode: "short";
  reasoningMode: "fast";
  provider: "openai" | "anthropic";
  model: string;
  contextLatencyMs: number | null;
  providerFirstDeltaAtMs: number | null;
  providerStartedAtMs: number | null;
  fallbackFromProvider: "openai" | "anthropic" | null;
};

type GuestAiSloOutcome = {
  outcome: "completed" | "failed" | "timed_out" | "cancelled";
  safeErrorCode:
    | "AI_SLO_TIMEOUT"
    | "AI_SLO_PROVIDER_UNAVAILABLE"
    | "AI_SLO_ABORTED"
    | "AI_SLO_VALIDATION_FAILED"
    | "AI_SLO_PERSISTENCE_FAILED"
    | "AI_SLO_INTERNAL_ERROR"
    | null;
};

function guestAiSloFailureOutcome(code: string, budget: AiExecutionBudget): GuestAiSloOutcome {
  if (code === "AI_CANCELLED" || budget.abortReason === "caller") {
    return { outcome: "cancelled", safeErrorCode: "AI_SLO_ABORTED" };
  }
  if (code === "PROVIDER_TIMEOUT" || budget.abortReason === "overall_timeout") {
    return { outcome: "timed_out", safeErrorCode: "AI_SLO_TIMEOUT" };
  }
  if (code === "INVALID_AI_OUTPUT") {
    return { outcome: "failed", safeErrorCode: "AI_SLO_VALIDATION_FAILED" };
  }
  if (code === "PERSISTENCE_FAILED") {
    return { outcome: "failed", safeErrorCode: "AI_SLO_PERSISTENCE_FAILED" };
  }
  return { outcome: "failed", safeErrorCode: "AI_SLO_PROVIDER_UNAVAILABLE" };
}

function guestAiSloFallback(
  provider: "openai" | "anthropic",
  fallbackFromProvider: "openai" | "anthropic" | null,
) {
  if (provider === "anthropic" && fallbackFromProvider === "openai") return "openai_to_anthropic" as const;
  if (provider === "openai" && fallbackFromProvider === "anthropic") return "anthropic_to_openai" as const;
  return "none" as const;
}

async function recordGuestAiSlo(input: {
  telemetry: GuestAiSloContext | null;
  outcome: GuestAiSloOutcome;
}): Promise<void> {
  const correlationId = input.telemetry?.correlationId;
  if (!input.telemetry || !correlationId) return;
  try {
    const telemetry = input.telemetry;
    const snapshot = telemetry.budget.snapshot();
    const stage = (name: string) => snapshot.stages.find((timing) => timing.stage === name);
    const retrieval = stage("live_lex_retrieval");
    const provider = stage("provider_execution");
    const validation = stage("validation");
    const persistence = stage("persistence");
    const completed = input.outcome.outcome === "completed";
    const firstUsefulLatencyMs = completed
      ? Math.min(persistence?.endedAtMs ?? snapshot.elapsedMs, snapshot.elapsedMs)
      : null;
    await tryRecordAiSloTelemetry({
      db: telemetry.db,
      value: {
        correlationId,
        environment: operationalEnvironment(runtimeEnv().APP_ENV),
        requestKind: "legal_chat",
        authKind: "guest",
        answerMode: telemetry.answerMode,
        reasoningMode: telemetry.reasoningMode,
        provider: telemetry.provider,
        model: telemetry.model,
        outcome: input.outcome.outcome,
        fallback: guestAiSloFallback(telemetry.provider, telemetry.fallbackFromProvider),
        authLatencyMs: null,
        contextLatencyMs: telemetry.contextLatencyMs,
        retrievalLatencyMs: retrieval?.elapsedMs ?? null,
        // Guest requests do not stream provider deltas, so this remains null
        // rather than deriving a fake TTFT from response headers.
        providerTtftMs: null,
        providerTotalMs: provider?.elapsedMs ?? null,
        validationLatencyMs: validation?.elapsedMs ?? null,
        persistenceLatencyMs: persistence?.elapsedMs ?? null,
        endToEndMs: snapshot.elapsedMs,
        firstUsefulStage: completed ? "persistence" : "none",
        firstUsefulLatencyMs,
        safeErrorCode: input.outcome.safeErrorCode,
      },
    });
  } catch {
    // A telemetry write is never allowed to alter a guest session or answer.
  }
}

function publicError(
  error: unknown,
  locale: AiOutputLocale,
  requestUrl: string,
): Response {
  if (error instanceof GuestAiError) {
    const map: Record<GuestAiError["code"], { status: number; ru: string; uz: string; en: string; clear?: boolean }> = {
      GUEST_AI_DISABLED: { status: 404, ru: "Гостевой AI-режим недоступен.", uz: "Mehmon AI rejimi mavjud emas.", en: "Guest AI is unavailable." },
      GUEST_CONFIGURATION_UNAVAILABLE: { status: 503, ru: "Гостевой AI временно недоступен.", uz: "Mehmon AI vaqtincha mavjud emas.", en: "Guest AI is temporarily unavailable." },
      GUEST_SESSION_REQUIRED: { status: 401, ru: "Пройдите проверку перед отправкой вопроса.", uz: "Savol yuborishdan oldin tekshiruvdan o‘ting.", en: "Complete the security check before sending your question.", clear: true },
      GUEST_SESSION_INVALID: { status: 401, ru: "Гостевая сессия недействительна. Пройдите проверку ещё раз.", uz: "Mehmon sessiyasi yaroqsiz. Tekshiruvdan qayta o‘ting.", en: "Your guest session is invalid. Complete the security check again.", clear: true },
      GUEST_SESSION_EXPIRED: { status: 401, ru: "Гостевая сессия истекла. Пройдите проверку ещё раз.", uz: "Mehmon sessiyasi tugadi. Tekshiruvdan qayta o‘ting.", en: "Your guest session has expired. Complete the security check again.", clear: true },
      GUEST_SESSION_CONSUMED: { status: 429, ru: "Гостевой ответ уже использован. Зарегистрируйтесь, чтобы продолжить.", uz: "Mehmon javobi ishlatildi. Davom etish uchun ro‘yxatdan o‘ting.", en: "Your guest answer has been used. Create an account to continue." },
      GUEST_RATE_LIMIT: { status: 429, ru: "Слишком много гостевых сессий. Попробуйте позже.", uz: "Mehmon sessiyalari juda ko‘p. Keyinroq urinib ko‘ring.", en: "Too many guest sessions have been requested. Try again later." },
      GUEST_REQUEST_LIMIT: { status: 429, ru: "Лимит уточняющих попыток исчерпан. Зарегистрируйтесь, чтобы продолжить.", uz: "Aniqlashtirish urinishlari limiti tugadi. Davom etish uchun ro‘yxatdan o‘ting.", en: "The clarification limit has been reached. Create an account to continue." },
      GUEST_RUN_CONFLICT: { status: 409, ru: "Идентификатор запроса уже использован иначе.", uz: "So‘rov identifikatori boshqa so‘rov uchun ishlatilgan.", en: "This request identifier has already been used for a different request." },
      GUEST_RUN_PROCESSING: { status: 202, ru: "Ответ уже формируется.", uz: "Javob tayyorlanmoqda.", en: "Your answer is already being prepared." },
      GUEST_RUN_FAILED: { status: 409, ru: "Предыдущая попытка завершилась ошибкой. Создайте новый запрос.", uz: "Oldingi urinish xato bilan tugadi. Yangi so‘rov yarating.", en: "The previous attempt failed. Create a new request." },
      GUEST_RESERVATION_LOST: { status: 409, ru: "Сессия изменилась во время ответа. Повторите запрос.", uz: "Javob vaqtida sessiya o‘zgardi. So‘rovni takrorlang.", en: "The session changed while the answer was being prepared. Send the request again." },
    };
    const entry = map[error.code];
    return json(
      { code: error.code, error: aiText(locale, entry.ru, entry.uz, entry.en) },
      entry.status,
      entry.clear ? { "set-cookie": clearGuestSessionCookie(requestUrl) } : undefined,
    );
  }
  if (error instanceof IdentityKeyringError) {
    return json({
      code: "GUEST_CONFIGURATION_UNAVAILABLE",
      error: aiText(locale, "Гостевой AI временно недоступен.", "Mehmon AI vaqtincha mavjud emas.", "Guest AI is temporarily unavailable."),
    }, 503);
  }
  if (error instanceof OperationalFeatureError) {
    return json({
      code: error.code,
      error: operationalFeatureMessage(locale),
    }, 503);
  }
  if (error instanceof ApiAuthError) {
    return json({
      code: "REQUEST_REJECTED",
      error: aiText(locale, "Запрос отклонён проверкой безопасности.", "So‘rov xavfsizlik tekshiruvi tomonidan rad etildi.", "The request was rejected by a security check."),
    }, error.status);
  }
  return json({
    code: "GUEST_AI_FAILED",
    error: aiText(locale, "Не удалось обработать запрос.", "So‘rovni qayta ishlash imkoni bo‘lmadi.", "The request could not be processed."),
  }, 500);
}

function configuration() {
  const env = runtimeEnv();
  if (!guestAiEnabled(env)) throw new GuestAiError("GUEST_AI_DISABLED");
  if (!env.IDENTITY_KEYRING) {
    throw new GuestAiError("GUEST_CONFIGURATION_UNAVAILABLE");
  }
  return {
    env,
    db: requireD1(),
    keyring: parseIdentityKeyring(env.IDENTITY_KEYRING),
  };
}

async function sessionForRequest(input: {
  request: Request;
  db: D1Database;
  keyring: ReturnType<typeof parseIdentityKeyring>;
  locale: AiOutputLocale;
  turnstileToken?: string;
}): Promise<{ session: GuestAiSession; setCookie?: string }> {
  try {
    return {
      session: await resolveGuestAiSession({
        db: input.db,
        keyring: input.keyring,
        request: input.request,
      }),
    };
  } catch (error) {
    if (
      !(error instanceof GuestAiError)
      || !["GUEST_SESSION_REQUIRED", "GUEST_SESSION_INVALID", "GUEST_SESSION_EXPIRED"].includes(error.code)
    ) throw error;
  }

  const env = runtimeEnv();
  if (!env.TURNSTILE_SECRET_KEY || !input.turnstileToken) {
    throw new GuestAiError("GUEST_SESSION_REQUIRED");
  }
  const requestUrl = new URL(input.request.url);
  const security = authRequestSecurityContext(input.request);
  const verification = await validateTurnstile({
    secretKey: env.TURNSTILE_SECRET_KEY,
    token: input.turnstileToken,
    remoteIp: security.connectingIp,
    expectedHostname: requestUrl.hostname,
    expectedAction: guestAiTurnstileAction,
  });
  if (verification.status === "unavailable") {
    throw new GuestAiError("GUEST_CONFIGURATION_UNAVAILABLE");
  }
  if (verification.status !== "verified") {
    throw new GuestAiError("GUEST_SESSION_INVALID");
  }
  const created = await createGuestAiSession({
    db: input.db,
    keyring: input.keyring,
    connectingIp: security.connectingIp,
    locale: input.locale,
  });
  return {
    session: created.session,
    setCookie: guestSessionCookie(created.session.id, created.token, input.request.url),
  };
}

async function completedResult(
  keyring: ReturnType<typeof parseIdentityKeyring>,
  run: GuestAiRun,
) {
  return parseLegalChatResponse(JSON.parse(await revealGuestAiRunResult({ keyring, run })));
}

async function guestQuestionWithClarificationContext(input: {
  db: D1Database;
  keyring: ReturnType<typeof parseIdentityKeyring>;
  sessionId: string;
  question: string;
  locale: AiOutputLocale;
}): Promise<string> {
  const previous = await latestGuestAiClarificationRun(input.db, input.sessionId);
  if (!previous) return input.question;
  const [previousQuestion, previousResult] = await Promise.all([
    revealGuestAiRunQuestion({ keyring: input.keyring, run: previous }),
    completedResult(input.keyring, previous),
  ]);
  const questions = previousResult.clarificationQuestions.join("; ");
  return aiText(
    input.locale,
    `${previousQuestion}\n\nJURO запросил уточнение: ${questions}\nОтвет пользователя на уточнение: ${input.question}`,
    `${previousQuestion}\n\nJURO quyidagilarni aniqlashtirishni so‘radi: ${questions}\nFoydalanuvchining aniqlashtirishga javobi: ${input.question}`,
    `${previousQuestion}\n\nJURO asked for clarification: ${questions}\nThe user replied: ${input.question}`,
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const locale = parseAiOutputLocale(url.searchParams.get("locale"));
  try {
    const { env, db, keyring } = configuration();
    let session: GuestAiSession | null = null;
    let result = null;
    let clearCookie = false;
    try {
      session = await resolveGuestAiSession({ db, keyring, request });
      const run = await latestGuestAiRun(db, session.id);
      if (run) result = await completedResult(keyring, run);
    } catch (error) {
      if (
        !(error instanceof GuestAiError)
        || !["GUEST_SESSION_REQUIRED", "GUEST_SESSION_INVALID", "GUEST_SESSION_EXPIRED"].includes(error.code)
      ) throw error;
      clearCookie = error.code !== "GUEST_SESSION_REQUIRED";
    }
    const provider = aiProviderStatus();
    return json({
      enabled: true,
      providerConfigured: provider.configured,
      siteKey: env.TURNSTILE_SITE_KEY ?? null,
      session: session ? {
        state: session.state,
        requestCount: session.requestCount,
        answerCount: session.answerCount,
        expiresAt: session.expiresAt,
      } : null,
      result,
    }, 200, clearCookie ? { "set-cookie": clearGuestSessionCookie(request.url) } : undefined);
  } catch (error) {
    return publicError(error, locale, request.url);
  }
}

export async function POST(request: Request): Promise<Response> {
  let locale: AiOutputLocale = parseAiOutputLocale(request.headers.get("x-juro-locale"));
  let budget: ReturnType<typeof createAiExecutionBudget> | null = null;
  let telemetry: GuestAiSloContext | null = null;
  try {
    assertSafeWrite(request);
    const parsed = await parseJsonRequest(request, requestSchema, 8_192);
    if (!parsed.ok) {
      return json({
        code: parsed.error === "payload_too_large"
          ? "GUEST_AI_PAYLOAD_TOO_LARGE"
          : "INVALID_GUEST_AI_REQUEST",
        error: parsed.error === "payload_too_large"
          ? aiText(locale, "Размер запроса превышает допустимый предел.", "So‘rov hajmi ruxsat etilgan chegaradan oshdi.", "The request exceeds the permitted size limit.")
          : aiText(locale, "Введите вопрос длиной от 5 до 4 000 символов.", "5 dan 4 000 tagacha belgidan iborat savol kiriting.", "Enter a question between 5 and 4,000 characters."),
      }, parsed.error === "payload_too_large" ? 413 : 400);
    }
    locale = parsed.data.locale;
    const applicableAt = parsed.data.legalContextDate
      ? parseLegalApplicabilityDate(parsed.data.legalContextDate)
      : null;
    if (parsed.data.legalContextDate && !applicableAt) {
      return json({ code: "INVALID_LEGAL_CONTEXT_DATE", error: aiText(locale,
        "Укажите существующую дату события не позднее сегодняшнего дня.",
        "Bugungi kundan kech bo‘lmagan haqiqiy voqea sanasini kiriting.",
        "Enter a valid event date that is not later than today.",
      ) }, 400);
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    const { env, db, keyring } = configuration();
    const providerEnvironment = parseProviderEnvironment(env.APP_ENV);
    await assertOperationalFeatureEnabled({
      db,
      environment: operationalEnvironment(env.APP_ENV),
      key: "ai_chat",
    });
    const sessionContext = await sessionForRequest({
      request,
      db,
      keyring,
      locale,
      turnstileToken: parsed.data.turnstileToken,
    });
    if (sessionContext.session.state === "consumed") {
      throw new GuestAiError("GUEST_SESSION_CONSUMED");
    }

    const provider = legalAiProvider();
    const providerStatus = aiProviderStatus();
    if (!provider || !providerStatus.model) {
      return json({
        code: "AI_PROVIDER_UNAVAILABLE",
        error: aiText(locale, "AI-провайдер временно недоступен.", "AI-provayder vaqtincha mavjud emas.", "The AI provider is temporarily unavailable."),
      }, 503, sessionContext.setCookie ? { "set-cookie": sessionContext.setCookie } : undefined);
    }

    const effectiveQuestion = await guestQuestionWithClarificationContext({
      db,
      keyring,
      sessionId: sessionContext.session.id,
      question: parsed.data.question,
      locale,
    });
    const safetyIdentifier = await sha256Json({
      scope: "guest-openai-safety-v1",
      sessionId: sessionContext.session.id,
    });
    const discoveryLocale = aiDiscoveryLocale(locale);
    // Guest chat uses the same public source ladder as authenticated chat:
    // indexed corpus -> live Lex.uz -> secondary internet only when combined
    // official coverage remains weak. It intentionally has no private context.
    const configuredProvider = provider.name === "anthropic" ? "anthropic" : "openai";
    const configuredModel = providerStatus.model;
    budget = createAiExecutionBudget({
      callerSignal: request.signal,
      enforceOverallTimeout: false,
    });
    telemetry = {
      db,
      budget,
      correlationId: null,
      answerMode: "short",
      reasoningMode: "fast",
      provider: configuredProvider,
      model: configuredModel,
      contextLatencyMs: null,
      providerFirstDeltaAtMs: null,
      providerStartedAtMs: null,
      fallbackFromProvider: null,
    };
    let retrievalUnderstanding = fallbackLegalRetrievalUnderstanding(effectiveQuestion);
    const understandingStage = budget.beginStage("query_understanding", { timeoutMs: 9_400 });
    try {
      retrievalUnderstanding = await understandLegalRetrievalQuery({
        query: effectiveQuestion,
        locale,
        requestId: `${idempotencyKey}:understanding`,
        safetyIdentifier,
        signal: understandingStage.signal,
        timeoutMs: 9_000,
        maxAttempts: 1,
      });
      understandingStage.complete();
    } catch (error) {
      understandingStage.fail();
      rethrowGuestCancellation(error, budget.signal);
    }

    const synthesisApplicableAt = applicableAt?.toISOString()
      ?? (retrievalUnderstanding.temporalEndpoint?.kind === "timestamp" ? retrievalUnderstanding.temporalEndpoint.instant : undefined);
    const temporalComparison = applicableAt ? undefined : retrievalUnderstanding.comparison;
    let retrieval: Awaited<ReturnType<typeof retrieveCorpusAwareLegalSources>>;
    const retrievalStage = budget.beginStage("live_lex_retrieval", {
      timeoutMs: LEGAL_RETRIEVAL_STAGE_TIMEOUT_MS,
    });
  const retrievalOptions: Parameters<typeof retrieveCorpusAwareLegalSources>[0] = {
        query: effectiveQuestion,
        locale: discoveryLocale,
        targetService: env.LEGAL_RETRIEVAL_SERVICE,
        targetEnvironment: legalRetrievalEnvironment(env),
        targetQuestionId: idempotencyKey,
        targetPlanningHints: targetQuestionPlanningHints(retrievalUnderstanding, locale),
        requirePlanningHints: true,
        applicableAt: synthesisApplicableAt,
        lexSearchQueries: retrievalUnderstanding.lexSearchQueries,
        signal: retrievalStage.signal,
        limit: 4,
        budgetMs: LEGAL_RETRIEVAL_BUDGET_MS,
      };
    try {
      retrieval = await retrieveCorpusAwareLegalSources(retrievalOptions);
      retrievalStage.complete();
    } catch (error) {
      retrievalStage.fail();
      rethrowGuestCancellation(error, budget.signal);
      retrieval = await retrieveCorpusAwareLegalSources({
        query: "", locale: discoveryLocale, limit: 1, budgetMs: 1,
      });
    }
    const retrieveSecondaryResearch = async (query: string): Promise<SecondaryInternetRetrieval> => {
        const secondaryStage = budget!.beginStage("secondary_web_retrieval", { timeoutMs: 25_000 });
        try {
          const secondary = await retrieveSecondaryInternetSources({
            db,
            query,
            locale: discoveryLocale,
            requestId: `${idempotencyKey}:secondary`,
            safetyIdentifier,
            signal: secondaryStage.signal,
            timeoutMs: 20_000,
          });
          secondaryStage.complete();
          return secondary;
        } catch (error) {
          secondaryStage.fail();
          rethrowGuestCancellation(error, budget!.signal);
          return { sources: [], evidence: [], errors: [{ code: "SECONDARY_RESEARCH_UNAVAILABLE" }] };
        }
    };
    const secondaryInternet: SecondaryInternetRetrieval = !synthesisApplicableAt && !temporalComparison
      && shouldRetrieveSecondaryInternet(retrieval)
      ? await retrieveSecondaryResearch(retrievalUnderstanding.webSearchQuery)
      : { sources: [], evidence: [], errors: [] };
    const allRetrievedSources = [...retrieval.sources, ...secondaryInternet.sources];
    const evidence = [...retrieval.evidence, ...secondaryInternet.evidence];
    const requestHash = await sha256Json({
      question: effectiveQuestion,
      locale,
      answerMode: "short",
      reasoningMode: "fast",
      legalContextDate: parsed.data.legalContextDate ?? null,
    });
    const runtimeSettings = await resolveAiRuntimeSettings({ db, env: runtimeEnv() });
    const instructionHash = await sha256Json({
      version: GUEST_INSTRUCTION_VERSION,
      jurisdiction: "UZ",
      runtimeConfigHash: runtimeSettings.configHash,
    });
    let sourceVersionHash = await sha256Json({
      freshness: retrieval.freshness,
      evidence,
      sources: allRetrievedSources.map((source) => ({
        id: source.id,
        hash: source.contentSha256,
        excerpt: source.excerpt ?? null,
      })),
    });
    const reservation = await reserveGuestAiRun({
      db,
      session: sessionContext.session,
      idempotencyKey,
      requestHash,
      provider: provider.name,
      model: provider.name === "openai"
        ? runtimeSettings.openaiChatModel
        : runtimeSettings.anthropicChatFallbackModel,
      legalDatabaseAsOf: retrieval.legalDatabaseAsOf,
      instructionHash,
      sourceVersionHash,
      keyring,
      question: effectiveQuestion,
    });
    if (telemetry) telemetry.correlationId = reservation.run.correlationId;
    if (reservation.kind === "completed") {
      const result = await completedResult(keyring, reservation.run);
      return json({
        idempotentReplay: true,
        runId: reservation.run.id,
        result,
        session: {
          state: result.responseKind === "answer" ? "consumed" : "available",
          expiresAt: sessionContext.session.expiresAt,
        },
      }, 200, sessionContext.setCookie ? { "set-cookie": sessionContext.setCookie } : undefined);
    }
    if (reservation.kind === "processing") {
      return json({ code: "GUEST_RUN_PROCESSING", runId: reservation.run.id }, 202,
        sessionContext.setCookie ? { "set-cookie": sessionContext.setCookie } : undefined);
    }
    if (reservation.kind === "failed") throw new GuestAiError("GUEST_RUN_FAILED");

    const providerUsage = createLegalProviderUsageCollector({db, environment: providerEnvironment,
      workspaceId: null, userId: null, feature: "guest_legal_chat", runId: reservation.run.id});
    const beforeProviderCall = async (call: {
      provider: "openai" | "anthropic";
      model: string;
      attempt: number;
    }) => {
      try {
        await assertProviderCallAllowed({
          db,
          environment: providerEnvironment,
          provider: call.provider,
        });
      } catch (error) {
        if (error instanceof ProviderCostControlError && error.code === "PROVIDER_CIRCUIT_OPEN") {
          throw new AiUnavailableError(
            "AI-провайдер временно остановлен системой контроля расходов.",
            "PROVIDER_CIRCUIT_OPEN",
            false,
          );
        }
        throw error;
      }
    };


    let sourceRecovery: LegalSourceCoverageRecovery | undefined;
    const recoverEvidence: NonNullable<Parameters<ReturnType<typeof createLegalAiGateway>["generateGroundedAnswer"]>[1]>["recoverEvidence"] = async (request, missingRequirementIds) => {
      const recoveryStage = budget!.beginStage("legal_source_recovery", {timeoutMs: LEGAL_RETRIEVAL_STAGE_TIMEOUT_MS});
      try {
        sourceRecovery = await recoverLegalSourceCoverage({request, missingRequirementIds, initial: retrieval,
          retrievalOptions: {...retrievalOptions, signal: recoveryStage.signal, budgetMs: LEGAL_RETRIEVAL_BUDGET_MS,
            onLiveSearchStarted: undefined},
          secondaryResearch: retrieveSecondaryResearch,
        });
        recoveryStage.complete();
        return sourceRecovery.evidence;
      } catch (error) {
        recoveryStage.fail();
        throw error;
      }
    };
    let aiResult;
    let gatewayResult;
    const providerStage = budget.beginStage("provider_execution");
    try {
      gatewayResult = await createLegalAiGateway(provider).generateGroundedAnswer({
        question: effectiveQuestion,
        retrievalQuery: retrievalUnderstanding.standaloneQuestion,
        coverageRequirements: retrieval.coverageRequirements?.length ? retrieval.coverageRequirements
          : retrievalUnderstanding.requiredConcepts.map((requirement, index) => ({
            id: `requirement-${index + 1}`, statement: requirement.statement,
            priority: requirement.priority ?? "core", sourceIds: [],
            ...(requirement.scopeKind ? {scopeKind: requirement.scopeKind} : {}),
            ...(requirement.origin ? {origin: requirement.origin} : {}),
            ...(requirement.questionContext ? {questionContext: requirement.questionContext} : {}),
            ...(requirement.unresolvedDimensions ? {unresolvedDimensions: requirement.unresolvedDimensions} : {}),
          })),
        locale,
        answerMode: "short",
        reasoningMode: "fast",
        sources: allRetrievedSources,
        legalDatabaseAsOf: retrieval.legalDatabaseAsOf,
        applicableAt: synthesisApplicableAt,
        temporalComparison,
        requestId: reservation.run.correlationId,
        safetyIdentifier,
        runtimeSettings,
      }, { signal: budget.signal, budget, beforeProviderCall, recoverEvidence, onProviderAttemptFinished: providerUsage.observe });
      if (gatewayResult.recoveredEvidence && sourceRecovery) {
        retrieval = sourceRecovery.retrieval;
        allRetrievedSources.splice(0, allRetrievedSources.length, ...gatewayResult.recoveredEvidence.sources);
        evidence.splice(0, evidence.length, ...new Map([...retrieval.evidence, ...secondaryInternet.evidence,
          ...sourceRecovery.secondary.evidence].map(item => [item.sourceId, item])).values());
        sourceVersionHash = await sha256Json({
          freshness: retrieval.freshness, evidence,
          sources: allRetrievedSources.map(source => ({id: source.id, hash: source.contentSha256, excerpt: source.excerpt ?? null})),
        });
      }
      aiResult = {...gatewayResult.run, usage: providerUsage.knownUsage(), attempts: providerUsage.attemptCount()};
      providerStage.complete();
    } catch (error) {
      providerStage.fail();
      const code = error instanceof AiUnavailableError
        ? error.code
        : "PROVIDER_UNAVAILABLE";
      await failGuestAiRun({ db, run: reservation.run, errorCode: code });
      await recordGuestAiSlo({
        telemetry,
        outcome: guestAiSloFailureOutcome(code, budget),
      });
      return json({
        code,
        correlationId: reservation.run.correlationId,
        error: aiText(
          locale,
          "AI-провайдер временно недоступен. Гостевой ответ не использован.",
          "AI-provayder vaqtincha mavjud emas. Mehmon javobi ishlatilmadi.",
          "The AI provider is temporarily unavailable. Your guest answer was not used.",
        ),
      }, code === "AI_REFUSED" || code === "INVALID_AI_OUTPUT" ? 422 : 503,
      sessionContext.setCookie ? { "set-cookie": sessionContext.setCookie } : undefined);
    } finally {
      try {await providerUsage.persist();} catch {
        console.warn(JSON.stringify({event: "guest_ai.provider_usage_deferred", correlationId: reservation.run.correlationId}));
      }
    }

    let result;
    const validationStage = budget.beginStage("validation");
    try {
      const validated = gatewayResult;
      const finalizedSources = await validateFinalSourceObservations({
        sources: allRetrievedSources,
        sourceIds: validated.run.data.sources.map((source) => source.sourceId),
        observe: env.LEGAL_RETRIEVAL_SERVICE ? createSourceObservationClient({
          service: env.LEGAL_RETRIEVAL_SERVICE,
          environment: legalRetrievalEnvironment(env),
        }) : observeCurrentLexDocument,
      });
      result = enforceLegalDatabaseFreshness({
        ...validated.run.data,
        sources: validated.run.data.sources.map((source) => ({
          ...source, verifiedAt: finalizedSources.get(source.sourceId)!.verifiedAt,
        })),
        sourceAccessMode: retrieval.sourceAccessMode,
        sourcesRetrievedAt: retrieval.sourcesRetrievedAt,
        sourceValidationStatus: retrieval.sourceValidationStatus,
        ...(validated.run.data.responseKind === "clarification_required"
          ? {failureReason: legalResearchFailureReason(retrieval.errors)} : {}),
        coverageStatus: validated.run.data.coverageGaps?.length && retrieval.coverageStatus === "good_coverage"
          ? "partial_coverage" as const : retrieval.coverageStatus,
      }, retrieval.freshness, {
        locale,
        answerMode: "short",
        reasoningMode: "fast",
      });
      validationStage.complete();
    } catch (error) {
      validationStage.fail();
      const code = error instanceof Error && error.message === "FINAL_SOURCE_OBSERVATION_UNAVAILABLE"
        ? "SOURCE_OBSERVATION_UNAVAILABLE" : "INVALID_AI_OUTPUT";
      await failGuestAiRun({
        db,
        run: reservation.run,
        errorCode: code,
      });
      await recordGuestAiSlo({
        telemetry: telemetry && { ...telemetry, provider: aiResult.provider, model: aiResult.model, fallbackFromProvider: aiResult.fallbackFromProvider },
        outcome: guestAiSloFailureOutcome(code, budget),
      });
      return json({
        code,
        error: aiText(
          locale,
          "AI-ответ не прошёл проверку. Гостевой ответ не использован.",
          "AI javobi tekshiruvdan o‘tmadi. Mehmon javobi ishlatilmadi.",
          "The AI answer did not pass validation. Your guest answer was not used.",
        ),
      }, code === "SOURCE_OBSERVATION_UNAVAILABLE" ? 503 : 422,
      sessionContext.setCookie ? { "set-cookie": sessionContext.setCookie } : undefined);
    }

    // A disconnected guest request is released. Retrieval and LLM calls keep
    // their own bounded timeouts, so there is no unrelated route-wide cutoff.
    if (budget.signal.aborted) {
      await failGuestAiRun({ db, run: reservation.run, errorCode: "PROVIDER_TIMEOUT" });
      await recordGuestAiSlo({
        telemetry: telemetry && {
          ...telemetry,
          provider: aiResult.provider,
          model: aiResult.model,
          fallbackFromProvider: aiResult.fallbackFromProvider,
        },
        outcome: guestAiSloFailureOutcome("PROVIDER_TIMEOUT", budget),
      });
      return json({
        code: "PROVIDER_TIMEOUT",
        correlationId: reservation.run.correlationId,
        error: aiText(
          locale,
          "AI не успел безопасно сохранить ответ. Гостевой ответ не использован; попробуйте ещё раз.",
          "AI javobni xavfsiz saqlashga ulgurmadi. Mehmon javobi ishlatilmadi; qayta urinib ko‘ring.",
          "The AI could not save the answer safely in time. Your guest answer was not used; try again.",
        ),
      }, 503, sessionContext.setCookie ? { "set-cookie": sessionContext.setCookie } : undefined);
    }

    const persistenceStage = budget.beginStage("persistence");
    try {
      await completeGuestAiRun({
        db,
        keyring,
        run: reservation.run,
        resultJson: JSON.stringify(result),
        responseKind: result.responseKind,
        provider: aiResult.provider,
        model: aiResult.model,
        providerResponseId: aiResult.providerResponseId,
        fallbackFromProvider: aiResult.fallbackFromProvider,
        inputTokens: aiResult.usage.inputTokens,
        outputTokens: aiResult.usage.outputTokens,
        cachedInputTokens: aiResult.usage.cachedInputTokens,
        attempts: aiResult.attempts,
        latencyMs: aiResult.latencyMs,
        sourceVersionHash, legalDatabaseAsOf: retrieval.legalDatabaseAsOf,
        additionalStatements: legalCitationStatements({
          db,
          sources: retrieval.sources,
          citations: result.sources,
          guestRunId: reservation.run.id,
          now: new Date().toISOString(),
          sourceAccessMode: retrieval.sourceAccessMode,
        }),
      });
      persistenceStage.complete();
    } catch (error) {
      persistenceStage.fail();
      await failGuestAiRun({ db, run: reservation.run, errorCode: "PERSISTENCE_FAILED" });
      await recordGuestAiSlo({
        telemetry: telemetry && { ...telemetry, provider: aiResult.provider, model: aiResult.model, fallbackFromProvider: aiResult.fallbackFromProvider },
        outcome: guestAiSloFailureOutcome("PERSISTENCE_FAILED", budget),
      });
      throw error;
    }
    await recordGuestAiSlo({
      telemetry: telemetry && { ...telemetry, provider: aiResult.provider, model: aiResult.model, fallbackFromProvider: aiResult.fallbackFromProvider },
      outcome: { outcome: "completed", safeErrorCode: null },
    });
    return json({
      runId: reservation.run.id,
      correlationId: reservation.run.correlationId,
      result,
      sourceFreshness: legalDatabaseFreshnessFromAsOf(result.legalDatabaseAsOf),
      session: {
        state: result.responseKind === "answer" ? "consumed" : "available",
        requestCount: sessionContext.session.requestCount + 1,
        answerCount: result.responseKind === "answer" ? 1 : 0,
        expiresAt: sessionContext.session.expiresAt,
      },
      technicalDetails: {
        provider: aiResult.provider,
        model: aiResult.model,
        fallbackFromProvider: aiResult.fallbackFromProvider,
      },
    }, 201, sessionContext.setCookie ? { "set-cookie": sessionContext.setCookie } : undefined);
  } catch (error) {
    return publicError(error, locale, request.url);
  } finally {
    budget?.dispose();
  }
}
