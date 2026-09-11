import { classifyLegalSourceUrl, fetchLegalSource } from "./source-fetch";
import {normalizeLegalSourceHtml, type NormalizedLegalSourceSnapshot} from "./source-parser";
import {createSourceObservationReader, type SourceObservation, type SourceObservationStore} from "./source-observation";

/** Compare normalized official text and identity, excluding volatile raw HTML. */
export async function publisherTextFingerprint(snapshot: NormalizedLegalSourceSnapshot): Promise<string> {
  // Corpus snapshots namespace document IDs; live parsing retains publisher IDs.
  // The authenticated canonical URL is the shared document identity for both.
  const canonicalId = classifyLegalSourceUrl(snapshot.source.canonicalUrl).canonicalId;
  const value = {sourceKind: snapshot.source.sourceKind, locale: snapshot.source.locale,
    canonicalId, canonicalUrl: snapshot.source.canonicalUrl,
    parser: snapshot.parser, documentTitle: snapshot.documentTitle, blocks: snapshot.blocks, plainText: snapshot.plainText};
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function readLexPublisherObservation(url: string, options?: {wait: (delayMs: number) => Promise<void>}): Promise<SourceObservation> {
  const fetched = await fetchLegalSource(url, {adviceEnabled: false, crawlDelayMode: options ? "wait" : "proceed",
    ...(options ? {wait: options.wait} : {}),
    timeoutMs: 4_000, maxBytes: 16 * 1024 * 1024});
  const html = new TextDecoder("utf-8", {fatal: true}).decode(fetched.bytes);
  if (!/<header\b[^>]*\bid=["']doc_header["'][^>]*>[\s\S]*?<\/header>/iu.test(html)) throw new Error("LEX_DOCUMENT_STATUS_UNAVAILABLE");
  const snapshot = normalizeLegalSourceHtml({html, reference: fetched, rawContentSha256: fetched.contentSha256});
  return {version: 2, officialUrl: fetched.canonicalUrl, observedAt: fetched.fetchedAt,
    current: !lexDocumentIsRepealed(html), rawContentSha256: fetched.contentSha256,
    normalizedTextSha256: await publisherTextFingerprint(snapshot)};
}

export function createLexDocumentObservationReader(store?: SourceObservationStore) {
  return createSourceObservationReader({readPublisher: readLexPublisherObservation, store});
}
export const observeCurrentLexDocument = createLexDocumentObservationReader();

/** Read the publisher's document-level banner, never repeal language inside
 * an operative provision (which may repeal a different instrument). */
export function lexDocumentIsRepealed(html: string): boolean {
  const header = html.match(/<header\b[^>]*\bid=["']doc_header["'][^>]*>([\s\S]*?)<\/header>/iu)?.[1];
  if (!header) return false;
  const text = header.replace(/<[^>]+>/gu, " ").replace(/&nbsp;|&#160;/gu, " ")
    .replace(/\s+/gu, " ");
  return /(?:(?:документ|акт)\s+утратил\s+силу|hujjat\s+kuchini\s+yo[‘’ʼʻ']?qotgan|ҳужжат\s+кучини\s+йўқотган|document\s+(?:has\s+)?(?:lost\s+(?:its\s+)?force|ceased\s+to\s+be\s+in\s+force))/iu.test(text);
}
