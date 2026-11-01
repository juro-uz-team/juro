const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

/** Reject invalid writes before loading corpus configuration, accounts, or provider state. */
export function rejectAnswerRequest(request: Request, publicOrigin: string | undefined): Response | null {
  if (request.method !== "POST") return Response.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405, headers });
  let origin: string;
  try {
    if (!publicOrigin) throw new Error("Missing origin");
    const url = new URL(publicOrigin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid origin");
    origin = url.origin;
  } catch {
    return Response.json({ code: "LEGAL_ANSWER_CONFIGURATION_UNAVAILABLE" }, { status: 503, headers });
  }
  if (request.headers.get("origin") !== origin || request.headers.get("x-juro-csrf") !== "1"
    || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) {
    return Response.json({ code: "REQUEST_ORIGIN_INVALID" }, { status: 403, headers });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ code: "REQUEST_CONTENT_TYPE_INVALID" }, { status: 415, headers });
  }
  return null;
}
