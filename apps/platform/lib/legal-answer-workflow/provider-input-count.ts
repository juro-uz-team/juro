import { z } from "zod";
import { withinSignal } from "./lifetime";
import { readProviderJson } from "./provider-http";
import { emitResearchDiagnostic } from "./diagnostics";

/** Count the exact input-bearing Responses fields, including native opaque items and files.
 * Transport/output controls do not contribute input tokens and are not accepted here.
 * Failure preserves the caller's full-window reservation, never a guessed count. */
export async function countProviderInput(request: Record<string, unknown>, apiKey: string,
  signal: AbortSignal, fetchImpl: typeof fetch): Promise<number | null> {
  const local = new AbortController();
  const started = performance.now();
  let inputTokens: number | null = null;
  const timer = setTimeout(() => local.abort(), 3000);
  const countingSignal = AbortSignal.any([signal, local.signal]);
  const payload = Object.fromEntries(["model", "input", "instructions", "parallel_tool_calls", "reasoning", "text", "tool_choice", "tools", "truncation"]
    .filter(key => request[key] !== undefined).map(key => [key, request[key]]));
  try {
    const response = await withinSignal(countingSignal, () => fetchImpl("https://api.openai.com/v1/responses/input_tokens", {
      method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(payload), signal: countingSignal, redirect: "error", cache: "no-store",
    }));
    if (!response.ok) { void response.body?.cancel().catch(() => {}); return null; }
    // An over-window result is still a valid count. The caller must handle
    // capacity explicitly instead of treating it as unavailable and dispatching.
    inputTokens = z.object({ object: z.literal("response.input_tokens"), input_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
      .parse(await readProviderJson(response, countingSignal)).input_tokens;
    return inputTokens;
  } catch { signal.throwIfAborted(); return null; }
  finally {
    emitResearchDiagnostic({ event: "input_count", durationMs: performance.now() - started, inputTokens });
    clearTimeout(timer); local.abort();
  }
}
