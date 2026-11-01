import { createHash } from "node:crypto";
import { z } from "zod";
import type { createOfficialDocumentReader } from "./official-document";
import type { EvidenceScope, ProvisionLocator, ProvisionObjects } from "./evidence";
import { selectPublisherProvision } from "./provision-selection";
import { withinSignal } from "./lifetime";
import { normalizeOfficialPdf } from "./official-pdf";
import { readNormalizedDocument } from "./normalized-document";
import { officialImagePdf } from "./official-image";
import type { OriginalAsset } from "./prepared-discovery";
import { recoverInlineMedia } from "./inline-media";

type Source = { inventory: Record<string, unknown>; prepared: Record<string, unknown> | null };
type Discovery = {
  search(query: string, scope: EvidenceScope, signal: AbortSignal): Promise<{ candidates: string[]; sparseAvailable: boolean; denseAvailable: boolean }>;
  readCandidate(identity: string, signal: AbortSignal): Promise<{ work: string; source: Source; unitMetadata: Record<string, unknown> }>;
  prepareCandidates?(identities: string[], signal: AbortSignal): Promise<void>;
  readAsset?(work: string, signal: AbortSignal): Promise<OriginalAsset>;
};
const unitSchema = z.object({ ordinal: z.union([z.number().int().nonnegative(), z.string().min(1)]),
  locator: z.string().min(1).max(1024), language: z.enum(["en", "ru", "uz-Latn", "uz-Cyrl"]), text: z.string().min(1) });
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
type DocumentReader = ReturnType<typeof createOfficialDocumentReader>;
type RetainedReceipt = { locator: ProvisionLocator; title: string; articleTitle: string | null; language: string; textSha256: string;
  observationKey: string; rawKey: string; selected: ReturnType<typeof selectPublisherProvision> };

/** Fresh corpus composition. Retained passages locate evidence; only complete publisher reads support answers. */
export function createPublisherCorpus(input: { current: Discovery; history: Discovery;
  documents(signal: AbortSignal): DocumentReader;
  objects: ProvisionObjects & { put(key: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> };
}) {
  const discovered = new Set<string>();
  const reads = new Map<string, Promise<ProvisionLocator | null>>();
  const documentReaders = new WeakMap<AbortSignal, DocumentReader>();
  const receipts = new Map<string, RetainedReceipt>();
  const writes = new Map<string, Promise<void>>();
  const scopeKey = (identity: string, scope: EvidenceScope) => JSON.stringify([identity, scope]);
  async function put(key: string, bytes: Uint8Array, signal: AbortSignal) {
    let pending = writes.get(key);
    if (!pending) { pending = withinSignal(signal, () => input.objects.put(key, bytes, signal)); writes.set(key, pending); }
    await pending;
    signal.throwIfAborted();
  }
  async function resolve(identity: string, scope: EvidenceScope, signal: AbortSignal): Promise<ProvisionLocator | null> {
    const discovery = scope.kind === "current" ? input.current : input.history;
    const candidate = await withinSignal(signal, () => discovery.readCandidate(identity, signal));
    const unit = unitSchema.parse(candidate.unitMetadata);
    // The pinned catalog already proves chunk-to-unit membership and supplies source metadata.
    // Reloading every unit of the same source adds no evidence: complete legal text is read below.
    const full = candidate.source;
    signal.throwIfAborted();
    if (!full || full.inventory.id !== candidate.work || full.prepared?.work !== candidate.work) throw new Error("CORPUS_SOURCE_IDENTITY");
    if (["asset", "member"].includes(String(full.inventory.kind)) && full.inventory.state === "done") {
      return readAsset(discovery, candidate.work, full.inventory, unit.language, scope, signal);
    }
    if (full.inventory.kind !== "document" || full.inventory.state !== "done") throw new Error("CORPUS_SOURCE_REQUIRES_RECOVERY");
    if (!/^-?\d+$/u.test(unit.locator)) throw new Error("PUBLISHER_POSITION_MISSING");
    const sourceUrl = z.url().parse(full.inventory.url);
    return readSource(sourceUrl, unit.language, unit.locator, scope, signal,
      { candidate: identity, work: candidate.work, position: unit.locator });
  }
  async function readAsset(discovery: Discovery, work: string, inventory: Record<string, unknown>,
    language: z.infer<typeof unitSchema>["language"], scope: EvidenceScope, signal: AbortSignal): Promise<ProvisionLocator> {
    const sourceUrl = z.url().parse(inventory.url), url = new URL(sourceUrl);
    if (url.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(url.hostname)
      || url.username || url.password || url.port) {
      throw new Error("CORPUS_SOURCE_REQUIRES_RECOVERY");
    }
    const context = z.object({ source: z.string().regex(/^-?\d+$/u), language: unitSchema.shape.language,
      edition: z.string().min(1), member: z.string().min(1).max(4096).optional() }).parse(inventory.context);
    let filename = url.pathname;
    if (inventory.kind === "member") {
      const receipt = z.object({ member: z.string().min(1).max(4096), archive_work: z.string().regex(/^[a-f0-9]{64}$/u) }).parse(inventory.receipt);
      if (!context.member || context.member !== receipt.member || !/^#member:\d+$/u.test(url.hash)) throw new Error("SOURCE_ASSET_IDENTITY");
      filename = context.member;
      url.hash = "";
    } else if (url.hash) throw new Error("SOURCE_ASSET_IDENTITY");
    const office = /\.(?:docx?|odt|rtf|xlsx?|ods|pptx?|odp)$/iu.test(filename);
    if (!office && !/\.(?:pdf|png|jpe?g|gif|webp|tiff?|avif|heif)$/iu.test(filename)) throw new Error("CORPUS_SOURCE_REQUIRES_RECOVERY");
    const publishedUrl = url.href;
    if (context.language !== language || !discovery.readAsset) throw new Error("SOURCE_ASSET_IDENTITY");
    const locale = ({ en: "en", ru: "ru", "uz-Latn": "uz", "uz-Cyrl": "uzc" } as const)[language];
    let reader = documentReaders.get(signal);
    if (!reader) { reader = input.documents(signal); documentReaders.set(signal, reader); }
    const parent = await withinSignal(signal, () => reader.read(`https://lex.uz/${locale}/docs/${context.source}`, locale, scope));
    // A retained attachment may survive later parent edits. The requested publisher
    // edition must still publish its exact URL, and the original bytes must match below.
    if (!(parent.document.links.some(link => link.role === "operative" && link.url === publishedUrl)
      || parent.document.media.some(media => media.url === publishedUrl))) {
      throw new Error("SOURCE_ASSET_EDITION_MISMATCH");
    }
    const asset = await withinSignal(signal, () => discovery.readAsset!(work, signal));
    if (asset.work !== work || asset.sourceUrl !== sourceUrl || asset.sha256 !== inventory.raw_hash
      || asset.bytes.length !== inventory.bytes || digest(asset.bytes) !== asset.sha256) throw new Error("SOURCE_ASSET_IDENTITY");
    const rawKey = `legal-evidence/raw/${asset.sha256}`;
    if (office && (!asset.renderedPdf || asset.renderedPdf.sourceSha256 !== asset.sha256
      || !/^sha256:[a-f0-9]{64}$/u.test(asset.renderedPdf.rendererImage))) throw new Error("SOURCE_OFFICE_RENDITION_MISSING");
    const rendered = office ? asset.renderedPdf! : /\.pdf$/iu.test(filename) ? asset : await officialImagePdf({ ...asset, signal });
    const sourceFile = { objectKey: `legal-evidence/raw/${rendered.sha256}`, sha256: rendered.sha256, byteCount: rendered.bytes.length,
      ...(office ? { rendererImage: asset.renderedPdf!.rendererImage } : {}),
      ...(rendered.sha256 !== asset.sha256 ? { original: { objectKey: rawKey, sha256: asset.sha256, byteCount: asset.bytes.length } } : {}) };
    const snapshot = await normalizeOfficialPdf({ ...rendered, sourceUrl, title: parent.document.snapshot.documentTitle, locale, signal });
    // Bind mandatory original-page evidence into the immutable normalized object for saved citations.
    const normalized = Buffer.from(JSON.stringify({ ...snapshot, sourceFile }));
    const sha256 = digest(normalized), objectKey = `legal-evidence/normalized/${sha256}.json`;
    const text = readNormalizedDocument(normalized.toString("utf8"), sourceUrl);
    if (normalized.length > 8 * 1024 * 1024 || text.length > 64_000) throw new Error("PROVISION_CONTEXT_BOUND");
    const locator: ProvisionLocator = { identity: `official-file:${digest(JSON.stringify([sha256, scope]))}`,
      snapshot: sha256, objectKey, sha256, byteCount: normalized.length, sourceUrl,
      privacyClass: "public_official_source", quarantined: false, canonicalizationConflict: false,
      temporalState: scope.kind === "current" ? "current_supported" : "historical_only", currentPointerVerified: scope.kind === "current",
      ...(scope.kind === "historical" ? { applicableAt: scope.at } : {}), encoding: "normalized-document", sourceFile,
      editionObservation: { selectedEdition: parent.edition.selectedEditionToken, observedAt: parent.edition.observedAt } };
    const observation = Buffer.from(JSON.stringify({ version: 1, locator, work, rawKey, edition: parent.edition,
      retainedEdition: context.edition,
      parentCaptureSha256: parent.capture.sha256, parentUrl: parent.capture.finalUrl, textSha256: digest(text) }));
    const observationKey = `legal-evidence/observations/${digest(observation)}.json`;
    await put(`legal-evidence/raw/${parent.capture.sha256}`, parent.capture.bytes, signal);
    await put(rawKey, asset.bytes, signal);
    if (sourceFile.original) await put(sourceFile.objectKey, rendered.bytes, signal);
    await put(objectKey, normalized, signal);
    await put(observationKey, observation, signal);
    receipts.set(locator.identity, { locator, title: snapshot.documentTitle, articleTitle: null, language,
      textSha256: digest(text), observationKey, rawKey,
      selected: { kind: "normalized-document", articleNumber: null, start: 0, end: snapshot.blocks.length, text, links: [] } });
    return locator;
  }
  async function readSource(sourceUrl: string, language: z.infer<typeof unitSchema>["language"], position: string | null,
    scope: EvidenceScope, signal: AbortSignal, provenance: Record<string, string | null>): Promise<ProvisionLocator> {
    const locale = ({ en: "en", ru: "ru", "uz-Latn": "uz", "uz-Cyrl": "uzc" } as const)[language];
    let reader = documentReaders.get(signal);
    if (!reader) { reader = input.documents(signal); documentReaders.set(signal, reader); }
    const official = await withinSignal(signal, () => reader.read(sourceUrl, locale, scope));
    const recovered = await recoverInlineMedia({ document: official.document, position, scope, signal,
      read: url => reader!.readMedia(url) });
    const { selected } = recovered;
    const normalized = Buffer.from(JSON.stringify(recovered.document.snapshot));
    if (normalized.byteLength > 8 * 1024 * 1024 || selected.text.length > 64_000) throw new Error("PROVISION_CONTEXT_BOUND");
    const sha256 = digest(normalized), objectKey = `legal-evidence/normalized/${sha256}.json`;
    const rawKey = `legal-evidence/raw/${official.capture.sha256}`;
    const sourceUrlWithPosition = new URL(official.capture.finalUrl);
    const headingPosition = Object.entries(official.document.positions).find(([, indices]) => indices.length === 1 && indices[0] === selected.start)?.[0];
    if (selected.articleNumber && headingPosition) sourceUrlWithPosition.hash = headingPosition;
    const locator: ProvisionLocator = { identity: `official-provision:${digest(JSON.stringify([sha256, selected.kind, selected.articleNumber, scope]))}`,
      snapshot: sha256, objectKey, sha256, byteCount: normalized.byteLength, sourceUrl: sourceUrlWithPosition.href,
      privacyClass: "public_official_source", quarantined: false, canonicalizationConflict: false,
      temporalState: scope.kind === "current" ? "current_supported" : "historical_only", currentPointerVerified: scope.kind === "current",
      ...(scope.kind === "historical" ? { applicableAt: scope.at } : {}), encoding: selected.kind,
      ...(selected.articleNumber ? { articleNumber: selected.articleNumber } : {}),
      ...(recovered.pdf ? { sourceFile: recovered.pdf.sourceFile } : {}),
      operativeReferences: selected.links.filter(link => link.role === "operative").map(({ url, text }) => ({ url, text })),
      editionObservation: { selectedEdition: official.edition.selectedEditionToken, observedAt: official.edition.observedAt },
    };
    const observation = Buffer.from(JSON.stringify({ version: 1, locator, rawKey, edition: official.edition,
      acquisition: { requestedUrl: official.capture.requestedUrl, finalUrl: official.capture.finalUrl,
        sha256: official.capture.sha256, bytes: official.capture.byteCount, redirects: official.capture.redirects },
      source: provenance, media: recovered.artifacts.map(({ requestedUrl, finalUrl, sha256, byteCount, contentType, observedAt, redirects }) =>
        ({ requestedUrl, finalUrl, sha256, byteCount, contentType, observedAt, redirects })),
      textSha256: digest(selected.text), links: selected.links }));
    const observationKey = `legal-evidence/observations/${digest(observation)}.json`;
    await put(rawKey, official.capture.bytes, signal);
    for (const artifact of recovered.artifacts) await put(`legal-evidence/raw/${artifact.sha256}`, artifact.bytes, signal);
    if (recovered.pdf) await put(recovered.pdf.sourceFile.objectKey, recovered.pdf.bytes, signal);
    await put(objectKey, normalized, signal);
    await put(observationKey, observation, signal);
    receipts.set(locator.identity, { locator, title: official.document.snapshot.documentTitle,
      articleTitle: selected.articleNumber ? official.document.snapshot.blocks[selected.start].text : null, language,
      textSha256: digest(selected.text), observationKey, rawKey, selected });
    return locator;
  }
  return {
    async describeCandidates(identities: string[], scope: EvidenceScope, signal: AbortSignal) {
      signal.throwIfAborted();
      if (identities.length > 12 || identities.some(identity => !discovered.has(scopeKey(identity, scope)))) {
        throw new Error("CANDIDATE_NOT_DISCOVERED");
      }
      const discovery = scope.kind === "current" ? input.current : input.history;
      await discovery.prepareCandidates?.(identities, signal);
      return Promise.all(identities.map(async identity => {
        const candidate = await withinSignal(signal, () => discovery.readCandidate(identity, signal));
        const unit = unitSchema.parse(candidate.unitMetadata);
        if (candidate.source.inventory.id !== candidate.work || candidate.source.prepared?.work !== candidate.work) {
          throw new Error("CORPUS_SOURCE_IDENTITY");
        }
        const sourceUrl = z.url().parse(candidate.source.inventory.url), url = new URL(sourceUrl);
        if (url.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(url.hostname)
          || url.username || url.password || url.port) throw new Error("CORPUS_SOURCE_IDENTITY");
        const title = typeof candidate.source.prepared?.title === "string" ? candidate.source.prepared.title : undefined;
        const headings = z.array(z.string()).safeParse(candidate.unitMetadata.hierarchy);
        const hierarchy = headings.success ? headings.data : undefined;
        return { identity, sourceUrl,
          text: unit.text.slice(0, 1200),
          ...(title ? { title: title.slice(0, 400) } : {}),
          ...(hierarchy ? { hierarchy: hierarchy.slice(-3).map(heading => heading.slice(0, 160)) } : {}),
          truncated: unit.text.length > 1200 || (title?.length ?? 0) > 400
            || (hierarchy?.length ?? 0) > 3 || (hierarchy?.some(heading => heading.length > 160) ?? false) };
      }));
    },
    async prepareCandidates(identities: string[], scope: EvidenceScope, signal: AbortSignal) {
      signal.throwIfAborted();
      if (identities.some(identity => !discovered.has(scopeKey(identity, scope)))) throw new Error("CANDIDATE_NOT_DISCOVERED");
      await (scope.kind === "current" ? input.current : input.history).prepareCandidates?.(identities, signal);
    },
    get: (key: string, signal?: AbortSignal) => input.objects.get(key, signal),
    async search(query: string, scope: EvidenceScope, signal: AbortSignal) {
      const discovery = scope.kind === "current" ? input.current : input.history;
      const result = await withinSignal(signal, () => discovery.search(query, scope, signal));
      if (!result.sparseAvailable || !result.denseAvailable) throw new Error("CORPUS_LANES_INCOMPLETE");
      for (const identity of result.candidates) discovered.add(scopeKey(identity, scope));
      return result;
    },
    async resolve(identity: string, scope: EvidenceScope, signal: AbortSignal) {
      signal.throwIfAborted();
      const key = scopeKey(identity, scope);
      if (!discovered.has(key)) throw new Error("CANDIDATE_NOT_DISCOVERED");
      let pending = reads.get(key);
      if (!pending) { pending = resolve(identity, scope, signal); reads.set(key, pending); }
      const result = await pending;
      signal.throwIfAborted();
      return structuredClone(result);
    },
    async resolveReference(parentSourceId: string, url: string, scope: EvidenceScope, signal: AbortSignal) {
      signal.throwIfAborted();
      const parent = receipts.get(parentSourceId);
      if (!parent || !parent.locator.operativeReferences?.some(reference => reference.url === url)) throw new Error("REFERENCE_NOT_AUTHENTICATED");
      if (scope.kind === "current" ? parent.locator.temporalState !== "current_supported"
        : parent.locator.applicableAt !== scope.at) throw new Error("REFERENCE_SCOPE_MISMATCH");
      const target = new URL(url);
      if (target.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(target.hostname)
        || target.username || target.password || target.port) throw new Error("REFERENCE_SOURCE_INVALID");
      const position = target.hash ? target.hash.slice(1) : null;
      if (position !== null && !/^-?\d+$/u.test(position)) throw new Error("REFERENCE_POSITION_UNSUPPORTED");
      const language = unitSchema.shape.language.parse(parent.language);
      const key = scopeKey(`reference:${parentSourceId}:${url}`, scope);
      let pending = reads.get(key);
      if (!pending) {
        pending = readSource(url, language, position, scope, signal, { parentSourceId, url, position });
        reads.set(key, pending);
      }
      const result = await pending;
      signal.throwIfAborted();
      return structuredClone(result);
    },
    receipt(identity: string) { return structuredClone(receipts.get(identity) ?? null); },
  };
}
