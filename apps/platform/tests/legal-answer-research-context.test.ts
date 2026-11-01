import assert from "node:assert/strict";
import test from "node:test";
import { researchCandidates, researchDiscovery, modelResearchDiscovery, researchEvidence, researchReferences } from "../lib/legal-answer-workflow/research-context";
import type { OfficialProvision } from "../lib/legal-answer-workflow/contracts";
import type { ReadCandidate } from "../lib/legal-answer-workflow/candidate-selection";

test("current model navigation places publisher-repealed instruments last without losing candidates or historical order", () => {
  const obsolete: ReadCandidate = { id: "c1", identity: "old", sourceUrl: "https://lex.uz/docs/123",
    text: "Old rule", truncated: false, sourceNotes: ["Акт утратил силу 01.01.2000", "Retained original notice"],
    scope: { kind: "current" }, query: "rule", queries: ["rule"], ranks: [{ query: "rule", rank: 0 }] };
  const current = { ...structuredClone(obsolete), id: "c2", identity: "current", sourceUrl: "https://lex.uz/docs/456",
    sourceNotes: ["Current publication metadata"] };
  const candidates = [obsolete, current], original = structuredClone(candidates);
  const packet = modelResearchDiscovery(candidates);
  assert.deepEqual(packet.unreadCandidates.map(item => item.id), ["c2", "c1"]);
  const old = packet.unreadCandidates.find(item => item.id === "c1")!;
  assert.deepEqual(packet.candidateSourceNotes[old.sourceNotesRef!], obsolete.sourceNotes);
  assert.deepEqual(candidates, original);
  const historical = candidates.map(item => ({ ...item, scope: { kind: "historical" as const, at: "1999-01-01" } }));
  assert.deepEqual(modelResearchDiscovery(historical).unreadCandidates.map(item => item.id), ["c1", "c2"]);
});

test("publisher contents remain separate navigation shared by exact source metadata", () => {
  const base: ReadCandidate = { id: "c1", identity: "one", sourceUrl: "https://lex.uz/docs/123", language: "en",
    text: "Preview", truncated: true, scope: { kind: "current" }, query: "rule", queries: ["rule"], ranks: [],
    selectedEditions: ["2020"], requestedEdition: null, publisherContents: [{ position: "10", title: "Procedure" }] };
  const candidates = [base, { ...structuredClone(base), id: "c2", identity: "two" },
    { ...structuredClone(base), id: "c3", identity: "other", sourceUrl: "https://lex.uz/docs/456" },
    { ...structuredClone(base), id: "c4", identity: "dated", requestedEdition: "2019", selectedEditions: ["2019"],
      scope: { kind: "historical" as const, at: "2019-01-01" } }];
  const before = structuredClone(candidates), packet = modelResearchDiscovery(candidates, new Set());
  assert.equal(Object.keys(packet.candidateSources).length, 3);
  assert.equal(packet.unreadCandidates[0].sourceRef, packet.unreadCandidates[1].sourceRef);
  for (const candidate of packet.unreadCandidates) {
    assert.equal(candidate.readRange, undefined);
    assert.deepEqual(packet.candidateSources[candidate.sourceRef].publisherContents, base.publisherContents);
    assert.equal(candidate.navigationOnly, true);
  }
  assert.deepEqual(packet.candidateSourceSections, {});
  assert.deepEqual(candidates, before);
});

test("section directories expose an exact read action from their own source, language and scope", () => {
  const base: ReadCandidate = { id: "c1", identity: "first", sourceUrl: "https://lex.uz/docs/123",
    text: "Preview", truncated: true, scope: { kind: "current" }, query: "rule", queries: ["rule"],
    ranks: [{ query: "rule", rank: 0 }], readRange: { key: "range", kind: "provision", language: "ru",
      sourceSections: [{ key: "section", position: "10", title: "Procedure" }] } };
  const candidates: ReadCandidate[] = [base,
    { ...structuredClone(base), id: "alias", identity: "alias" },
    { ...structuredClone(base), id: "other-act", identity: "other", sourceUrl: "https://lex.uz/docs/456",
      readRange: { ...structuredClone(base.readRange!), key: "other-range",
        sourceSections: [{ key: "other-section", position: "20", title: "Procedure" }] } },
    { ...structuredClone(base), id: "historical", identity: "historical", scope: { kind: "historical", at: "2020-01-01" } },
    { ...structuredClone(base), id: "uzbek", identity: "uzbek", readRange: { ...structuredClone(base.readRange!), language: "uz" } }];
  const before = structuredClone(candidates);
  const packet = modelResearchDiscovery(candidates, new Set());
  assert.equal(packet.unreadCandidates.length, 4);
  assert.equal(Object.keys(packet.candidateSourceSections).length, 4);
  for (const candidate of packet.unreadCandidates) {
    const routes = packet.candidateSourceSections[candidate.readRange!.sourceSectionsRef!];
    assert.deepEqual(routes, candidates.find(item => item.id === candidate.id)!.readRange!.sourceSections!.map(section => ({
      candidateId: candidate.id, sectionPosition: section.position, title: section.title,
    })));
  }
  assert.deepEqual(candidates, before);
});

test("model navigation places an exact status preview beside its source title while preserving complete notices", () => {
  const notice = "Repealed on a recorded date. " + "Additional retained status context. ".repeat(20);
  const candidate: ReadCandidate = { id: "c1", identity: "stored", sourceUrl: "https://lex.uz/docs/123",
    text: "Relevant discovery text", sourceNotes: [notice, "Separate qualification"], truncated: false,
    scope: { kind: "current" }, query: "rule", queries: ["rule"], ranks: [{ query: "rule", rank: 0 }] };
  const before = structuredClone(candidate);
  const packet = modelResearchDiscovery([candidate]);
  const source = packet.candidateSources[packet.unreadCandidates[0].sourceRef];
  assert.deepEqual(source.notices, [{ sourceNotesRef: packet.unreadCandidates[0].sourceNotesRef,
    sourceNoticePreview: { text: Array.from(notice).slice(0, 240).join(""), truncated: true },
  }]);
  assert.deepEqual(packet.candidateSourceNotes[packet.unreadCandidates[0].sourceNotesRef!], candidate.sourceNotes);
  const later = modelResearchDiscovery([candidate], new Set());
  assert.deepEqual(later.candidateSources[later.unreadCandidates[0].sourceRef].notices, source.notices);
  assert.deepEqual(later.candidateSourceNotes[later.unreadCandidates[0].sourceNotesRef!], candidate.sourceNotes);
  assert.equal(later.unreadCandidates[0].text, "");
  assert.deepEqual(candidate, before);
});

test("shared source previews reconstruct each candidate's own notice without mixing ranges or scopes", () => {
  const base: ReadCandidate = { id: "c1", identity: "first", sourceUrl: "https://lex.uz/docs/123", title: "Source",
    language: "ru", sourceNotes: ["Repealed in the captured edition."], text: "Navigation", truncated: true,
    scope: { kind: "current" }, query: "rule", queries: ["rule"], ranks: [] };
  const candidates: ReadCandidate[] = [base, { ...base, id: "c2", identity: "second" },
    { ...base, id: "c3", identity: "third", sourceNotes: undefined,
      readRange: { key: "local", kind: "provision", language: "ru", sourceNotes: ["Distinct local qualification."] } },
    { ...base, id: "c4", identity: "historical", scope: { kind: "historical", at: "2020-01-01" },
      sourceNotes: ["Historical applicability notice."] },
    { ...base, id: "c5", identity: "other-language", language: "uz", sourceNotes: ["Other language notice."] }];
  const packet = modelResearchDiscovery(candidates, new Set());
  assert.equal(Object.keys(packet.candidateSources).length, 2);
  assert.equal(Object.values(packet.candidateSources).reduce((count, source) => count + (source.notices?.length ?? 0), 0), 4);
  for (const [index, candidate] of packet.unreadCandidates.entries()) {
    assert.equal(candidate.text, "");
    assert.equal("sourceNoticePreview" in candidate, false);
    const ref = candidate.sourceNotesRef ?? candidate.readRange?.sourceNotesRef;
    const entries = packet.candidateSources[candidate.sourceRef].notices!.filter(entry => entry.sourceNotesRef === ref);
    assert.equal(entries.length, 1);
    const original = candidates[index].sourceNotes ?? candidates[index].readRange!.sourceNotes!;
    assert.deepEqual(entries[0].sourceNoticePreview, { text: original[0], truncated: false });
    assert.deepEqual(packet.candidateSourceNotes[ref!], original);
    assert.deepEqual(candidate.scope, candidates[index].scope);
  }
});

test("model context preserves complete law, temporal applicability, references and PDF association", () => {
  const provision: OfficialProvision = { identity: "stored-rule", snapshot: "generation", objectKey: "storage-only",
    sha256: "a".repeat(64), byteCount: 100, privacyClass: "public_official_source", quarantined: false,
    canonicalizationConflict: false, currentPointerVerified: false, temporalState: "historical_only",
    applicableAt: "2020-01-01", articleNumber: "12", sourceUrl: "https://lex.uz/docs/123#12",
    sourceNotes: ["Repealed after the requested historical date.", "The transition has a separate exception."],
    sourceStructure: { navigationOnly: true, rangeKind: "stored_section", rangeTitle: "Container",
      anchor: { position: "12", ordinal: 2, language: "ru" },
      headings: [{ position: "10", ordinal: 0, language: "ru", text: "Local heading", hierarchy: ["Container", "Local heading"] }] },
    text: "Complete rule. ".repeat(1000) + "Final material exception: both conditions must hold.",
    operativeReferences: [{ url: "https://lex.uz/docs/456#9", text: "Exception procedure" }],
    editionObservation: { selectedEdition: "01.01.2020", observedAt: "2026-01-01T00:00:00.000Z" },
    sourceFile: { objectKey: "stored.pdf", sha256: "b".repeat(64), byteCount: 100 } };
  const [context] = researchEvidence([provision]);
  assert.equal(context.text, provision.text);
  assert.equal(context.identity, provision.identity);
  assert.equal(context.requestedLegalDate, provision.applicableAt);
  assert.equal(context.retrievalScope, "historical_edition");
  assert.deepEqual(context.operativeReferences, provision.operativeReferences);
  assert.deepEqual(context.editionObservation, provision.editionObservation);
  assert.deepEqual(context.sourceNotes, provision.sourceNotes);
  assert.deepEqual(context.sourceStructure, provision.sourceStructure);
  context.sourceStructure!.headings[0].hierarchy.push("Changed model context");
  assert.deepEqual(provision.sourceStructure!.headings[0].hierarchy, ["Container", "Local heading"]);
  assert.deepEqual(context.sourceFile, { attached: true });
  assert.equal(context.textCompleteness, "navigation_for_attached_file");
  assert.equal("objectKey" in context, false);
  assert.equal(provision.sourceFile?.objectKey, "stored.pdf");
  const target = "https://lex.uz/docs/456#9";
  const links = [{ url: target, text: "Exception procedure" }, { url: target, text: "Other retained label" },
    { url: target, text: "Exception procedure" }];
  assert.deepEqual(researchReferences([
    { ...provision, operativeReferences: links },
    { ...provision, identity: "current-rule", temporalState: "current_supported", applicableAt: undefined,
      operativeReferences: [{ url: target, text: "Current reference" }] },
  ], new Set([JSON.stringify(["stored-rule", target])])), [
    { sourceId: "stored-rule", url: target, texts: ["Exception procedure", "Other retained label"],
      scope: { kind: "historical", at: "2020-01-01" }, attempted: true },
    { sourceId: "current-rule", url: target, texts: ["Current reference"], scope: { kind: "current" }, attempted: false },
  ]);
});

test("current release capture does not label repealed text as legally in force", () => {
  const historical: OfficialProvision = { identity: "old-act", snapshot: "generation", objectKey: "stored",
    sha256: "a".repeat(64), byteCount: 100, privacyClass: "public_official_source", quarantined: false,
    canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported",
    sourceUrl: "https://lex.uz/docs/123", text: "Act repealed. Complete historical rule and exception." };
  const [context] = researchEvidence([historical]);
  assert.equal(context.textCompleteness, "complete");
  assert.equal(context.retrievalScope, "current_release");
  assert.equal("temporalState" in context, false);
  assert.equal(context.text, historical.text);
});

test("model navigation preserves every choice, heading, ranking and section position without opaque storage keys", () => {
  const candidates: ReadCandidate[] = Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, identity: `opaque-${index}`,
    sourceUrl: "https://lex.uz/docs/123", title: "Synthetic act", hierarchy: ["Part", "Chapter", "Procedure"],
    scope: { kind: "current" }, text: `Preview ${index}`, truncated: true,
    query: "procedure", queries: ["procedure"], ranks: [{ query: "procedure", rank: index, vectorRank: 20 - index,
      keywordRank: index, vectorScore: 0.5, keywordScore: 12, fusionScore: 0.03 }],
    readRange: { key: `opaque-range-${index}`, kind: "provision", language: "ru",
      sections: [{ key: "opaque-section", title: "Procedure", position: "section-position" }] },
  }));
  const packet = modelResearchDiscovery(candidates);
  assert.equal(Object.keys(packet.candidateHierarchies).length, 1);
  assert.equal(packet.unreadCandidates.length, candidates.length);
  for (const [index, candidate] of packet.unreadCandidates.entries()) {
    assert.deepEqual(packet.candidateHierarchies[candidate.hierarchyRef!], candidates[index].hierarchy);
    assert.equal(candidate.matches[0].id, candidates[index].id);
    assert.deepEqual(candidate.matches[0].ranks[0], ["q1", index, 20 - index, index, 0.5, 12, 0.03]);
    assert.equal(candidate.readRange?.sections?.[0].position, "section-position");
    assert.equal(candidate.text, candidates[index].text);
  }
  assert.equal(JSON.stringify(packet).includes("opaque-"), false);
});

test("short discovery previews retain every addressable candidate and disclose truncation", () => {
  const candidate: ReadCandidate = { id: "c1", identity: "stored-candidate", sourceUrl: "https://lex.uz/docs/123",
    text: "😀".repeat(300), truncated: false, title: "Artificial act", hierarchy: ["Article 8. Conditions"],
    scope: { kind: "historical", at: "2020-01-01" }, query: "conditions", queries: ["conditions"],
    ranks: [{ query: "conditions", rank: 0 }] };
  const selected = researchCandidates([candidate, { ...candidate, id: "c2", identity: "second-candidate", text: "Full preview" }]);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].text, "😀".repeat(240));
  assert.equal(selected[0].truncated, true);
  assert.equal(selected[1].truncated, false);
  assert.deepEqual(selected[0].scope, candidate.scope);
  assert.deepEqual(selected[0].hierarchy, candidate.hierarchy);
  assert.equal(candidate.text, "😀".repeat(300));
});

test("compact discovery reconstructs every query, rank and preview without changing retained candidates", () => {
  const query = "A long question with legally distinguishing conditions. ".repeat(20);
  const candidates: ReadCandidate[] = Array.from({ length: 80 }, (_, index) => ({
    id: `c${index + 1}`, identity: `identity-${index}`, sourceUrl: "https://lex.uz/docs/123",
    title: "Act", hierarchy: ["Section"], text: `Preview ${index}: 😀\nRule`, truncated: false,
    scope: { kind: "current" }, readRange: { key: `range-${Math.floor(index / 2)}`, language: "ru", kind: "section",
      sourceNotes: ["Status notice with complete applicability conditions. ".repeat(20), `Edition ${index % 2}`] },
    query, queries: [query, "second query"], ranks: [{ query, rank: index }, { query: "second query", rank: 80 - index }],
  }));
  const before = structuredClone(candidates);
  const original = researchCandidates(candidates);
  const compact = researchDiscovery(candidates);
  const expanded = compact.unreadCandidates.map(({ sourceRef, ...group }) => ({ ...group, ...compact.candidateSources[sourceRef],
    readRange: group.readRange ? (() => {
      const { sourceNotesRef, ...range } = group.readRange;
      return { ...range, ...(sourceNotesRef ? { sourceNotes: compact.candidateSourceNotes[sourceNotesRef] } : {}) };
    })() : undefined,
    matches: group.matches.map(({ preview, ...match }) => ({ ...match,
      queries: match.queries.map(id => compact.candidateQueries[id]),
      ranks: match.ranks.map(rank => ({ ...rank, query: compact.candidateQueries[rank.query] })),
      text: group.text.slice(preview.start, preview.end),
    })),
  }));
  assert.deepEqual(expanded, original);
  assert.deepEqual(candidates, before);
  assert.equal(expanded.flatMap(group => group.matches).length, 80);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(original).length / 2);
});

test("prior navigation retains applicability notices when stale search previews are omitted", () => {
  const candidates: ReadCandidate[] = ["c1", "c2"].map(id => ({ id, identity: `stored-${id}`,
    sourceUrl: `https://lex.uz/docs/${id === "c1" ? "123" : "456"}`, title: `Act ${id}`,
    language: "ru", selectedEditions: ["01.01.2020"], requestedEdition: "01.01.2020",
    hierarchy: ["Rights and exceptions"], text: `Discovery text ${id}`, sourceNotes: [`Applicability ${id}`],
    truncated: true, scope: { kind: "historical", at: "2020-01-01" },
    query: "rights", queries: ["rights"], ranks: [{ query: "rights", rank: 0 }],
  }));
  candidates[1].readRange = { key: "historical-range", kind: "provision", language: "ru",
    sourceNotes: ["The selected range has a separate temporal qualification."] };
  const original = structuredClone(candidates);
  const packet = researchDiscovery(candidates, new Set(["c1"]));
  assert.equal(packet.unreadCandidates[0].text, candidates[0].text);
  const compact = packet.unreadCandidates[1];
  assert.equal(compact.navigationOnly, true); assert.equal(compact.text, "");
  assert.equal(compact.matches[0].id, "c2");
  assert.deepEqual(compact.hierarchy, candidates[1].hierarchy);
  assert.deepEqual(compact.scope, candidates[1].scope);
  assert.equal(packet.candidateSources[compact.sourceRef].requestedEdition, "01.01.2020");
  assert.equal(Object.keys(packet.candidateSourceNotes).length, 3);
  assert.deepEqual(packet.candidateSourceNotes[compact.sourceNotesRef!], candidates[1].sourceNotes);
  assert.deepEqual(packet.candidateSourceNotes[compact.readRange!.sourceNotesRef!], candidates[1].readRange!.sourceNotes);
  assert.deepEqual(candidates, original);
  assert.equal(researchDiscovery(candidates, new Set(["c2"])).unreadCandidates[1].text, candidates[1].text);
});
