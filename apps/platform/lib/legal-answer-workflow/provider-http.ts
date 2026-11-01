import { withinSignal } from "./lifetime";
import { z } from "zod";

const errorLabel = z.enum(["invalid_request_error", "authentication_error", "permission_error", "rate_limit_error",
  "server_error", "insufficient_quota", "rate_limit_exceeded", "invalid_api_key", "model_not_found",
  "unsupported_parameter", "unsupported_value", "invalid_value", "invalid_json_schema", "context_length_exceeded",
  "billing_hard_limit_reached", "account_deactivated", "access_terminated", "unrecognized"]).nullable();
const errorParam = z.enum(["model", "input", "instructions", "reasoning", "reasoning.effort", "max_output_tokens",
  "text", "text.format", "text.format.schema", "service_tier", "prompt_cache_options", "prompt_cache_options.mode",
  "store", "stream", "truncation", "dimensions", "encoding_format", "unrecognized"]).nullable();
export const providerErrorSchema = z.object({ type: errorLabel, code: errorLabel, param: errorParam }).strict();
export type ProviderErrorMetadata = z.infer<typeof providerErrorSchema>;

export function sanitizeProviderError(value: unknown): ProviderErrorMetadata {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  const error = parsed.success ? parsed.data : {};
  const label = (value: unknown) => value == null ? null : errorLabel.safeParse(value).success ? errorLabel.parse(value) : "unrecognized";
  const param = error.param == null ? null : errorParam.safeParse(error.param).success ? errorParam.parse(error.param) : "unrecognized";
  return { type: label(error.type), code: label(error.code), param };
}

/** Store only enumerated diagnostic labels. Provider error messages can echo private input. */
export async function readProviderError(response: Response, signal: AbortSignal): Promise<ProviderErrorMetadata> {
  let error: Record<string, unknown> = {};
  try {
    const body = await readProviderJson(response, signal, 16_384);
    if (body && typeof body === "object" && body.error && typeof body.error === "object") error = body.error;
  } catch { /* HTTP status and request identity remain useful when an error body is malformed or oversized. */ }
  return sanitizeProviderError(error);
}

export async function readProviderJson(response: Response, signal: AbortSignal, maximumBytes = 2 * 1024 * 1024) {
  if (!response.body) throw new Error("PROVIDER_BODY_MISSING");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await withinSignal(signal, () => reader.read());
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) throw new Error("PROVIDER_BODY_LIMIT");
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
