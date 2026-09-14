import { runtimeEnv } from "../storage/runtime";
import { readResponsesSse, ResponsesSseError } from "../../ai/responses-sse";
import { openAiCompatibleJsonSchema } from "../../ai/openai-schema";
import {
  ProviderRequestAbortError,
  runProviderRequestWithTimeouts,
  type ProviderRequestFirstContentTiming,
} from "../../ai/provider-request-timeout";
import { resolveAiRuntimeSettings } from "../../ai/runtime-settings";

export type AiProviderErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "INVALID_AI_OUTPUT"
  | "AI_REFUSED"
  | "AI_CANCELLED"
  | "PROVIDER_CIRCUIT_OPEN"
  | "ANTHROPIC_PREFLIGHT_FAILED"
  | "ANTHROPIC_REQUEST_FAILED"
  | "ANTHROPIC_POSTPROCESS_FAILED";

export class AiUnavailableError extends Error {
  readonly code: AiProviderErrorCode;
  readonly retryable: boolean;
  readonly providerStatus: number | null;
  readonly providerErrorType: string | null;
  readonly providerRequestId: string | null;

  constructor(
    message: string,
    code: AiProviderErrorCode = "PROVIDER_UNAVAILABLE",
    retryable = true,
    providerStatus: number | null = null,
    providerErrorType: string | null = null,
    providerRequestId: string | null = null,
  ) {
    super(message);
    this.name = "AiUnavailableError";
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
    this.providerErrorType = providerErrorType;
    this.providerRequestId = providerRequestId;
  }
}

interface ResponsesApiPayload {
  id?: string;
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    action?: { sources?: Array<{ type?: string; url?: string }> };
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
      annotations?: Array<{ type?: string; url?: string; title?: string }>;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; type?: string; code?: string };
}

export type AiProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type AiStructuredResult<T> = {
  data: T;
  provider: "openai" | "anthropic";
  model: string;
  providerResponseId: string | null;
  attempts: number;
  latencyMs: number;
  usage: AiProviderUsage;
  fallbackFromProvider: "openai" | "anthropic" | null;
  /** True only for a server-built answer copied from already verified spans
   * after every configured synthesis provider failed. */
  sourceFallback?: boolean;
  sourceFallbackReason?: "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "INVALID_AI_OUTPUT";
  /** Provider-observed web URLs only; model-authored URLs are excluded. */
  webSources?: Array<{ url: string; title: string | null }>;
};

export type OpenAiWebSearchPolicy =
  | {
    purpose: "official_lex_discovery";
    allowedDomains: readonly ("lex.uz" | "www.lex.uz")[];
  }
  | {
    purpose: "secondary_research";
  };
export type AiStructuredProgress =
  | { stage: "provider_started"; provider: "openai"; model: string }
  | { stage: "provider_delta"; receivedCharacters: number };

export type AiProviderAttemptObservation = {
  attempt: 1 | 2;
  model: string;
  elapsedMs: number;
  outcome: "completed" | "failed";
  errorCode: AiProviderErrorCode | null;
  httpStatus: number | null;
  usage: AiProviderUsage | null;
};


export function hasAiConfiguration(): boolean {
  const configuration = runtimeEnv();
  return Boolean(configuration.OPENAI_API_KEY || (configuration.AI_PROVIDER === "openai" && configuration.AI_PROVIDER_API_KEY));
}

export async function callOpenAiJson<T>(options: {
  instructions: string;
  input: unknown;
  schemaName: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
  firstByteTimeoutMs?: number;
  totalResponseTimeoutMs?: number;
  /** Absolute request deadline shared with caller orchestration. */
  deadlineAt?: number;
  rawInput?: boolean;
}): Promise<T> {
  const result = await callOpenAiStructured<T>({
    ...options,
    parse: (value) => value as T,
  });
  return result.data;
}

export async function callOpenAiStructured<T>(options: {
  instructions: string;
  input: unknown;
  schemaName: string;
  schema: Record<string, unknown>;
  parse: (value: unknown) => T;
  timeoutMs?: number;
  firstByteTimeoutMs?: number;
  totalResponseTimeoutMs?: number;
  /** Absolute request deadline shared with caller orchestration. */
  deadlineAt?: number;
  rawInput?: boolean;
  requestId?: string;
  model?: string;
  maxAttempts?: 1 | 2;
  /** Content-free hook invoked immediately before each real HTTP attempt. */
  onAttempt?: (input: { attempt: 1 | 2; model: string }) => void | Promise<void>;
  /** Observes each attempt, including rejected output and unknown timeout usage. */
  onAttemptFinished?: (observation: AiProviderAttemptObservation) => void | Promise<void>;
  signal?: AbortSignal;
  onProgress?: (event: AiStructuredProgress) => void | Promise<void>;
  /**
   * Diagnostic-only timing from the first actual streaming provider delta.
   * It deliberately carries no model output or request content.
   */
  onFirstContent?: (timing: ProviderRequestFirstContentTiming) => void | Promise<void>;
  /** Server-only accumulated structured output; never forward it to a client or log. */
  onOutputTextBuffer?: (input: { attempt: 1 | 2; text: string }) => void | Promise<void>;
  safetyIdentifier?: string;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | "max";
  /** Optional provider execution mode; omitted callers retain provider defaults. */
  reasoningMode?: "standard" | "pro";
  textVerbosity?: "low" | "medium" | "high";
  /** Bound generated output for latency-sensitive structured interactions. */
  maxOutputTokens?: number;
  /** Browsing is opt-in and constrained to a server-owned purpose. */
  webSearch?: OpenAiWebSearchPolicy;
  /** Bounds provider-managed built-in tool calls for one structured response. */
  maxToolCalls?: number;
}): Promise<AiStructuredResult<T>> {
  const configuration = runtimeEnv();
  const apiKey = configuration.OPENAI_API_KEY || (configuration.AI_PROVIDER === "openai" ? configuration.AI_PROVIDER_API_KEY : undefined);
  if (!apiKey) {
    throw new AiUnavailableError("AI-модель не подключена: отсутствует серверный ключ провайдера.");
  }
  const model = options.model || (await resolveAiRuntimeSettings({
    db: configuration.DB,
    env: configuration,
  })).openaiChatModel;
  const startedAt = Date.now();
  const totalUsage: AiProviderUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const maxAttempts = options.maxAttempts ?? 2;
  const legacyTimeoutMs = options.timeoutMs ?? 45_000;
  const firstByteTimeoutMs = options.firstByteTimeoutMs ?? legacyTimeoutMs;
  const totalResponseTimeoutMs = options.totalResponseTimeoutMs ?? legacyTimeoutMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new AiUnavailableError("AI-запрос отменён пользователем.", "AI_CANCELLED", false);
    }
    await options.onAttempt?.({ attempt: attempt as 1 | 2, model });
    const attemptStartedAt = Date.now();
    let attemptUsage: AiProviderUsage | null = null;
    let attemptOutcome: AiProviderAttemptObservation["outcome"] = "failed";
    let attemptErrorCode: AiProviderErrorCode | null = "PROVIDER_UNAVAILABLE";
    let attemptHttpStatus: number | null = null;
    try {
      await options.onProgress?.({ stage: "provider_started", provider: "openai", model });
      const { response, payload } = await runProviderRequestWithTimeouts({
        firstByteTimeoutMs,
        totalResponseTimeoutMs,
        deadlineAt: options.deadlineAt,
        requireFirstContent: Boolean(options.onProgress),
        onFirstContent: options.onFirstContent,
        callerSignal: options.signal,
        start: (signal) => fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            ...(options.requestId ? { "x-client-request-id": options.requestId } : {}),
          },
          body: JSON.stringify({
            model,
            instructions: options.instructions,
            input: options.rawInput ? options.input : typeof options.input === "string" ? options.input : JSON.stringify(options.input),
            ...(options.safetyIdentifier ? { safety_identifier: options.safetyIdentifier } : {}),
            ...(options.reasoningEffort || options.reasoningMode ? { reasoning: {
              ...(options.reasoningEffort ? {effort:options.reasoningEffort} : {}),
              ...(options.reasoningMode ? {mode:options.reasoningMode} : {}),
            } } : {}),
            ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
            ...(options.webSearch ? {
              tools: [{
                type: "web_search",
                external_web_access: true,
                search_context_size: options.webSearch.purpose === "secondary_research" ? "medium" : "low",
                ...(options.webSearch.purpose === "official_lex_discovery" ? {
                  filters: { allowed_domains: [...options.webSearch.allowedDomains] },
                } : {}),
              }],
              // Discovery must be grounded in an actual provider-observed
              // search call; model memory or a guessed URL is never enough.
              tool_choice: "required",
              include: ["web_search_call.action.sources"],
              ...(options.maxToolCalls
                ? { max_tool_calls: Math.max(1, Math.min(Math.floor(options.maxToolCalls), 8)) }
                : {}),
            } : {}),
            stream: Boolean(options.onProgress),
            text: {
              ...(options.textVerbosity ? { verbosity: options.textVerbosity } : {}),
              format: {
                type: "json_schema",
                name: options.schemaName,
                strict: true,
                schema: openAiCompatibleJsonSchema(options.schema),
              },
            },
          }),
          signal,
        }),
        consume: async (response, _signal, timing) => ({
          response,
          payload: options.onProgress && response.ok
            ? await readOpenAiEventStream(
              response,
              options.onProgress,
              timing.markFirstContent,
              options.onOutputTextBuffer
                ? (text) => options.onOutputTextBuffer?.({ attempt: attempt as 1 | 2, text })
                : undefined,
            )
            : await response.json().catch(() => ({})) as ResponsesApiPayload,
        }),
      });
      attemptHttpStatus = response.status;
      totalUsage.inputTokens += payload.usage?.input_tokens ?? 0;
      totalUsage.outputTokens += payload.usage?.output_tokens ?? 0;
      totalUsage.cachedInputTokens += payload.usage?.input_tokens_details?.cached_tokens ?? 0;
      if (payload.usage) attemptUsage = {
        inputTokens: payload.usage.input_tokens ?? 0,
        outputTokens: payload.usage.output_tokens ?? 0,
        cachedInputTokens: payload.usage.input_tokens_details?.cached_tokens ?? 0,
      };

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
        if (retryable && attempt < maxAttempts) continue;
        throw new AiUnavailableError(
          `AI-проверка недоступна: ${payload.error?.message || `HTTP ${response.status}`}`,
          "PROVIDER_UNAVAILABLE",
          retryable,
          response.status,
          payload.error?.code || payload.error?.type || null,
        );
      }

      const content = payload.output?.flatMap((item) => item.content ?? []) ?? [];
      const refusal = content.find((item) => item.type === "refusal" && item.refusal)?.refusal;
      if (refusal) {
        throw new AiUnavailableError("AI-провайдер отказался обрабатывать запрос.", "AI_REFUSED", false);
      }
      if (payload.status && payload.status !== "completed") {
        const reason = payload.incomplete_details?.reason || payload.status;
        throw new AiUnavailableError(
          `AI-проверка не завершена: ${reason}.`,
          "PROVIDER_UNAVAILABLE",
          true,
          null,
          reason,
        );
      }
      const text = content.find((item) => item.type === "output_text" && item.text)?.text;
      if (!text) {
        attemptErrorCode = "INVALID_AI_OUTPUT";
        if (attempt < maxAttempts) continue;
        throw new AiUnavailableError(
          "AI-проверка не вернула структурированный результат.",
          "INVALID_AI_OUTPUT",
          false,
          null,
          "structured_output_missing",
        );
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch {
        attemptErrorCode = "INVALID_AI_OUTPUT";
        if (attempt < maxAttempts) continue;
        throw new AiUnavailableError(
          "AI-проверка вернула некорректный JSON.",
          "INVALID_AI_OUTPUT",
          false,
          null,
          "structured_json_invalid",
        );
      }
      try {
        const data = options.parse(decoded);
        const webSourceTitles = new Map<string, string>();
        for (const item of payload.output ?? []) {
          for (const contentItem of item.content ?? []) {
            for (const annotation of contentItem.annotations ?? []) {
              if (annotation.type === "url_citation" && annotation.url) {
                webSourceTitles.set(annotation.url, annotation.title?.trim() || "");
              }
            }
          }
        }
        const webSources = [...new Set((payload.output ?? []).flatMap((item) =>
          item.type === "web_search_call"
            ? (item.action?.sources ?? []).flatMap((source) => source.type === "url" && source.url ? [source.url] : [])
            : [],
        ))].map((url) => ({ url, title: webSourceTitles.get(url) || null }));
        attemptOutcome = "completed";
        attemptErrorCode = null;
        return {
          data,
          provider: "openai",
          model: payload.model || model,
          providerResponseId: payload.id || null,
          attempts: attempt,
          latencyMs: Date.now() - startedAt,
          usage: totalUsage,
          fallbackFromProvider: null,
          ...(webSources.length ? { webSources } : {}),
        };
      } catch {
        attemptErrorCode = "INVALID_AI_OUTPUT";
        if (attempt < maxAttempts) continue;
        throw new AiUnavailableError(
          "AI-проверка вернула результат, не соответствующий контракту.",
          "INVALID_AI_OUTPUT",
          false,
          null,
          "structured_contract_invalid",
        );
      }
    } catch (error) {
      if (error instanceof AiUnavailableError) {
        attemptErrorCode = error.code;
        if (error.retryable && attempt < maxAttempts) continue;
        throw error;
      }
      if (error instanceof ProviderRequestAbortError) {
        attemptErrorCode = error.reason === "caller" ? "AI_CANCELLED" : "PROVIDER_TIMEOUT";
        if (error.reason === "caller") {
          throw new AiUnavailableError("AI-запрос отменён пользователем.", "AI_CANCELLED", false);
        }
        if (attempt < maxAttempts) continue;
        const providerErrorType = error.reason === "first_byte_timeout"
          ? "first_byte_timeout"
          : options.onProgress ? "total_stream_timeout" : "total_response_timeout";
        throw new AiUnavailableError(
          error.reason === "first_byte_timeout"
            ? "AI-провайдер не начал ответ в допустимое время."
            : "AI-проверка превысила допустимое полное время ответа.",
          "PROVIDER_TIMEOUT",
          true,
          null,
          providerErrorType,
        );
      }
      if (attempt >= maxAttempts) {
        throw new AiUnavailableError("AI-проверка временно недоступна.", "PROVIDER_UNAVAILABLE", true);
      }
    } finally {
      try {
        await options.onAttemptFinished?.({ attempt: attempt as 1 | 2, model,
          elapsedMs: Date.now() - attemptStartedAt, outcome: attemptOutcome,
          errorCode: attemptErrorCode, httpStatus: attemptHttpStatus, usage: attemptUsage });
      } catch {
        // Telemetry failure must not alter a validated result or repeat a call.
        console.warn(JSON.stringify({event: "ai.provider_attempt_observation_unavailable"}));
      }
    }
  }
  throw new AiUnavailableError("AI-проверка временно недоступна.", "PROVIDER_UNAVAILABLE", true);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));

  }
  return btoa(binary);
}
async function readOpenAiEventStream(
  response: Response,
  onProgress: (event: AiStructuredProgress) => void | Promise<void>,
  markFirstContent?: () => Promise<void>,
  onOutputTextBuffer?: (text: string) => void | Promise<void>,
): Promise<ResponsesApiPayload> {
  try {
    return await readResponsesSse(response, onProgress, {
      onFirstDelta: async () => { await markFirstContent?.(); },
      onOutputTextBuffer,
    }) as ResponsesApiPayload;
  } catch (error) {
    if (error instanceof ResponsesSseError) {
      throw new AiUnavailableError(error.message, error.code, error.retryable);
    }
    throw error;
  }
}
