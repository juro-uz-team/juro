import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { createPreparedProvisionReader } from "./prepared-provision";
import { parsePinnedCandidateRelease } from "../legal-corpus/legal-candidate-index";
import { preparedCandidateConfigurationSchema } from "../legal-corpus/prepared-candidate-configuration";
import { createPreparedTransportPair } from "./prepared-transport";
import { createPreparedProvisionObjects } from "./prepared-provision-objects";
import { articleNumberFromHeading } from "./normalized-document";
import type { EvidenceScope, ProvisionLocator, ReferenceOrigin } from "./evidence";
import type { StoredProvisionReader, StoredProvisionReceipt } from "./stored-corpus";
import { withinSignal } from "./lifetime";

type Worker = Parameters<typeof createPreparedTransportPair>[0]["discovery"];
const record = z.record(z.string(), z.unknown());
const hierarchySchema = z.array(z.string());
const captureState = z.enum(["unique", "conflict", "unavailable"]).optional();
const packetSchema = z.object({ package_sha256: z.string(), work_index_sha256: z.string(),
  sources: z.record(z.string(), z.object({ inventory: record, prepared: record.nullable(), current_capture: captureState })) });
const referencePacketSchema = packetSchema.extend({ reference_status: z.enum(["unique", "missing", "ambiguous"]) });
const metadataSchema = z.object({
  current_capture: captureState,
  inventory: z.object({ id: z.string(), kind: z.literal("document"), state: z.literal("done"), url: z.url(),
    raw_hash: z.string().regex(/^[a-f0-9]{64}$/u), context: z.object({ source: z.string(), edition: z.string().nullish() }),
    receipt: z.object({ status: z.literal(200), sha256: z.string(), observed: z.number().positive() }) }),
  prepared: z.object({ work: z.string(), source: z.string(), requested_edition: z.string().nullable(),
    selected_edition: z.array(z.string().min(1)),
    header: z.array(z.string()).optional(), notices: z.array(z.unknown()).optional(),
    units: z.array(z.object({ ordinal: z.number(), locator: z.string() }).passthrough()),
    relationships: z.array(z.object({ kind: z.string(), href: z.string().optional(), label: z.string().optional(), locator: z.string().nullable().optional() }).passthrough()),
  }).passthrough(),
});

function publisherUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(url.hostname)
    || url.username || url.password || url.port) throw new Error("CORPUS_SOURCE_IDENTITY");
  return url;
}
function editionDate(value: string) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?: \d{2})?$/u.exec(value);
  if (!match) throw new Error("PREPARED_TEMPORAL_UNAVAILABLE");
  return z.iso.date().parse(`${match[3]}-${match[2]}-${match[1]}`);
}

function retainedSourceNotes(item: z.infer<typeof metadataSchema>) {
  return [...(item.prepared.header ?? []), ...(item.prepared.notices ?? [])
    .map(notice => typeof notice === "string" ? notice : JSON.stringify(notice))];
}

/** Public stored source reads under the existing package and work-index pins. No acquisition operations. */
export function createPreparedStoredReader(input: { release: unknown; worker: Worker; sources?: Worker }) {
  const release = parsePinnedCandidateRelease(input.release);
  const configuration = preparedCandidateConfigurationSchema.parse(release.configuration);
  const transport = createPreparedTransportPair({ discovery: input.worker, sources: input.sources });
  const sources = new Map<string, Promise<z.infer<typeof metadataSchema>>>();
  const loadedSources = new Map<string, z.infer<typeof metadataSchema>>();
  const sectionRanges = new Map<string, ReturnType<ReturnType<typeof createPreparedProvisionReader>["describe"]> | null>();
  const sectionDirectories = new Map<string, { position: string; title: string; key: string; textByteCount?: number; unitCount?: number }[]>();
  const navigationTitle = (path: string[], section: NonNullable<ReturnType<ReturnType<typeof createPreparedProvisionReader>["describe"]>>) =>
    [path.join(" > "), ...(section.annexContext ?? []).map(context =>
      `${context.relation} annex context: ${context.units.map(unit => unit.text).join(" / ")}`)].join("\n");
  const referenceSources = new Map<string, Promise<{ status: "unique" | "missing" | "ambiguous"; work: string | null }>>();
  const receipts = new Map<string, { work: string; receipt: StoredProvisionReceipt;
    adjacentPositions: { next?: string; previous?: string } }>();
  function storedSource(work: string, value: unknown) {
    const item = metadataSchema.parse(value);
    const url = publisherUrl(item.inventory.url);
    const sourceId = /\/docs\/(-?\d+)$/u.exec(url.pathname)?.[1];
    if (item.inventory.id !== work || item.prepared.work !== work || !sourceId
      || item.prepared.source !== sourceId || item.inventory.context.source !== sourceId) throw new Error("CORPUS_SOURCE_IDENTITY");
    const known = loadedSources.get(work);
    if (known && !isDeepStrictEqual(known, item)) throw new Error("SOURCE_CATALOG_MISMATCH");
    return item;
  }
  async function source(work: string, signal: AbortSignal) {
    let pending = sources.get(work);
    if (!pending) {
      pending = withinSignal(signal, async () => {
        const packet = packetSchema.parse(await transport.readSources({ artifacts: configuration.artifacts, works: [work] }, signal));
        if (packet.package_sha256 !== configuration.artifacts.packageSha256
          || packet.work_index_sha256 !== configuration.artifacts.workIndexSha256
          || Object.keys(packet.sources).length !== 1) throw new Error("SOURCE_CATALOG_MISMATCH");
        const item = storedSource(work, packet.sources[work]);
        loadedSources.set(work, item);
        return item;
      });
      sources.set(work, pending);
    }
    return withinSignal(signal, () => pending!);
  }
  async function resolveSourceReference(target: URL, scope: EvidenceScope, signal: AbortSignal) {
    const key = JSON.stringify([target.href, scope]);
    let pending = referenceSources.get(key);
    if (!pending) {
      pending = withinSignal(signal, async () => {
        const packet = referencePacketSchema.parse(await transport.readSourceReference({ artifacts: configuration.artifacts,
          reference: { url: target.href, scope: scope } }, signal));
        const works = Object.keys(packet.sources);
        if (packet.package_sha256 !== configuration.artifacts.packageSha256
          || packet.work_index_sha256 !== configuration.artifacts.workIndexSha256
          || works.length !== (packet.reference_status === "unique" ? 1 : 0)) throw new Error("SOURCE_CATALOG_MISMATCH");
        if (!works.length) return { status: packet.reference_status, work: null };
        const work = works[0], item = storedSource(work, packet.sources[work]);
        if (publisherUrl(item.inventory.url).pathname !== target.pathname) throw new Error("REFERENCE_SOURCE_MISMATCH");
        const requested = target.searchParams.get("ONDATE");
        if (requested !== null && item.prepared.requested_edition !== requested) throw new Error("REFERENCE_SOURCE_MISMATCH");
        if (sources.has(work)) {
          if (!isDeepStrictEqual(await source(work, signal), item)) throw new Error("SOURCE_CATALOG_MISMATCH");
        } else {
          sources.set(work, Promise.resolve(item)); loadedSources.set(work, item);
        }
        return { status: packet.reference_status, work };
      });
      referenceSources.set(key, pending);
    }
    return withinSignal(signal, () => pending!);
  }
  async function sourceForScope(work: string, scope: EvidenceScope, signal: AbortSignal) {
    let item = await source(work, signal);
    if (scope.kind === "historical" && (!item.prepared.requested_edition
      || editionDate(item.prepared.requested_edition) !== scope.at)) {
      const target = publisherUrl(item.inventory.url); target.search = ""; target.hash = "";
      const resolved = await resolveScopedReference(target, scope, signal);
      if (!resolved.work) throw new Error("PREPARED_TEMPORAL_UNAVAILABLE");
      work = resolved.work; item = await source(work, signal);
      if (!item.prepared.requested_edition || editionDate(item.prepared.requested_edition) !== scope.at) {
        throw new Error("PREPARED_TEMPORAL_UNAVAILABLE");
      }
    }
    return { work, item };
  }
  async function resolveScopedReference(target: URL, scope: EvidenceScope, signal: AbortSignal) {
    if (scope.kind !== "historical" || target.searchParams.has("ONDATE")) return resolveSourceReference(target, scope, signal);
    const dated = new URL(target), [year, month, day] = scope.at.split("-");
    dated.searchParams.set("ONDATE", `${day}.${month}.${year}`);
    const exact = await resolveSourceReference(dated, scope, signal);
    // Preserve the existing unique same-day fallback, but never bypass an
    // ambiguous explicit capture by asking a less specific question.
    return exact.status === "missing" ? resolveSourceReference(target, scope, signal) : exact;
  }
  const objects = createPreparedProvisionObjects({ packageSha256: configuration.artifacts.packageSha256,
    loadSource: async (work, signal) => (await source(work, signal)).prepared });
  async function lookup(request: { work: string; position: string; language: string; scope: EvidenceScope;
    wholeSection?: boolean; wholeDocument?: boolean; publisherHeading?: string }, signal: AbortSignal) {
    if ((request.scope.kind === "current") !== (release.capability === "current")) throw new Error("CORPUS_SCOPE_MISMATCH");
    const resolved = await sourceForScope(request.work, request.scope, signal);
    request = { ...request, work: resolved.work };
    const item = resolved.item;
    const url = publisherUrl(item.inventory.url);
    const requested = item.prepared.requested_edition;
    if (item.prepared.selected_edition.length > 1) throw new Error("PREPARED_TEMPORAL_UNAVAILABLE");
    // A trusted undated capture may have no publisher edition selector. Keep
    // that observation unknown; it does not make the complete stored law unreadable.
    const selected = item.prepared.selected_edition[0] ?? null;
    if (request.scope.kind === "current") {
      if (requested !== null || item.inventory.context.edition != null || url.searchParams.has("ONDATE")
        || url.searchParams.has("ONDATE2")) throw new Error("PREPARED_TEMPORAL_UNAVAILABLE");
    } else {
      if (!selected || !requested || requested !== item.inventory.context.edition || url.searchParams.get("ONDATE") !== requested
        || editionDate(requested) !== request.scope.at || editionDate(selected) > request.scope.at) {
        throw new Error("PREPARED_TEMPORAL_UNAVAILABLE");
      }
    }
    if (request.publisherHeading !== undefined && (!request.wholeSection || !item.prepared.relationships.some(link =>
      link.kind === "publisher_link" && link.locator === "" && link.href === `#collapse${request.position}`
        && link.label === request.publisherHeading))) throw new Error("PUBLISHER_HEADING_UNAVAILABLE");
    if (request.wholeSection === false && !request.wholeDocument) {
      const reader = await objects.rangeReader(request.work, signal);
      const extent = reader.describe(request);
      if (!extent.articleTitle || extent.containsSectionHeadings) {
        if (reader.hasArticleHeadings) throw new Error("COMPLETE_PROVISION_SELECTION_REQUIRED");
        // Decrees, lists, forms and other non-article acts are complete source
        // evidence too. Use their existing safe section, or the complete document
        // when no narrower retained boundary exists. Never manufacture an article.
        request = { ...request, wholeSection: undefined };
      }
    }
    const provision = await objects.read(request, signal);
    if (request.publisherHeading !== undefined && (!provision.sectionTitle || provision.ordinals.length < 2)) {
      throw new Error("PUBLISHER_SECTION_UNAVAILABLE");
    }
    if (provision.position && /^-?\d+$/u.test(provision.position)) url.hash = provision.position;
    const positions = new Set(item.prepared.units.filter(unit => provision.ordinals.includes(unit.ordinal)).map(unit => unit.locator));
    const originUnits = new Map<string, typeof item.prepared.units>();
    const included = new Set(provision.ordinals);
    for (const unit of item.prepared.units) if (included.has(unit.ordinal)) {
      const group = originUnits.get(unit.locator) ?? [];
      group.push(unit); originUnits.set(unit.locator, group);
    }
    const references: NonNullable<ProvisionLocator["operativeReferences"]> = [];
    for (const relation of item.prepared.relationships) {
      if (relation.kind !== "publisher_link" || !relation.href || !relation.locator || !positions.has(relation.locator)) continue;
      const target = new URL(relation.href, item.inventory.url);
      if (target.hash && !/^-?\d+$/u.test(target.hash.slice(1))) continue;
      if (target.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(target.hostname)
        || target.username || target.password || target.port) continue;
      const origins: ReferenceOrigin[] = (originUnits.get(relation.locator) ?? []).map(unit => {
        const heading = provision.sourceStructure?.headings.filter(heading => heading.language === unit.language
          && heading.ordinal <= unit.ordinal).sort((a, b) => b.ordinal - a.ordinal)[0];
        return { position: unit.locator, ordinal: unit.ordinal, text: z.string().parse(unit.text), hierarchy: hierarchySchema.parse(unit.hierarchy),
          ...(heading ? { precedingHeading: { position: heading.position, text: heading.text } } : {}) };
      });
      const existing = references.find(reference => reference.url === target.href && reference.text === (relation.label ?? ""));
      if (existing) {
        for (const origin of origins) if (!existing.origins!.some(item => item.ordinal === origin.ordinal)) existing.origins!.push(origin);
      } else references.push({ url: target.href, text: relation.label ?? "", origins });
    }
    const identity = `prepared-provision:${createHash("sha256").update(JSON.stringify([provision.objectKey, request.scope])).digest("hex")}`;
    const receipt: StoredProvisionReceipt = { title: provision.title, articleTitle: provision.articleTitle, sectionTitle: provision.sectionTitle,
      language: provision.language, textSha256: provision.sha256,
      selected: { kind: "provision", articleNumber: provision.articleTitle ? articleNumberFromHeading(provision.articleTitle) ?? null : null },
      locator: { identity, snapshot: `${configuration.artifacts.packageSha256}:${request.work}`,
        objectKey: provision.objectKey, sha256: provision.sha256, byteCount: provision.byteCount, sourceUrl: url.href,
        sourceTitle: provision.title,
        privacyClass: "public_official_source", quarantined: false, canonicalizationConflict: false,
        temporalState: request.scope.kind === "current" ? "current_supported" : "historical_only",
        currentPointerVerified: request.scope.kind === "current", encoding: "utf8-provision",
        ...(request.scope.kind === "historical" ? { applicableAt: request.scope.at } : {}),
        operativeReferences: references,
        sourceNotes: retainedSourceNotes(item),
        sourceStructure: provision.sourceStructure,
        editionObservation: { selectedEdition: selected, observedAt: new Date(item.inventory.receipt.observed * 1000).toISOString() } } };
    receipts.set(identity, { work: request.work, receipt: structuredClone(receipt), adjacentPositions: provision.adjacentPositions });
    return receipt;
  }
  async function lookupReference(work: string, position: string, scope: EvidenceScope, signal: AbortSignal) {
    // An act-level link is navigation. It must not implicitly hydrate the act
    // merely because the referring provision mentions it.
    if (!position) throw new Error("COMPLETE_PROVISION_SELECTION_REQUIRED");
    const resolved = await sourceForScope(work, scope, signal);
    const item = resolved.item;
    const units = position ? item.prepared.units.filter(unit => unit.locator === position) : item.prepared.units.slice(0, 1);
    if (units.length !== 1) throw new Error("PREPARED_POSITION_UNAVAILABLE");
    const language = z.enum(["en", "ru", "uz-Latn", "uz-Cyrl"]).parse(units[0].language);
    return lookup({ work: resolved.work, position: units[0].locator, language, scope, wholeSection: false }, signal);
  }
  const provisions: StoredProvisionReader = {
    async findInSource(request, signal) {
      if ((request.scope.kind === "current") !== (release.capability === "current")) throw new Error("CORPUS_SCOPE_MISMATCH");
      const resolved = await sourceForScope(request.work, request.scope, signal);
      request = { ...request, work: resolved.work };
      const item = resolved.item;
      const needle = request.contains.normalize("NFKC").toLocaleLowerCase();
      if (!needle.trim()) throw new Error("SOURCE_LOOKUP_UNAVAILABLE");
      return item.prepared.units.filter(unit => unit.language === request.language && typeof unit.text === "string"
        && unit.text.normalize("NFKC").toLocaleLowerCase().includes(needle))
        .map(unit => ({ position: unit.locator, text: String(unit.text) }));
    },
    async describeRange(request, signal) {
      if ((request.scope.kind === "current") !== (release.capability === "current")) throw new Error("CORPUS_SCOPE_MISMATCH");
      const resolved = await sourceForScope(request.work, request.scope, signal);
      request = { ...request, work: resolved.work };
      const item = resolved.item;
      const read = await objects.rangeReader(request.work, signal);
      const complete = read.describe({ ...request, wholeSection: false });
      const sourceNotes = retainedSourceNotes(item);
      const selected = item.prepared.units.find(unit => unit.locator === request.position);
      const hierarchy = hierarchySchema.safeParse(selected?.hierarchy);
      const sections: { position: string; title: string; key: string; textByteCount?: number; unitCount?: number }[] = [];
      let sectionUnits = Infinity;
      if (selected && hierarchy.success) for (const unit of item.prepared.units) {
        if (unit.ordinal > selected.ordinal || typeof unit.text !== "string") continue;
        const parent = hierarchySchema.safeParse(unit.hierarchy);
        if (!parent.success || !parent.data.length || parent.data.length > hierarchy.data.length
          || !parent.data.every((part, index) => part === hierarchy.data[index])
          || unit.text.trim() !== parent.data.at(-1)!.trim()) continue;
        const cacheKey = JSON.stringify([request.work, unit.locator, request.language]);
        if (!sectionRanges.has(cacheKey)) {
          try { sectionRanges.set(cacheKey, read.describe({ ...request, position: unit.locator, wholeSection: true })); }
          catch { sectionRanges.set(cacheKey, null); }
        }
        const section = sectionRanges.get(cacheKey);
        if (section?.sectionTitle && section.ordinals.includes(selected.ordinal) && section.ordinals.length < sectionUnits) {
          sectionUnits = section.ordinals.length;
          sections.splice(0, sections.length, { position: section.position, title: navigationTitle(parent.data, section), textByteCount: section.textByteCount, unitCount: section.unitCount,
            key: JSON.stringify([request.work, section.language, section.ordinals[0], section.ordinals.at(-1), request.scope]) });
        }
      }
      const directoryKey = JSON.stringify([request.work, request.language, request.scope]);
      if (!sectionDirectories.has(directoryKey)) {
        const completeSections: (NonNullable<ReturnType<ReturnType<typeof createPreparedProvisionReader>["describe"]>> & { navigationTitle: string })[] = [];
        for (const unit of item.prepared.units) {
          const path = hierarchySchema.safeParse(unit.hierarchy);
          if (!path.success || !path.data.length || typeof unit.text !== "string"
            || unit.text.trim() !== path.data.at(-1)!.trim()) continue;
          const cacheKey = JSON.stringify([request.work, unit.locator, request.language]);
          if (!sectionRanges.has(cacheKey)) {
            try { sectionRanges.set(cacheKey, read.describe({ ...request, position: unit.locator, wholeSection: true })); }
            catch { sectionRanges.set(cacheKey, null); }
          }
          const section = sectionRanges.get(cacheKey);
          // Some retained paths reset at a subheading. The preceding chapter
          // then spans only its heading, not the articles its title suggests.
          // Keep exact reads unchanged, but offer substantive ranges for navigation.
          if (section?.sectionTitle && section.ordinals.length > 1) {
            completeSections.push({ ...section, navigationTitle: navigationTitle(path.data, section) });
          }
        }
        sectionDirectories.set(directoryKey, completeSections.filter(section => !completeSections.some(child =>
          child !== section && child.ordinals[0] > section.ordinals[0] && child.ordinals.at(-1)! <= section.ordinals.at(-1)!))
          .map(section => ({ position: section.position, title: section.navigationTitle, textByteCount: section.textByteCount, unitCount: section.unitCount,
            key: JSON.stringify([request.work, section.language, section.ordinals[0], section.ordinals.at(-1), request.scope]) })));
      }
      const sourceSections = sectionDirectories.get(directoryKey)!;
      return { key: JSON.stringify([request.work, complete.language, complete.ordinals[0], complete.ordinals.at(-1), request.scope]),
        kind: complete.articleTitle && !complete.containsSectionHeadings ? "provision" : complete.sectionTitle ? "section" : "document", language: complete.language,
        textByteCount: complete.textByteCount, unitCount: complete.unitCount,
        ...(sourceNotes.length ? { sourceNotes } : {}), ...(sections.length ? { sections } : {}),
        ...(sourceSections.length ? { sourceSections } : {}) };
    },
    lookup,
    async introductory(request, signal) {
      const parent = receipts.get(request.parent.identity);
      if (!parent || !isDeepStrictEqual(parent.receipt.locator, request.parent)) throw new Error("INTRODUCTORY_PARENT_UNAVAILABLE");
      if (request.scope.kind === "current" ? parent.receipt.locator.temporalState !== "current_supported"
        : parent.receipt.locator.applicableAt !== request.scope.at) throw new Error("INTRODUCTORY_SCOPE_MISMATCH");
      const structure = parent.receipt.locator.sourceStructure;
      if (structure?.rangeKind !== "article") return null;
      const read = await objects.rangeReader(parent.work, signal);
      const position = read.firstArticle({ work: parent.work, position: structure.anchor.position,
        language: parent.receipt.language });
      if (!position) return null;
      const found = await lookup({ work: parent.work, position, language: parent.receipt.language, scope: request.scope }, signal);
      return found.articleTitle === null ? null : found;
    },
    async adjacent(request, signal) {
      const parent = receipts.get(request.parent.identity);
      if (!parent || !isDeepStrictEqual(parent.receipt.locator, request.parent)) throw new Error("ADJACENT_PARENT_UNAVAILABLE");
      if (request.scope.kind === "current" ? parent.receipt.locator.temporalState !== "current_supported"
        : parent.receipt.locator.applicableAt !== request.scope.at) throw new Error("ADJACENT_SCOPE_MISMATCH");
      const position = parent.adjacentPositions[request.direction];
      if (!position) return null;
      const found = await lookup({ work: parent.work, position, language: parent.receipt.language, scope: request.scope }, signal);
      // An uncertain neighbouring boundary cannot turn into recursive whole-source expansion.
      return found.articleTitle === null ? null : found;
    },
    async reference(request, signal) {
      const parent = receipts.get(request.parent.identity);
      if (!parent || !isDeepStrictEqual(parent.receipt.locator, request.parent)
        || !parent.receipt.locator.operativeReferences?.some(reference => reference.url === request.url)) {
        throw new Error("REFERENCE_NOT_AUTHENTICATED");
      }
      if (request.scope.kind === "current" ? parent.receipt.locator.temporalState !== "current_supported"
        : parent.receipt.locator.applicableAt !== request.scope.at) throw new Error("REFERENCE_SCOPE_MISMATCH");
      const target = publisherUrl(request.url), position = target.hash.slice(1);
      target.hash = "";
      // Only admitted evidence can authorize this shortcut. A cached source
      // whose lookup failed temporal checks must not hide a valid dated capture.
      for (const { work, receipt } of receipts.values()) {
        signal.throwIfAborted();
        const sameScope = request.scope.kind === "current" ? receipt.locator.temporalState === "current_supported"
          : receipt.locator.applicableAt === request.scope.at;
        if (!sameScope) continue;
        const document = publisherUrl(receipt.locator.sourceUrl); document.hash = "";
        if (document.href === target.href) return lookupReference(work, position, request.scope, signal);
      }
      if (!/^\/docs\/-?\d+$/u.test(target.pathname)) return null;
      const { work } = await resolveScopedReference(target, request.scope, signal);
      return work === null ? null : lookupReference(work, position, request.scope, signal);
    },
  };
  return { packageSha256: configuration.artifacts.packageSha256, provisions, get: objects.get };
}
