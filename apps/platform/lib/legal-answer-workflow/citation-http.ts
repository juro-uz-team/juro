import { z } from "zod";
import { savedCitationDetails } from "./citation-details";
import { withinSignal } from "./lifetime";
import { parsePrivateDocumentLocator } from "../document-analysis/private-document-locator";
import { openPrivateSavedCitation } from "./private-citation";
import { openSavedCitation } from "./citation-storage";

type Actor = { db: D1Database; workspaceId: string; userId: string };
const identifier = z.string().min(1).max(240);
const querySchema = z.object({ sourceId: identifier.optional(), sourceUrl: z.url().max(2048), article: z.string().max(1000).optional(),
  format: z.literal("pdf").optional() }).strict();

export async function handleSavedCitationHttp(request: Request, messageId: string, configuration: {
  authenticate(request: Request, signal: AbortSignal): Promise<Actor>;
  objects: Parameters<typeof savedCitationDetails>[0]["objects"];
}) {
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (request.method !== "GET") return Response.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405, headers });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  let actor: Actor;
  try { actor = await withinSignal(signal, () => configuration.authenticate(request, signal)); }
  catch { return Response.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401, headers }); }
  try {
    identifier.parse(messageId);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new Error("CITATION_QUERY_INVALID");
    const query = querySchema.parse(Object.fromEntries(params));
    if (query.format === "pdf") {
      if (parsePrivateDocumentLocator(query.sourceUrl)) throw new Error("CITATION_SELECTION_MISMATCH");
      const saved = await openSavedCitation({ ...actor, ...query, messageId, signal,
        objects: configuration.objects, includePdf: true });
      if (!saved?.pdfBytes || !saved.sourceFile) return Response.json({ code: "CITATION_UNAVAILABLE" }, { status: 404, headers });
      return new Response(new Uint8Array(saved.pdfBytes), { headers: { ...headers,
        "content-type": "application/pdf", "content-length": String(saved.pdfBytes.length),
        "content-disposition": `attachment; filename="${saved.sourceFile.sha256}.pdf"`,
        "content-security-policy": "sandbox", "referrer-policy": "no-referrer" } });
    }
    const details = parsePrivateDocumentLocator(query.sourceUrl)
      ? await openPrivateSavedCitation({ ...actor, ...query, messageId, signal,
        objects: { get: (key, caller) => configuration.objects.get(key, undefined, caller ?? signal) } })
      : await savedCitationDetails({ ...actor, ...query, messageId, signal, objects: configuration.objects });
    if (!details) return Response.json({ code: "CITATION_UNAVAILABLE" }, { status: 404, headers });
    return Response.json(details, { headers });
  } catch {
    return Response.json({ code: "CITATION_UNAVAILABLE" }, { status: 404, headers });
  }
}
