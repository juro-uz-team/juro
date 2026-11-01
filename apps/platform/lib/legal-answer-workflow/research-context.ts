import type { OfficialProvision } from "./contracts";
import type { ReadCandidate } from "./candidate-selection";
import { publisherNavigationPriority } from "./publisher-notices";
import type { ReferenceOrigin } from "./evidence";

// Full passage text and heading metadata already occur in the complete source.
// Keep exact navigation positions here instead of duplicating them per link.
const originNavigation = (origin: ReferenceOrigin) => ({ position: origin.position, ordinal: origin.ordinal,
  ...(origin.precedingHeading ? { precedingHeadingPosition: origin.precedingHeading.position } : {}) });

/** Exact retained links are navigation actions, never evidence of the target's law. */
export function researchReferences(provisions: readonly OfficialProvision[], attempted: ReadonlySet<string>) {
  return provisions.flatMap(provision => {
    const links = new Map<string, string[]>();
    const origins = new Map<string, ReferenceOrigin[]>();
    for (const reference of provision.operativeReferences ?? []) {
      const texts = links.get(reference.url) ?? [];
      if (!texts.includes(reference.text)) texts.push(reference.text);
      links.set(reference.url, texts);
      for (const origin of reference.origins ?? []) {
        const retained = origins.get(reference.url) ?? [];
        if (!retained.some(item => item.ordinal === origin.ordinal)) retained.push(structuredClone(origin));
        origins.set(reference.url, retained);
      }
    }
    return [...links].map(([url, texts]) => ({ sourceId: provision.identity, url, texts,
      ...(origins.has(url) ? { origins: origins.get(url)!.map(originNavigation) } : {}),
      scope: provision.applicableAt ? { kind: "historical" as const, at: provision.applicableAt } : { kind: "current" as const },
      attempted: attempted.has(JSON.stringify([provision.identity, url])),
    }));
  });
}

/** Storage custody stays in request state; the agent receives complete law and its applicability context. */
export function researchEvidence(provisions: readonly OfficialProvision[]) {
  return provisions.map(provision => ({
    identity: provision.identity, textCompleteness: provision.sourceFile ? "navigation_for_attached_file" : "complete",
    sourceUrl: provision.sourceUrl,
    ...(provision.sourceTitle !== undefined ? { sourceTitle: provision.sourceTitle } : {}),
    retrievalScope: provision.temporalState === "current_supported" ? "current_release"
      : provision.temporalState === "historical_only" ? "historical_edition" : provision.temporalState,
    ...(provision.applicableAt ? { requestedLegalDate: provision.applicableAt } : {}),
    ...(provision.articleNumber ? { articleNumber: provision.articleNumber } : {}),
    ...(provision.editionObservation ? { editionObservation: provision.editionObservation } : {}),
    ...(provision.sourceNotes?.length ? { sourceNotes: [...provision.sourceNotes] } : {}),
    ...(provision.sourceStructure ? { sourceStructure: structuredClone(provision.sourceStructure) } : {}),
    ...(provision.operativeReferences ? { operativeReferences: provision.operativeReferences.map(reference => ({
      url: reference.url, text: reference.text,
      ...(reference.origins ? { origins: reference.origins.map(originNavigation) } : {}),
    })) } : {}),
    ...(provision.sourceFile ? { sourceFile: { attached: true } } : {}),
    text: provision.text,
  }));
}

/** Model navigation needs selectable IDs and legal metadata, not storage custody keys.
 * Repeated headings and ranking field names are represented once; all ranks survive. */
export function modelResearchDiscovery(candidates: readonly ReadCandidate[], previewIds?: ReadonlySet<string>, queryLabels?: ReadonlyMap<string, string>) {
  const packet = researchDiscovery(candidates, previewIds, queryLabels);
  const priorities = new Map(candidates.map(candidate => [candidate.id, publisherNavigationPriority(candidate)]));
  const hierarchyIds = new Map<string, string>();
  const candidateHierarchies: Record<string, string[]> = {};
  const rankColumns = ["query", "rank", "vectorRank", "keywordRank", "vectorScore", "keywordScore", "fusionScore"] as const;
  const extent = (range: { textByteCount?: number; unitCount?: number }) => ({
    ...(range.textByteCount !== undefined ? { textByteCount: range.textByteCount } : {}),
    ...(range.unitCount !== undefined ? { unitCount: range.unitCount } : {}),
  });
  const section = (range: { position: string; title: string; textByteCount?: number; unitCount?: number }) =>
    ({ position: range.position, title: range.title, ...extent(range) });
  const sectionOwners = new Map<string, string>();
  const candidateSources: Record<string, (typeof packet.candidateSources)[string] & {
    notices: { sourceNotesRef: string; sourceNoticePreview: { text: string; truncated: boolean } }[];
  }> = Object.fromEntries(Object.entries(packet.candidateSources).map(([id, source]) => [id, { ...source, notices: [] }]));
  for (const candidate of packet.unreadCandidates) {
    const directory = candidate.readRange?.sourceSectionsRef;
    if (directory && !sectionOwners.has(directory)) sectionOwners.set(directory, candidate.id);
    const sourceNotesRef = candidate.sourceNotesRef ?? candidate.readRange?.sourceNotesRef;
    const firstNotice = sourceNotesRef ? packet.candidateSourceNotes[sourceNotesRef]?.[0] : undefined;
    const notices = candidateSources[candidate.sourceRef].notices;
    if (sourceNotesRef && firstNotice && !notices.some(notice => notice.sourceNotesRef === sourceNotesRef)) {
      const characters = Array.from(firstNotice);
      notices.push({ sourceNotesRef, sourceNoticePreview: { text: characters.slice(0, 240).join(""),
        truncated: characters.length > 240 } });
    }
  }
  return { ...packet, candidateSources, rankColumns, candidateHierarchies,
    candidateSourceSections: Object.fromEntries(Object.entries(packet.candidateSourceSections)
      .map(([id, sections]) => [id, sections.map(range => ({
        candidateId: sectionOwners.get(id)!, sectionPosition: range.position, title: range.title, ...extent(range),
      }))])),
    unreadCandidates: packet.unreadCandidates.map(({ id, hierarchy, matches, readRange, ...candidate }) => {
      const noteRef = candidate.sourceNotesRef ?? readRange?.sourceNotesRef;
      const notice = noteRef && priorities.get(id) === 1 ? packet.candidateSourceNotes[noteRef]?.[0] : undefined;
      const noticeCharacters = notice ? Array.from(notice) : [];
      let hierarchyRef: string | undefined;
      if (hierarchy) {
        const key = JSON.stringify(hierarchy);
        if (!hierarchyIds.has(key)) {
          const id = `h${hierarchyIds.size + 1}`;
          hierarchyIds.set(key, id); candidateHierarchies[id] = [...hierarchy];
        }
        hierarchyRef = hierarchyIds.get(key);
      }
      return { id,
        ...(notice ? { publisherNotice: { sourceNotesRef: noteRef, text: noticeCharacters.slice(0, 240).join(""),
          truncated: noticeCharacters.length > 240 } } : {}),
        ...candidate, ...(hierarchyRef ? { hierarchyRef } : {}),
        readRange: readRange ? { kind: readRange.kind, language: readRange.language, ...extent(readRange),
          ...(readRange.sections ? { sections: readRange.sections.map(section) } : {}),
          ...(readRange.sourceNotesRef ? { sourceNotesRef: readRange.sourceNotesRef } : {}),
          ...(readRange.sourceSectionsRef ? { sourceSectionsRef: readRange.sourceSectionsRef } : {}) } : undefined,
        matches: matches.map(match => ({ id: match.id, queries: match.queries, truncated: match.truncated,
          preview: match.preview, ranks: match.ranks.map(rank => rankColumns.map(column => rank[column] ?? null)) })),
      };
    // Reorder only presentation, after exact representatives and section owners
    // are bound. Every handle and original rank remains selectable and retained.
    }).sort((a, b) => (priorities.get(a.id) ?? 0) - (priorities.get(b.id) ?? 0)),
  };
}

/** Previews guide optional complete reads; they cannot supply substantive law. */
export function researchCandidates(candidates: readonly ReadCandidate[], queryIds?: ReadonlyMap<string, string>) {
  const groups = new Map<string, ReadCandidate[]>();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.readRange?.key ?? candidate.identity, candidate.readRange?.language, candidate.scope]);
    const group = groups.get(key) ?? []; group.push(candidate); groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const { id, sourceUrl, scope, title, hierarchy, readRange, sourceNotes, language, selectedEditions, requestedEdition, publisherContents } = group[0];
    const matches = group.map(({ id, identity, queries, ranks, text, truncated }) => ({ id, identity,
      queries: queries.map(query => queryIds?.get(query) ?? query),
      ranks: ranks.map(({ query, ...rank }) => ({ query: queryIds?.get(query) ?? query, ...rank })),
      text: Array.from(text).slice(0, 240).join(""), truncated: truncated || Array.from(text).length > 240 }));
    return { id, sourceUrl, text: matches.map(item => item.text).join("\n"),
      truncated: matches.some(item => item.truncated), scope, title, hierarchy, readRange, matches,
      ...(language ? { language } : {}), ...(selectedEditions ? { selectedEditions } : {}),
      ...(requestedEdition !== undefined ? { requestedEdition } : {}),
      ...(sourceNotes ? { sourceNotes } : {}), ...(publisherContents ? { publisherContents } : {}) };
  });
}

/** Lossless navigation compression: query references and preview spans resolve within this packet. */
export function researchDiscovery(candidates: readonly ReadCandidate[], previewIds?: ReadonlySet<string>, queryLabels?: ReadonlyMap<string, string>) {
  const queryIds = new Map<string, string>(queryLabels);
  const noteIds = new Map<string, string>();
  const candidateSourceNotes: Record<string, string[]> = {};
  const noteReference = (notes: string[]) => {
    const key = JSON.stringify(notes);
    if (!noteIds.has(key)) {
      const id = `n${noteIds.size + 1}`;
      noteIds.set(key, id); candidateSourceNotes[id] = [...notes];
    }
    return noteIds.get(key)!;
  };
  const sectionIds = new Map<string, string>();
  const sourceIds = new Map<string, string>();
  const candidateSources: Record<string, Pick<ReturnType<typeof researchCandidates>[number],
    "sourceUrl" | "title" | "language" | "selectedEditions" | "requestedEdition" | "publisherContents">> = {};
  const candidateSourceSections: Record<string, { position: string; title: string; key: string; textByteCount?: number; unitCount?: number }[]> = {};
  for (const candidate of candidates) {
    for (const query of [...candidate.queries, ...candidate.ranks.map(item => item.query)]) {
      if (!queryIds.has(query)) queryIds.set(query, `q${queryIds.size + 1}`);
    }
  }
  const unreadCandidates = researchCandidates(candidates, queryIds).map(original => {
      // Omit stale search previews from the current packet, but retain known
      // applicability notices so source selection does not lose repeal or date context.
      const navigationOnly = previewIds !== undefined && !original.matches.some(match => previewIds.has(match.id));
      const candidate = navigationOnly ? { ...original, text: "", truncated: true,
        matches: original.matches.map(match => ({ ...match, text: "", truncated: true })) } : original;
      let offset = 0;
      const notes = candidate.readRange?.sourceNotes;
      let readRange: Omit<NonNullable<typeof candidate.readRange>, "sourceNotes" | "sourceSections"> & {
        sourceNotesRef?: string; sourceSectionsRef?: string } | undefined = candidate.readRange;
      if (notes) {
        const range = { ...candidate.readRange! };
        delete range.sourceNotes;
        readRange = { ...range, sourceNotesRef: noteReference(notes) };
      }
      const sections = candidate.readRange?.sourceSections;
      if (sections) {
        // A direct read action must stay bound to the same source edition,
        // language and requested scope even when its heading positions coincide.
        const key = JSON.stringify([candidate.sourceUrl, candidate.scope, candidate.readRange?.language,
          candidate.selectedEditions, candidate.requestedEdition, sections]);
        if (!sectionIds.has(key)) {
          const id = `d${sectionIds.size + 1}`;
          sectionIds.set(key, id); candidateSourceSections[id] = structuredClone(sections);
        }
        const range = { ...readRange } as NonNullable<typeof readRange> & { sourceSections?: typeof sections };
        delete range.sourceSections;
        readRange = { ...range, sourceSectionsRef: sectionIds.get(key)! };
      }
      const { sourceNotes, sourceUrl, title, language, selectedEditions, requestedEdition, publisherContents, ...metadata } = candidate;
      const source = { sourceUrl, title, ...(language ? { language } : {}),
        ...(publisherContents ? { publisherContents } : {}),
        ...(selectedEditions ? { selectedEditions } : {}), ...(requestedEdition !== undefined ? { requestedEdition } : {}) };
      const sourceKey = JSON.stringify(source);
      if (!sourceIds.has(sourceKey)) {
        const id = `document${sourceIds.size + 1}`;
        sourceIds.set(sourceKey, id); candidateSources[id] = source;
      }
      return { ...metadata, ...(navigationOnly ? { navigationOnly: true } : {}), sourceRef: sourceIds.get(sourceKey)!,
        ...(sourceNotes ? { sourceNotesRef: noteReference(sourceNotes) } : {}), readRange, matches: candidate.matches.map(({ text, ...match }) => {
        const preview = { start: offset, end: offset + text.length };
        offset = preview.end + 1;
        return { ...match, preview };
      }) };
    });
  return {
    candidateQueries: Object.fromEntries([...queryIds].map(([query, id]) => [id, query])),
    candidateSourceNotes,
    candidateSourceSections,
    candidateSources,
    unreadCandidates,
  };
}
