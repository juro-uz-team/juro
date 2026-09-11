import { anthropicCompatibleJsonSchema } from "../../ai/anthropic-schema";
import { runtimeEnv } from "../storage/runtime";
import { resolveAiRuntimeSettings } from "../../ai/runtime-settings";
import {
  ProviderRequestAbortError,
  runProviderRequestWithTimeouts,
} from "../../ai/provider-request-timeout";
import {
  AiUnavailableError,
  type AiProviderUsage,
  type AiStructuredResult,
  type AiProviderAttemptObservation,
} from "./openai";

interface AnthropicMessagesPayload {
  id?: string;
  model?: string;
  content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
    details?: { error_code?: string };
  };
  request_id?: string;
}

export type AnthropicSafeFailureReason =
  | "anthropic_organization_spend_limit"
  | "anthropic_workspace_spend_limit"
  | "anthropic_workspace_header_required"
  | "anthropic_workspace_header_invalid"
  | "anthropic_enforced_spend_limit"
  | "anthropic_credit_balance_low"
  | "anthropic_billing_configuration"
  | "anthropic_workspace_policy"
  | "anthropic_organization_policy"
  | "anthropic_request_model"
  | "anthropic_request_max_tokens"
  | "anthropic_request_messages";

export function safeAnthropicFailureReason(
  status: number,
  payload: AnthropicMessagesPayload,
): AnthropicSafeFailureReason | null {
  if (status === 429
      && payload.error?.type === "rate_limit_error"
      && payload.error.details?.error_code === "enforced_spend_limit_reached") {
    return "anthropic_enforced_spend_limit";
  }
  if (status === 402 && payload.error?.type === "billing_error") {
    return "anthropic_billing_configuration";
  }
  if (status !== 400 || payload.error?.type !== "invalid_request_error") return null;
  const message = payload.error.message;
  if (typeof message !== "string") return null;

  // Anthropic documents these content-free HTTP 400 failure classes. Convert
  // the upstream message to a fixed enum at the provider boundary so callers
  // never need to retain, log, or persist arbitrary provider response text.
  if (message.startsWith("You have reached your specified workspace API usage limits")) {
    return "anthropic_workspace_spend_limit";
  }
  if (message.startsWith("You have reached your specified API usage limits")) {
    return "anthropic_organization_spend_limit";
  }
  if (message.startsWith(
    "anthropic-workspace-id is required when authenticating with an identity-linked API key",
  )) {
    return "anthropic_workspace_header_required";
  }
  if (message === "anthropic-workspace-id header must be a valid workspace ID.") {
    return "anthropic_workspace_header_invalid";
  }
  const normalized = message.toLowerCase();
  if (normalized.includes("credit balance") && normalized.includes("too low")) {
    return "anthropic_credit_balance_low";
  }
  if (normalized.includes("billing") || normalized.includes("payment")) {
    return "anthropic_billing_configuration";
  }
  if (normalized.includes("anthropic-workspace-id") || normalized.includes("workspace")) {
    return "anthropic_workspace_policy";
  }
  if (normalized.includes("organization") || normalized.includes("organisation")) {
    return "anthropic_organization_policy";
  }
  if (normalized.includes("max_tokens") || normalized.includes("maximum number of tokens")) {
    return "anthropic_request_max_tokens";
  }
  if (normalized.includes("model")) {
    return "anthropic_request_model";
  }
  if (normalized.includes("messages") || normalized.includes("content") || normalized.includes("role")) {
    return "anthropic_request_messages";
  }
  return null;
}

function anthropicProviderRequestId(response: Response, payload: AnthropicMessagesPayload): string | null {
  const candidate = response.headers.get("request-id") || payload.request_id;
  return candidate && /^req_[A-Za-z0-9]{8,128}$/u.test(candidate) ? candidate : null;
}

export function hasAnthropicConfiguration(): boolean {
  return Boolean(runtimeEnv().ANTHROPIC_API_KEY);
}

export async function probeAnthropicModelAccess(options: {
  model?: string;
  timeoutMs?: number;
  deadlineAt?: number;
  signal?: AbortSignal;
} = {}): Promise<{ model: string; providerRequestId: string | null }> {
  const configuration = runtimeEnv();
  const apiKey = configuration.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiUnavailableError("Резервный AI-провайдер не подключён: отсутствует серверный ключ.");
  }
  const model = options.model || (await resolveAiRuntimeSettings({
    db: configuration.DB,
    env: configuration,
  })).anthropicChatFallbackModel;
  const timeoutMs = options.timeoutMs ?? 3_000;

  try {
    const { response } = await runProviderRequestWithTimeouts({
      firstByteTimeoutMs: timeoutMs,
      totalResponseTimeoutMs: timeoutMs,
      deadlineAt: options.deadlineAt,
      callerSignal: options.signal,
      start: (signal) => fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal,
      }),
      consume: async (response) => {
        if (response.body) await response.body.cancel();
        return { response };
      },
    });
    const providerRequestId = anthropicProviderRequestId(response, {});
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 409
        || response.status === 429 || response.status >= 500;
      throw new AiUnavailableError(
        "Резервный AI-провайдер не подтвердил доступ к настроенной модели.",
        "PROVIDER_UNAVAILABLE",
        retryable,
        response.status,
        null,
        providerRequestId,
      );
    }
    return { model, providerRequestId };
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error;
    if (error instanceof ProviderRequestAbortError) {
      if (error.reason === "caller") {
        throw new AiUnavailableError("AI-запрос отменён пользователем.", "AI_CANCELLED", false);
      }
      throw new AiUnavailableError(
        error.reason === "first_byte_timeout"
          ? "Резервный AI-провайдер не начал проверку модели в допустимое время."
          : "Проверка доступа к модели резервного AI-провайдера превысила допустимое время.",
        "PROVIDER_TIMEOUT",
        true,
        null,
        error.reason,
      );
    }
    throw new AiUnavailableError(
      "Резервный AI-провайдер временно недоступен.",
      "PROVIDER_UNAVAILABLE",
      true,
    );
  }
}

export async function probeAnthropicConnectivity(options: {
  model?: string;
  timeoutMs?: number;
  deadlineAt?: number;
  signal?: AbortSignal;
} = {}): Promise<{ providerResponseId: string | null }> {
  const configuration = runtimeEnv();
  const apiKey = configuration.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiUnavailableError("Резервный AI-провайдер не подключён: отсутствует серверный ключ.");
  }
  const model = options.model || (await resolveAiRuntimeSettings({
    db: configuration.DB,
    env: configuration,
  })).anthropicChatFallbackModel;
  const timeoutMs = options.timeoutMs ?? 5_000;

  try {
    const { response, payload } = await runProviderRequestWithTimeouts({
      firstByteTimeoutMs: timeoutMs,
      totalResponseTimeoutMs: timeoutMs,
      deadlineAt: options.deadlineAt,
      callerSignal: options.signal,
      start: (signal) => fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: "user", content: "Reply OK." }],
        }),
        signal,
      }),
      consume: async (response) => ({
        response,
        payload: await response.json().catch(() => ({})) as AnthropicMessagesPayload,
      }),
    });
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 409
        || response.status === 429 || response.status >= 500;
      throw Object.assign(new AiUnavailableError(
        "Резервный AI-провайдер не прошёл проверку соединения.",
        "PROVIDER_UNAVAILABLE",
        retryable,
        response.status,
        payload.error?.type ?? null,
        anthropicProviderRequestId(response, payload),
      ), {
        providerFailureReason: safeAnthropicFailureReason(response.status, payload),
      });
    }
    return {
      providerResponseId: payload.id || anthropicProviderRequestId(response, payload),
    };
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error;
    if (error instanceof ProviderRequestAbortError) {
      if (error.reason === "caller") {
        throw new AiUnavailableError("AI-запрос отменён пользователем.", "AI_CANCELLED", false);
      }
      throw new AiUnavailableError(
        error.reason === "first_byte_timeout"
          ? "Резервный AI-провайдер не начал проверочный ответ в допустимое время."
          : "Проверка соединения с резервным AI-провайдером превысила допустимое время.",
        "PROVIDER_TIMEOUT",
        true,
        null,
        error.reason,
      );
    }
    throw new AiUnavailableError(
      "Резервный AI-провайдер временно недоступен.",
      "PROVIDER_UNAVAILABLE",
      true,
    );
  }
}

const anthropicJsonEnvelopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["payload_json"],
  properties: {
    payload_json: {
      type: "string",
      description: "A JSON string containing the complete JURO result.",
    },
  },
} as const;

export function parseAnthropicJsonEnvelope(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Anthropic tool input must be an object.");
  }
  const payloadJson = (input as { payload_json?: unknown }).payload_json;
  if (typeof payloadJson !== "string") {
    throw new TypeError("Anthropic tool input must contain payload_json.");
  }
  return JSON.parse(payloadJson);
}

export async function callAnthropicStructured<T>(options: {
  instructions: string;
  input: unknown;
  schema: Record<string, unknown>;
  parse: (value: unknown) => T;
  timeoutMs?: number;
  firstByteTimeoutMs?: number;
  totalResponseTimeoutMs?: number;
  /** Absolute request deadline shared with caller orchestration. */
  deadlineAt?: number;
  requestId?: string;
  model?: string;
  maxAttempts?: 1 | 2;
  signal?: AbortSignal;
  strictOutput?: boolean;
  /** Keep interactive structured results bounded without affecting document analysis. */
  maxTokens?: number;
  onAttemptFinished?: (observation: AiProviderAttemptObservation) => void | Promise<void>;
}): Promise<AiStructuredResult<T>> {
  const configuration = runtimeEnv();
  const apiKey = configuration.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiUnavailableError("Резервный AI-провайдер не подключён: отсутствует серверный ключ.");
  }
  const model = options.model || (await resolveAiRuntimeSettings({
    db: configuration.DB,
    env: configuration,
  })).anthropicChatFallbackModel;
  const startedAt = Date.now();
  const totalUsage: AiProviderUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const maxAttempts = options.maxAttempts ?? 2;
  const legacyTimeoutMs = options.timeoutMs ?? 45_000;
  const firstByteTimeoutMs = options.firstByteTimeoutMs ?? legacyTimeoutMs;
  const totalResponseTimeoutMs = options.totalResponseTimeoutMs ?? legacyTimeoutMs;
  const providerSchema = anthropicCompatibleJsonSchema(options.schema);
  const systemInstructions = options.strictOutput === false
    ? `${options.instructions}\n\nCall emit_result exactly once. Its payload_json field must be a JSON string matching this schema: ${JSON.stringify(providerSchema)}`
    : options.instructions;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new AiUnavailableError("AI-запрос отменён пользователем.", "AI_CANCELLED", false);
    }
    const attemptStartedAt = Date.now();
    let attemptUsage: AiProviderUsage | null = null;
    let attemptOutcome: AiProviderAttemptObservation["outcome"] = "failed";
    let attemptErrorCode: AiProviderAttemptObservation["errorCode"] = "PROVIDER_UNAVAILABLE";
    let attemptHttpStatus: number | null = null;
    try {
      const { response, payload } = await runProviderRequestWithTimeouts({
        firstByteTimeoutMs,
        totalResponseTimeoutMs,
        deadlineAt: options.deadlineAt,
        callerSignal: options.signal,
        start: (signal) => fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: options.maxTokens ?? 8_192,
            system: systemInstructions,
            messages: [{
              role: "user",
              content: typeof options.input === "string" ? options.input : JSON.stringify(options.input),
            }],
            ...(options.strictOutput === false ? {
              tools: [{
                name: "emit_result",
                description: "Return the complete validated JURO result.",
                input_schema: anthropicJsonEnvelopeSchema,
              }],
              tool_choice: { type: "tool", name: "emit_result" },
            } : { output_config: {
              format: {
                type: "json_schema",
                schema: providerSchema,
              },
            } }),
          }),
          signal,
        }),
        consume: async (response) => ({
          response,
          payload: await response.json().catch(() => ({})) as AnthropicMessagesPayload,
        }),
      });
      attemptHttpStatus = response.status;
      if (payload.usage) attemptUsage = {
        inputTokens: (payload.usage.input_tokens ?? 0) + (payload.usage.cache_read_input_tokens ?? 0)
          + (payload.usage.cache_creation_input_tokens ?? 0),
        outputTokens: payload.usage.output_tokens ?? 0,
        cachedInputTokens: payload.usage.cache_read_input_tokens ?? 0,
      };
      totalUsage.inputTokens += attemptUsage?.inputTokens ?? 0;
      totalUsage.outputTokens += payload.usage?.output_tokens ?? 0;
      totalUsage.cachedInputTokens += payload.usage?.cache_read_input_tokens ?? 0;

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
        if (retryable && attempt < maxAttempts) continue;
        throw new AiUnavailableError(
          `Резервная AI-проверка недоступна: ${payload.error?.message || `HTTP ${response.status}`}`,
          "PROVIDER_UNAVAILABLE",
          retryable,
          response.status,
          payload.error?.type ?? null,
          anthropicProviderRequestId(response, payload),
        );
      }
      if (payload.stop_reason === "refusal") {
        throw new AiUnavailableError("AI-провайдер отказался обрабатывать запрос.", "AI_REFUSED", false);
      }
      if (payload.stop_reason === "max_tokens") {
        attemptErrorCode = "INVALID_AI_OUTPUT";
        if (attempt < maxAttempts) continue;
        throw new AiUnavailableError(
          "Резервный AI-ответ превысил допустимый размер.",
          "INVALID_AI_OUTPUT",
          false,
          null,
          "anthropic_output_max_tokens",
        );
      }
      if (payload.stop_reason && payload.stop_reason !== "end_turn" && payload.stop_reason !== "stop_sequence"
        && !(options.strictOutput === false && payload.stop_reason === "tool_use")) {
        throw new AiUnavailableError(`Резервная AI-проверка не завершена: ${payload.stop_reason}.`, "PROVIDER_UNAVAILABLE", true);
      }
      const toolInput = options.strictOutput === false
        ? payload.content?.find((item) => item.type === "tool_use" && item.name === "emit_result")?.input
        : undefined;
      const text = payload.content?.find((item) => item.type === "text" && item.text)?.text;
      if (options.strictOutput === false ? toolInput === undefined : !text) {
        attemptErrorCode = "INVALID_AI_OUTPUT";
        if (attempt < maxAttempts) continue;
        throw new AiUnavailableError(
          "Резервная AI-проверка не вернула структурированный результат.",
          "INVALID_AI_OUTPUT",
          false,
          null,
          options.strictOutput === false ? "anthropic_tool_result_missing" : "anthropic_text_result_missing",
        );
      }
      let structuredPayload: unknown;
      try {
        structuredPayload = options.strictOutput === false ? parseAnthropicJsonEnvelope(toolInput) : JSON.parse(text!);
      } catch {
        attemptErrorCode = "INVALID_AI_OUTPUT";
        if (attempt < maxAttempts) continue;
        throw new AiUnavailableError(
          "Резервная AI-проверка вернула некорректный структурированный JSON.",
          "INVALID_AI_OUTPUT",
          false,
          null,
          options.strictOutput === false ? "anthropic_envelope_json_invalid" : "anthropic_json_invalid",
        );
      }
      try {
        const data = options.parse(structuredPayload);
        attemptOutcome = "completed";
        attemptErrorCode = null;
        return {
          data,
          provider: "anthropic",
          model: payload.model || model,
          providerResponseId: payload.id || response.headers.get("request-id"),
          attempts: attempt,
          latencyMs: Date.now() - startedAt,
          usage: totalUsage,
          fallbackFromProvider: null,
        };
      } catch {
        attemptErrorCode = "INVALID_AI_OUTPUT";
        if (attempt < maxAttempts) continue;
        throw new AiUnavailableError(
          "Резервная AI-проверка вернула результат вне структурированного контракта.",
          "INVALID_AI_OUTPUT",
          false,
          null,
          options.strictOutput === false ? "anthropic_envelope_schema_invalid" : "anthropic_schema_invalid",
        );
      }
    } catch (error) {
      attemptErrorCode = error instanceof AiUnavailableError ? error.code
        : error instanceof ProviderRequestAbortError ? error.reason === "caller" ? "AI_CANCELLED" : "PROVIDER_TIMEOUT"
          : "PROVIDER_UNAVAILABLE";
      if (error instanceof AiUnavailableError) {
        if (error.retryable && attempt < maxAttempts) continue;
        throw error;
      }
      if (error instanceof ProviderRequestAbortError) {
        if (error.reason === "caller") {
          throw new AiUnavailableError("AI-запрос отменён пользователем.", "AI_CANCELLED", false);
        }
        if (attempt < maxAttempts) continue;
        throw new AiUnavailableError(
          error.reason === "first_byte_timeout"
            ? "Резервный AI-провайдер не начал ответ в допустимое время."
            : "Резервная AI-проверка превысила допустимое полное время ответа.",
          "PROVIDER_TIMEOUT",
          true,
          null,
          error.reason,
        );
      }
      if (attempt >= maxAttempts) {
        throw new AiUnavailableError("Резервная AI-проверка временно недоступна.", "PROVIDER_UNAVAILABLE", true);
      }
    } finally {
      try {
        await options.onAttemptFinished?.({attempt: attempt as 1 | 2, model, elapsedMs: Date.now() - attemptStartedAt,
          outcome: attemptOutcome, errorCode: attemptErrorCode, httpStatus: attemptHttpStatus, usage: attemptUsage});
      } catch {
        console.warn(JSON.stringify({event: "ai.provider_attempt_observation_unavailable"}));
      }
    }
  }
  throw new AiUnavailableError("Резервная AI-проверка временно недоступна.", "PROVIDER_UNAVAILABLE", true);
}
