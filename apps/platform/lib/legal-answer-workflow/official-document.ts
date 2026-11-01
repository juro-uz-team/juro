import { createOfficialCaptures, type OfficialCapture } from "./official-capture";
import { normalizePublisherHtml } from "./publisher-html";
import { historicalPublisherUrl, publisherUrlForScope, verifyPublisherEdition } from "./publisher-edition";
import type { EvidenceScope } from "./evidence";
import type { NormalizedDocument } from "./normalized-document";

type CapturedDocument = { capture: OfficialCapture; document: ReturnType<typeof normalizePublisherHtml> };

/** Request-owned complete document reads; extraction gaps remain visible to admission and recovery. */
export function createOfficialDocumentReader(input: {
  signal: AbortSignal; submittedAt: number; deadlineMs: number; fetchImpl?: typeof fetch;
}) {
  const captures = createOfficialCaptures(input);
  const documents = new Map<string, Promise<CapturedDocument>>();
  function load(url: string, locale: NormalizedDocument["source"]["locale"]) {
    input.signal.throwIfAborted();
    const key = JSON.stringify([url, locale]);
    let pending = documents.get(key);
    if (!pending) {
      if (documents.size >= 12) throw new Error("PUBLISHER_DOCUMENT_LIMIT");
      pending = captures.read(url).then(capture => {
        const document = normalizePublisherHtml(capture, locale);
        input.signal.throwIfAborted();
        return { capture, document };
      });
      documents.set(key, pending);
    }
    return pending;
  }
  return { readMedia: (url: string) => captures.read(url),
    async read(sourceUrl: string, locale: NormalizedDocument["source"]["locale"], scope: EvidenceScope) {
    const current = await load(publisherUrlForScope(sourceUrl, { kind: "current" }), locale);
    const currentEdition = verifyPublisherEdition({ ...current.capture, ...input,
      selectedEditions: current.document.selectedEditions, editionDates: current.document.editionDates, scope: { kind: "current" } });
    if (scope.kind === "current") return structuredClone({ ...current, edition: currentEdition });
    const historical = await load(historicalPublisherUrl(sourceUrl, current.document.editionDates, scope.at), locale);
    const edition = verifyPublisherEdition({ ...historical.capture, ...input,
      selectedEditions: historical.document.selectedEditions, editionDates: current.document.editionDates, scope });
    return structuredClone({ ...historical, edition });
  } };
}
