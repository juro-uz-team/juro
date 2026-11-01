import { createHash } from "node:crypto";
import { withinSignal } from "./lifetime";

export type OfficialCapture = {
  requestedUrl: string;
  finalUrl: string;
  redirects: { url: string; status: number }[];
  observedAt: string;
  contentType: "text/html" | "application/xhtml+xml" | "application/pdf"
    | "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/tiff" | "image/avif" | "image/heif";
  bytes: Uint8Array;
  byteCount: number;
  sha256: string;
};

export function officialPublisherUrl(value: string): string {
  if (value.length > 8192 || value.trim() !== value || /[\u0000-\u0020\u007f\\]/u.test(value)) {
    throw new Error("PUBLISHER_URL_INVALID");
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(url.hostname)
    || url.username || url.password || url.port) throw new Error("PUBLISHER_URL_INVALID");
  url.hash = "";
  return url.href;
}

/** Public acquisition only: bytes and observation time do not establish legal applicability. */
export function createOfficialCaptures(input: { signal: AbortSignal; fetchImpl?: typeof fetch }) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const pending = new Map<string, Promise<OfficialCapture>>();
  const maximum = 8 * 1024 * 1024;
  const supportedTypes = ["text/html", "application/xhtml+xml", "application/pdf",
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/tiff", "image/avif", "image/heif"];
  async function capture(requestedUrl: string): Promise<OfficialCapture> {
    let url = requestedUrl;
    const redirects: OfficialCapture["redirects"] = [];
    for (let attempt = 0; attempt <= 3; attempt++) {
      input.signal.throwIfAborted();
      const response = await withinSignal(input.signal, () => fetchImpl(url, { method: "GET", redirect: "manual",
        credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: input.signal,
        headers: { Accept: supportedTypes.join(", ") },
      }).then(response => {
        if (input.signal.aborted) { void response.body?.cancel().catch(() => {}); input.signal.throwIfAborted(); }
        return response;
      }));
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        const location = response.headers.get("Location");
        if (!location || attempt === 3) throw new Error("PUBLISHER_REDIRECT_LIMIT");
        redirects.push({ url, status: response.status });
        url = officialPublisherUrl(new URL(location, url).href);
        if (redirects.some(redirect => redirect.url === url)) throw new Error("PUBLISHER_REDIRECT_LOOP");
        continue;
      }
      const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
      if (response.status !== 200 || !response.body
        || !supportedTypes.includes(contentType ?? "")) {
        void response.body?.cancel().catch(() => {});
        throw new Error("PUBLISHER_RESPONSE_UNSUPPORTED");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let byteCount = 0;
      try {
        if (Number(response.headers.get("Content-Length")) > maximum) throw new Error("PUBLISHER_BODY_LIMIT");
        while (true) {
          const next = await withinSignal(input.signal, () => reader.read());
          if (next.done) break;
          byteCount += next.value.byteLength;
          if (byteCount > maximum) throw new Error("PUBLISHER_BODY_LIMIT");
          chunks.push(next.value);
        }
        if (!byteCount) throw new Error("PUBLISHER_BODY_EMPTY");
        const bytes = Buffer.concat(chunks, byteCount);
        return { requestedUrl, finalUrl: url, redirects, observedAt: new Date().toISOString(),
          contentType: contentType as OfficialCapture["contentType"], bytes, byteCount,
          sha256: createHash("sha256").update(bytes).digest("hex") };
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    throw new Error("PUBLISHER_REDIRECT_LIMIT");
  }
  return { async read(value: string): Promise<OfficialCapture> {
    input.signal.throwIfAborted();
    const url = officialPublisherUrl(value);
    let operation = pending.get(url);
    if (!operation) {
      if (pending.size >= 12) throw new Error("PUBLISHER_CAPTURE_LIMIT");
      operation = capture(url);
      pending.set(url, operation);
    }
    const result = await operation;
    input.signal.throwIfAborted();
    return structuredClone(result);
  } };
}
