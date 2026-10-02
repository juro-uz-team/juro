export type RequiredContentLength =
  | { ok: true; bytes: number }
  | { ok: false; reason: "missing" | "invalid" | "too_large" };

export const MULTIPART_OVERHEAD_BYTES = 512 * 1024;

export const DEFAULT_PUBLIC_API_BODY_LIMIT_BYTES = 1024 * 1024;
export const DOCUMENT_BUILDER_API_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export type BoundedRequestBody =
  | { ok: true; request: Request }
  | { ok: false; reason: "too_large" };

export function requiredContentLength(
  request: Request,
  maxBytes: number,
): RequiredContentLength {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("INVALID_REQUEST_BODY_LIMIT");
  }
  const raw = request.headers.get("content-length");
  if (raw === null) return { ok: false, reason: "missing" };
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) return { ok: false, reason: "invalid" };
  const bytes = Number(raw);
  if (!Number.isSafeInteger(bytes) || bytes < 1) return { ok: false, reason: "invalid" };
  if (bytes > maxBytes) return { ok: false, reason: "too_large" };
  return { ok: true, bytes };
}

/**
 * Return the common-boundary limit for public API requests that are expected
 * to carry structured bodies. Binary and multipart upload routes keep their
 * existing streaming, checksum, and route-specific size controls.
 */
export function publicApiRequestBodyLimit(
  pathname: string,
  method: string,
): number | null {
  const normalizedMethod = method.toUpperCase();
  if (
    !pathname.startsWith("/api/")
    || normalizedMethod === "GET"
    || normalizedMethod === "HEAD"
    || normalizedMethod === "OPTIONS"
  ) {
    return null;
  }

  if(pathname === "/api/platform/lawyer-profile/credentials")return 11*1024*1024;
  if(pathname === "/api/product-events")return 4096;
  const isStreamingUpload =
    (normalizedMethod === "POST" && /^\/api\/document-builder\/documents\/[^/]+\/(?:attachments|signed-file)$/u.test(pathname))
    || (normalizedMethod === "POST" && pathname === "/api/platform/document-comparisons")
    || (normalizedMethod === "POST" && pathname === "/api/platform/lawyer-profile/photo")
    || (normalizedMethod === "PUT" && /^\/api\/platform\/document-analysis\/uploads\/[^/]+$/u.test(pathname))
    || (normalizedMethod === "PUT" && /^\/api\/platform\/voice\/recordings\/[^/]+$/u.test(pathname));
  if (isStreamingUpload) return null;

  return pathname.startsWith("/api/document-builder/")
    ? DOCUMENT_BUILDER_API_BODY_LIMIT_BYTES
    : DEFAULT_PUBLIC_API_BODY_LIMIT_BYTES;
}

/**
 * Read and rebuild a request while enforcing the actual streamed byte count.
 * Content-Length is only an early rejection hint; missing or understated
 * headers cannot bypass the limit.
 */
export async function requestWithBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedRequestBody> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("INVALID_REQUEST_BODY_LIMIT");
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null
    && /^(?:0|[1-9]\d*)$/u.test(declaredLength)
    && Number(declaredLength) > maxBytes
  ) {
    return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: true, request };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel("payload_too_large");
      } catch {
        // The size decision remains authoritative if transport cleanup fails.
      }
      return { ok: false, reason: "too_large" };
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    ok: true,
    request: new Request(request, { body: bytes }),
  };
}
