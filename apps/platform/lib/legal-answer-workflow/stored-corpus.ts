import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { CorpusCitationReceipt } from "./corpus-citations";
import { readOfficialProvision, type EvidenceScope, type ProvisionLocator, type ProvisionObjects } from "./evidence";
import { readPreparedProvision } from "./prepared-provision";
import { withinSignal } from "./lifetime";
import type { CandidateRanking } from "./contracts";
import { maximumCandidateDescriptionBatch } from "./contracts";
import type { CandidateDescription } from "./candidate-selection";

export type StoredProvisionReceipt = CorpusCitationReceipt;
type Discovery = {
  search(query: string, scope: EvidenceScope, signal: AbortSignal): Promise<{
    candidates: string[]; sparseAvailable: boolean; denseAvailable: boolean;
    ranking?: Record<string, CandidateRanking>;
  }>;
  readCandidate(identity: string, signal: AbortSignal): Promise<{ work: string;
    source: { inventory: Record<string, unknown>; prepared: Record<string, unknown> | null };
    unitMetadata: Record<string, unknown>;
  }>;
  prepareCandidates?(identities: string[], signal: AbortSignal): Promise<void>;
};
export type StoredProvisionReader = {
  findInSource?(request: { work: string; contains: string; language: string; scope: EvidenceScope },
    signal: AbortSignal): Promise<{ position: string; text: string }[]>;
  describeRange?(request: { work: string; position: string; language: string; scope: EvidenceScope },
    signal: AbortSignal): Promise<{ key: string; kind: "provision" | "section" | "document"; language: string; textByteCount?: number; unitCount?: number; sourceNotes?: string[];
      sourceSections?: { position: string; title: string; key: string; textByteCount?: number; unitCount?: number }[]; sections?: { position: string; title: string; key: string; textByteCount?: number; unitCount?: number }[] }>;
  /** Authenticated corpus mapping, not a search preview or a model-supplied locator. */
  lookup(request: { work: string; position: string; language: string; scope: EvidenceScope; wholeSection?: boolean; wholeDocument?: boolean; publisherHeading?: string },
    signal: AbortSignal): Promise<StoredProvisionReceipt | null>;
  reference(request: { parent: ProvisionLocator; url: string; scope: EvidenceScope },
    signal: AbortSignal): Promise<StoredProvisionReceipt | null>;
  introductory?(request: { parent: ProvisionLocator; scope: EvidenceScope },
    signal: AbortSignal): Promise<StoredProvisionReceipt | null>;
  adjacent?(request: { parent: ProvisionLocator; direction: "next" | "previous"; scope: EvidenceScope },
    signal: AbortSignal): Promise<StoredProvisionReceipt | null>;
};
const unitSchema = z.object({ locator: z.string().min(1).max(1024),
  language: z.enum(["en", "ru", "uz-Latn", "uz-Cyrl"]), text: z.string().min(1) });

/** Search the full retained corpus; absent prepared evidence never triggers acquisition or repair. */
export function createStoredCorpus(input: { current: Discovery; history: Discovery;
  objects: ProvisionObjects; provisions: StoredProvisionReader; deferSourceNavigation?: boolean }) {
  const discovered = new Set<string>();
  const literalCandidates = new Map<string, Awaited<ReturnType<Discovery["readCandidate"]>>>();
  const ranges = new Map<string, { key: string; kind: "provision" | "section" | "document"; language: string; textByteCount?: number; unitCount?: number; sourceNotes?: string[];
    sourceSections?: { position: string; title: string; key: string; textByteCount?: number; unitCount?: number }[]; sections?: { position: string; title: string; key: string; textByteCount?: number; unitCount?: number }[] }>();
  async function describeRange(found: Awaited<ReturnType<typeof candidate>>, scope: EvidenceScope, signal: AbortSignal):
    Promise<Awaited<ReturnType<NonNullable<StoredProvisionReader["describeRange"]>>>> {
    const key = JSON.stringify([found.work, found.unit.locator, found.unit.language, scope]);
    const prior = ranges.get(key);
    if (prior) return prior;
    if (input.provisions.describeRange) {
      const range = await input.provisions.describeRange({ work: found.work, position: found.unit.locator,
        language: found.unit.language, scope }, signal);
      ranges.set(key, range);
      return range;
    }
    const complete = readPreparedProvision(found.source.prepared, { work: found.work, position: found.unit.locator, language: found.unit.language, wholeSection: false });
    const range = { key: JSON.stringify([found.work, complete.language, complete.ordinals[0], complete.ordinals.at(-1), scope]),
      kind: complete.articleTitle ? "provision" as const : complete.sectionTitle ? "section" as const : "document" as const, language: complete.language };
    ranges.set(key, range);
    return range;
  }
  const reads = new Map<string, Promise<ProvisionLocator | null>>();
  const objects = new Map<string, Promise<Uint8Array | null>>();
  const receipts = new Map<string, StoredProvisionReceipt>();
  const key = (identity: string, scope: EvidenceScope) => JSON.stringify([identity, scope]);
  const lane = (scope: EvidenceScope) => scope.kind === "current" ? input.current : input.history;
  const get = async (objectKey: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    let pending = objects.get(objectKey);
    if (!pending) {
      pending = input.objects.get(objectKey, signal).then(bytes => bytes ? new Uint8Array(bytes) : null);
      objects.set(objectKey, pending);
    }
    const bytes = signal ? await withinSignal(signal, () => pending!) : await pending;
    signal?.throwIfAborted();
    return bytes ? new Uint8Array(bytes) : null;
  };
  async function retain(receipt: StoredProvisionReceipt | null, scope: EvidenceScope, signal: AbortSignal) {
    if (!receipt) return null;
    const saved = structuredClone(receipt);
    await readOfficialProvision(saved.locator, { get }, scope, signal);
    const prior = receipts.get(saved.locator.identity);
    if (prior && !isDeepStrictEqual(prior, saved)) throw new Error("CORPUS_SOURCE_IDENTITY");
    receipts.set(saved.locator.identity, saved);
    return structuredClone(saved.locator);
  }
  async function candidate(identity: string, scope: EvidenceScope, signal: AbortSignal) {
    if (!discovered.has(key(identity, scope))) throw new Error("CANDIDATE_NOT_DISCOVERED");
    const found = literalCandidates.get(key(identity, scope)) ?? await withinSignal(signal, () => lane(scope).readCandidate(identity, signal));
    if (found.source.inventory.id !== found.work || (found.source.prepared !== null && found.source.prepared.work !== found.work)) {
      throw new Error("CORPUS_SOURCE_IDENTITY");
    }
    return { ...found, unit: unitSchema.parse(found.unitMetadata) };
  }
  return {
    get,
    async findInSource(identity: string, contains: string, scope: EvidenceScope, signal: AbortSignal) {
      if (!contains.trim() || contains.length > 240 || !input.provisions.findInSource) throw new Error("SOURCE_LOOKUP_UNAVAILABLE");
      const parent = await candidate(identity, scope, signal);
      const matches = await input.provisions.findInSource({ work: parent.work, contains,
        language: parent.unit.language, scope }, signal);
      return matches.map(match => {
        const matchIdentity = `literal:${parent.work}:${parent.unit.language}:${match.position}`;
        const scoped = key(matchIdentity, scope);
        discovered.add(scoped);
        literalCandidates.set(scoped, { work: parent.work, source: parent.source, unitMetadata: {
          locator: match.position, language: parent.unit.language, text: match.text } });
        return matchIdentity;
      });
    },
    async search(query: string, scope: EvidenceScope, signal: AbortSignal) {
      const result = await withinSignal(signal, () => lane(scope).search(query, scope, signal));
      for (const identity of result.candidates) discovered.add(key(identity, scope));
      return result;
    },
    async prepareCandidates(identities: string[], scope: EvidenceScope, signal: AbortSignal) {
      signal.throwIfAborted();
      if (identities.some(identity => !discovered.has(key(identity, scope)))) throw new Error("CANDIDATE_NOT_DISCOVERED");
      await lane(scope).prepareCandidates?.(identities, signal);
    },
    async describeCandidates(identities: string[], scope: EvidenceScope, signal: AbortSignal, includeNavigation = false) {
      if (identities.length > maximumCandidateDescriptionBatch || identities.some(identity => !discovered.has(key(identity, scope)))) {
        throw new Error("CANDIDATE_NOT_DISCOVERED");
      }
      try { const indexed = identities.filter(identity => !literalCandidates.has(key(identity, scope)));
        if (indexed.length) await lane(scope).prepareCandidates?.(indexed, signal); }
      catch { signal.throwIfAborted(); /* Individual reads retain available metadata. */ }
      return Promise.all(identities.map(async (identity): Promise<CandidateDescription> => {
        try {
          const found = await candidate(identity, scope, signal);
          const sourceUrl = z.url().parse(found.source.inventory.url), url = new URL(sourceUrl);
          if (url.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(url.hostname)
            || url.username || url.password || url.port) throw new Error("CORPUS_SOURCE_IDENTITY");
          const title = typeof found.source.prepared?.title === "string" ? found.source.prepared.title : undefined;
          const parsed = z.array(z.string()).safeParse(found.unitMetadata.hierarchy);
          const hierarchy = parsed.success ? parsed.data : undefined;
          const editions = z.array(z.string()).safeParse(found.source.prepared?.selected_edition);
          const requestedEdition = found.source.prepared?.requested_edition;
          const contents = z.array(z.object({ position: z.string().regex(/^-?\d+$/u), title: z.string().min(1) }).strict())
            .safeParse(found.source.prepared?.publisher_contents);
          let readRange: Awaited<ReturnType<typeof describeRange>> | undefined, descriptionFailure: string | undefined;
          const sourceNotes = [...(Array.isArray(found.source.prepared?.header) ? found.source.prepared.header : []),
            ...(Array.isArray(found.source.prepared?.notices) ? found.source.prepared.notices : [])]
            .map(value => typeof value === "string" ? value : JSON.stringify(value));
          try { if (!input.deferSourceNavigation || includeNavigation) readRange = await describeRange(found, scope, signal); }
          catch { signal.throwIfAborted(); descriptionFailure = "COMPLETE_READ_RANGE_UNAVAILABLE"; }
          return { identity, sourceUrl, language: found.unit.language,
            ...(contents.success && contents.data.length ? { publisherContents: contents.data } : {}),
            ...(editions.success ? { selectedEditions: editions.data } : {}),
            ...(requestedEdition === null || typeof requestedEdition === "string" ? { requestedEdition } : {}),
            ...(readRange ? { readRange } : {}),
            ...(sourceNotes.length ? { sourceNotes } : {}),
            ...(descriptionFailure ? { descriptionFailure } : {}), text: found.unit.text.slice(0, 1200),
            ...(title ? { title: title.slice(0, 400) } : {}),
            ...(hierarchy ? { hierarchy: hierarchy.slice(-3).map(item => item.slice(0, 160)) } : {}),
            truncated: found.unit.text.length > 1200 || (title?.length ?? 0) > 400
              || (hierarchy?.length ?? 0) > 3 || (hierarchy?.some(item => item.length > 160) ?? false) };
        } catch {
          signal.throwIfAborted();
          return { identity, sourceUrl: "https://lex.uz/", text: "Description unavailable; complete read required.",
            truncated: true, descriptionFailure: "CATALOG_READ_UNAVAILABLE" };
        }
      }));
    },
    async resolveDocument(identity: string, scope: EvidenceScope, signal: AbortSignal) {
      signal.throwIfAborted();
      if (!discovered.has(key(identity, scope))) throw new Error("CANDIDATE_NOT_DISCOVERED");
      const found = await candidate(identity, scope, signal);
      const readKey = JSON.stringify(["document", found.work, found.unit.language, scope]);
      let pending = reads.get(readKey);
      if (!pending) {
        pending = withinSignal(signal, async () => {
          const receipt = await input.provisions.lookup({ work: found.work, position: found.unit.locator,
            language: found.unit.language, scope, wholeDocument: true }, signal);
          if (receipt && receipt.language !== found.unit.language) throw new Error("CORPUS_SOURCE_IDENTITY");
          return retain(receipt, scope, signal);
        });
        reads.set(readKey, pending);
      }
      return structuredClone(await withinSignal(signal, () => pending!));
    },
    async resolve(identity: string, scope: EvidenceScope, signal: AbortSignal, sectionPosition?: string) {
      signal.throwIfAborted();
      if (!discovered.has(key(identity, scope))) throw new Error("CANDIDATE_NOT_DISCOVERED");
      const readKey = JSON.stringify([identity, scope, sectionPosition ?? null]);
      let pending = reads.get(readKey);
      if (!pending) {
        pending = withinSignal(signal, async () => {
          const found = await candidate(identity, scope, signal);
          const contents = z.array(z.object({ position: z.string().regex(/^-?\d+$/u), title: z.string().min(1) }).strict())
            .safeParse(found.source.prepared?.publisher_contents);
          const publisherHeading = sectionPosition && contents.success ? contents.data.find(item => item.position === sectionPosition) : undefined;
          const range = sectionPosition && !publisherHeading ? await describeRange(found, scope, signal) : undefined;
          if (sectionPosition && !publisherHeading && ![...(range?.sections ?? []), ...(range?.sourceSections ?? [])].some(section => section.position === sectionPosition)) {
            throw new Error("CANDIDATE_SECTION_INVALID");
          }
          // TOC positions authorize navigation only. The scope-resolved complete
          // reader still validates language, quotation and structural boundaries.
          const receipt = await input.provisions.lookup({ work: found.work, position: sectionPosition ?? found.unit.locator,
            language: found.unit.language, scope, wholeSection: Boolean(sectionPosition),
            ...(publisherHeading ? { publisherHeading: publisherHeading.title } : {}) }, signal);
          if (receipt && receipt.language !== found.unit.language) throw new Error("CORPUS_SOURCE_IDENTITY");
          return retain(receipt, scope, signal);
        });
        reads.set(readKey, pending);
      }
      return structuredClone(await withinSignal(signal, () => pending!));
    },
    async resolveReference(parentSourceId: string, url: string, scope: EvidenceScope, signal: AbortSignal) {
      signal.throwIfAborted();
      const parent = receipts.get(parentSourceId)?.locator;
      if (!parent?.operativeReferences?.some(reference => reference.url === url)) throw new Error("REFERENCE_NOT_AUTHENTICATED");
      if (scope.kind === "current" ? parent.temporalState !== "current_supported" : parent.applicableAt !== scope.at) {
        throw new Error("REFERENCE_SCOPE_MISMATCH");
      }
      const target = new URL(url);
      if (target.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(target.hostname)
        || target.username || target.password || target.port) throw new Error("REFERENCE_SOURCE_INVALID");
      const readKey = key(`reference:${parentSourceId}:${url}`, scope);
      let pending = reads.get(readKey);
      if (!pending) {
        pending = withinSignal(signal, async () => retain(await input.provisions.reference({
          parent: structuredClone(parent), url, scope }, signal), scope, signal));
        reads.set(readKey, pending);
      }
      return structuredClone(await withinSignal(signal, () => pending!));
    },
    async resolveAdjacent(parentSourceId: string, direction: "next" | "previous", scope: EvidenceScope, signal: AbortSignal) {
      signal.throwIfAborted();
      const parentReceipt = receipts.get(parentSourceId), parent = parentReceipt?.locator;
      if (!parent) throw new Error("ADJACENT_PARENT_UNAVAILABLE");
      if (scope.kind === "current" ? parent.temporalState !== "current_supported" : parent.applicableAt !== scope.at) {
        throw new Error("ADJACENT_SCOPE_MISMATCH");
      }
      const readKey = key(`adjacent:${parentSourceId}:${direction}`, scope);
      let pending = reads.get(readKey);
      if (!pending) {
        pending = withinSignal(signal, async () => {
          const receipt = await input.provisions.adjacent?.({ parent: structuredClone(parent), direction, scope }, signal);
          if (!receipt) return null;
          const document = (url: string) => { const parsed = new URL(url); parsed.hash = ""; return parsed.href; };
          if (receipt.locator.snapshot !== parent.snapshot || receipt.language !== parentReceipt!.language
            || document(receipt.locator.sourceUrl) !== document(parent.sourceUrl)
            || !isDeepStrictEqual(receipt.locator.editionObservation, parent.editionObservation)) {
            throw new Error("ADJACENT_SOURCE_MISMATCH");
          }
          return retain(receipt, scope, signal);
        });
        reads.set(readKey, pending);
      }
      return structuredClone(await withinSignal(signal, () => pending!));
    },
    async resolveIntroductory(parentSourceId: string, scope: EvidenceScope, signal: AbortSignal) {
      signal.throwIfAborted();
      const parentReceipt = receipts.get(parentSourceId), parent = parentReceipt?.locator;
      if (!parent) throw new Error("INTRODUCTORY_PARENT_UNAVAILABLE");
      if (scope.kind === "current" ? parent.temporalState !== "current_supported" : parent.applicableAt !== scope.at) {
        throw new Error("INTRODUCTORY_SCOPE_MISMATCH");
      }
      const readKey = key(`introductory:${parentSourceId}`, scope);
      let pending = reads.get(readKey);
      if (!pending) {
        pending = withinSignal(signal, async () => {
          const receipt = await input.provisions.introductory?.({ parent: structuredClone(parent), scope }, signal);
          if (!receipt) return null;
          const document = (url: string) => { const parsed = new URL(url); parsed.hash = ""; return parsed.href; };
          if (receipt.locator.snapshot !== parent.snapshot || receipt.language !== parentReceipt!.language
            || document(receipt.locator.sourceUrl) !== document(parent.sourceUrl)
            || !isDeepStrictEqual(receipt.locator.editionObservation, parent.editionObservation)) {
            throw new Error("INTRODUCTORY_SOURCE_MISMATCH");
          }
          return retain(receipt, scope, signal);
        });
        reads.set(readKey, pending);
      }
      return structuredClone(await withinSignal(signal, () => pending!));
    },
    receipt(identity: string) { return structuredClone(receipts.get(identity) ?? null); },
  };
}
