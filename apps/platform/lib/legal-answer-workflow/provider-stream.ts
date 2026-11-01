import { withinSignal } from "./lifetime";
import { readProviderJson, sanitizeProviderError, type ProviderErrorMetadata } from "./provider-http";

/** Consume actual provider deltas; retain the terminal envelope for usage and ordinary validation. */
export async function readProviderResponse(response: Response, signal: AbortSignal, onText?: (text: string) => void,
  onError?: (metadata: ProviderErrorMetadata) => void,
  onArguments?: (name: string, delta: string, index: number) => void): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return readProviderJson(response, signal);
  if (!response.body) throw new Error("PROVIDER_BODY_MISSING");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  const messages = new Set<number>();
  const calls = new Map<number, string>();
  let buffer = "", size = 0;
  try {
    while (true) {
      const next = await withinSignal(signal, () => reader.read());
      size += next.value?.byteLength ?? 0;
      if (size > 8 * 1024 * 1024) throw new Error("PROVIDER_BODY_LIMIT");
      buffer += decoder.decode(next.value, { stream: !next.done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/u.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/u).filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data);
        if (event.type === "response.output_item.added" && event.item?.type === "function_call"
          && typeof event.item.name === "string") calls.set(event.output_index, event.item.name);
        if (event.type === "response.function_call_arguments.delta" && calls.has(event.output_index) && typeof event.delta === "string") {
          signal.throwIfAborted(); onArguments?.(calls.get(event.output_index)!, event.delta, event.output_index);
        }
        if (event.type === "response.output_item.added" && event.item?.type === "message"
          && event.item.role === "assistant" && event.item.phase !== "commentary") messages.add(event.output_index);
        if (event.type === "response.output_text.delta" && messages.has(event.output_index) && typeof event.delta === "string") {
          signal.throwIfAborted(); onText?.(event.delta);
        }
        if (["response.completed", "response.incomplete", "response.failed"].includes(event.type)) {
          if (event.response?.error) onError?.(sanitizeProviderError(event.response.error));
          return event.response;
        }
        if (event.type === "error") {
          onError?.(sanitizeProviderError(event.error ?? event));
          throw new Error("PROVIDER_STREAM_FAILED");
        }
      }
      if (next.done) throw new Error("PROVIDER_OUTPUT_INCOMPLETE");
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
