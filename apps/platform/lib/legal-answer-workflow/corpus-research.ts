import { maximumCandidateDescriptionBatch, type Interpretation, type ResearchTurn, type OfficialProvision, type WorkflowPorts } from "./contracts";
import { withinSignal } from "./lifetime";
import { readOfficialProvision } from "./evidence";
import { ResearchNavigation } from "./research-navigation";
import { automaticReadPriority, candidateSearchKey, discoverReadCandidates, type ReadCandidate } from "./candidate-selection";
import type { ResearchWorkspace, ResearchOutcome } from "./research-workspace";

/** Deterministic acquisition and navigation; request control stays with the caller. */
export function createCorpusResearch(ports: WorkflowPorts, workspace: ResearchWorkspace, researchSignal: AbortSignal, signal: AbortSignal) {
  const inventory = workspace.inventory;
  const retainEvidence = (provision: OfficialProvision) => workspace.retain(provision);
  const searches = new Set<string>();
  const candidateReads = new Map<string, Promise<OfficialProvision | false>>();
  let automaticReads = 0;
  let acquisitionQueue = Promise.resolve();
  const selectedCandidates = new Set<string>();
  const attemptedCandidateReads = new Set<string>();
  const selectedSections = new Set<string>();
  const attemptedPublisherContents = new Set<string>();
  const publisherContentKey = (candidate: ReadCandidate, position: string) => JSON.stringify([
    candidate.sourceUrl, candidate.language, candidate.scope, candidate.selectedEditions, candidate.requestedEdition, position]);
  const completedSections = new Set<string>();
  const acquiredRanges = new Set<string>();
  const acquiredSources = new Set<string>();
  const completeDocuments = new Set<string>();
  const sourceScopeKey = (candidate: ReadCandidate) => JSON.stringify([candidate.sourceUrl,
    candidate.readRange?.language ?? candidate.language, candidate.selectedEditions, candidate.requestedEdition, candidate.scope]);
  const documentKey = (candidate: ReadCandidate) => JSON.stringify([sourceScopeKey(candidate),
    candidate.readRange?.language || candidate.language ? null : candidate.identity]);
  const acquiredRangeKey = (candidate: ReadCandidate, key: string) => JSON.stringify([sourceScopeKey(candidate), key]);
  const offeredSections = (candidate: ReadCandidate | undefined) => [...(candidate?.readRange?.sections ?? []), ...(candidate?.readRange?.sourceSections ?? [])];
  const referenceReads = new Set<string>();
  const literalLookups = new Set<string>();
  const discoveredCandidates: ReadCandidate[] = [];
  const navigation = new ResearchNavigation();
  const queryLabels = new Map<string, string>();
  const labelQuery = (query: string) => {
    if (!queryLabels.has(query)) queryLabels.set(query, `q${queryLabels.size + 1}`);
  };
  const researchFailures: { candidate: string; scope: Interpretation["scopes"][number]; code: string }[] = [];
  const researchLimits: { query: string; scope: Interpretation["scopes"][number]; omittedCandidates: number }[] = [];
  const acquireCandidate = (identity: string, scope: Interpretation["scopes"][number], sectionPosition?: string, wholeDocument = false) => {
    // Reading an enclosing section covers discovery hits, but does not prevent
    // selecting a smaller complete provision while preserving the earlier law.
    if (!sectionPosition) attemptedCandidateReads.add(JSON.stringify([identity, scope]));
    // Scope is part of the key: a current lookup cannot satisfy a historical request.
    const choice = discoveredCandidates.find(item => item.identity === identity && JSON.stringify(item.scope) === JSON.stringify(scope));
    const section = sectionPosition ? offeredSections(choice).find(item => item.position === sectionPosition) : undefined;
    const key = wholeDocument && choice ? JSON.stringify(["document", documentKey(choice)])
      : JSON.stringify([section && choice ? acquiredRangeKey(choice, section.key) : identity, scope, sectionPosition ?? null]);
    let pending = candidateReads.get(key);
    if (!pending) {
      pending = (async () => {
        try {
          const locator = await withinSignal(researchSignal, () => wholeDocument
            ? ports.corpus.resolveDocument!(identity, scope, researchSignal)
            : ports.corpus.resolve(identity, scope, researchSignal, sectionPosition));
          if (!locator) throw new Error("OFFICIAL_PROVISION_NOT_FOUND");
          if (!wholeDocument && locator.sourceStructure?.rangeKind === "document")
            throw new Error("WHOLE_DOCUMENT_SELECTION_REQUIRED");
          const provision = await withinSignal(researchSignal, () => readOfficialProvision(locator, ports.corpus, scope, researchSignal));
          retainEvidence(provision);
          if (wholeDocument && choice) {
            completeDocuments.add(documentKey(choice));
            for (const item of discoveredCandidates) if (documentKey(item) === documentKey(choice))
              selectedCandidates.add(JSON.stringify([item.identity, item.scope]));
            return provision;
          }
          if (section && choice) { completedSections.add(acquiredRangeKey(choice, section.key)); selectedSections.add(acquiredRangeKey(choice, section.key)); }
          else if (choice?.readRange?.kind === "section") {
            completedSections.add(acquiredRangeKey(choice, choice.readRange.key));
            selectedSections.add(acquiredRangeKey(choice, choice.readRange.key));
          }
          // Full structural navigation is useful after selecting a source; discovery
          // itself need not load every complete document merely to describe a hit.
          if (choice && !choice.readRange && ports.corpus.describeCandidates) {
            try {
              const [navigation] = await withinSignal(researchSignal, () => ports.corpus.describeCandidates!([identity], scope, researchSignal, true));
              if (navigation?.identity === identity) Object.assign(choice, navigation);
            } catch { researchSignal.throwIfAborted(); }
          }
          const range = choice?.readRange;
          if (choice && range) {
            acquiredSources.add(sourceScopeKey(choice));
            const completed = sectionPosition ? offeredSections(choice).find(item => item.position === sectionPosition)?.key : range.key;
            if (completed) {
              acquiredRanges.add(acquiredRangeKey(choice, completed));
              workspace.registerRange(provision.identity, completed, choice);
            }
          }
          if (range) for (const item of discoveredCandidates) {
            const covered = section ? item.readRange?.sections?.some(value => value.key === section.key) : item.readRange?.key === range.key;
            if (covered && choice && sourceScopeKey(item) === sourceScopeKey(choice)) {
              selectedCandidates.add(JSON.stringify([item.identity, item.scope]));
              if (!sectionPosition) attemptedCandidateReads.add(JSON.stringify([item.identity, item.scope]));
            }
          }
          return provision;
        } catch (error) {
          researchSignal.throwIfAborted();
          // Only fixed public categories enter model context; adapter errors can contain credentials or private diagnostics.
          const allowed = new Set(["COMPLETE_PROVISION_SELECTION_REQUIRED", "WHOLE_DOCUMENT_SELECTION_REQUIRED", "OFFICIAL_PROVISION_NOT_FOUND", "EVIDENCE_INELIGIBLE", "EVIDENCE_INTEGRITY",
            "CORPUS_SOURCE_REQUIRES_RECOVERY", "CORPUS_UNIT_MEMBERSHIP", "PROVISION_CONTEXT_BOUND", "EVIDENCE_INVENTORY_LIMIT",
            "PREPARED_TEMPORAL_UNAVAILABLE", "CORPUS_CAPTURE_UNAVAILABLE", "PREPARED_EXTRACTION_GAP", "PREPARED_POSITION_UNAVAILABLE",
            "PREPARED_TABLE_POSITION_UNAVAILABLE", "PREPARED_STRUCTURE_AMBIGUOUS"]);
          const code = error instanceof Error && allowed.has(error.message) ? error.message : "OFFICIAL_READ_UNAVAILABLE";
          researchFailures.push({ candidate: identity, scope: structuredClone(scope), code });
          return false;
        }
      })();
      candidateReads.set(key, pending);
    }
    return pending;
  };
  async function reconcile(interpretation: Pick<Interpretation, "scopes">) {
    // Later searches can rediscover articles inside an already acquired complete
    // section. Hydrate navigation only for those opened source editions and bind
    // coverage to exact authenticated range keys, never text or heading similarity.
    for (const scope of interpretation.scopes) {
      const pending = discoveredCandidates.filter(item => !item.readRange && acquiredSources.has(sourceScopeKey(item))
        && JSON.stringify(item.scope) === JSON.stringify(scope));
      if (ports.corpus.describeCandidates) for (let offset = 0; offset < pending.length; offset += maximumCandidateDescriptionBatch) {
        const batch = pending.slice(offset, offset + maximumCandidateDescriptionBatch);
        try {
          const descriptions = await withinSignal(researchSignal, () => ports.corpus.describeCandidates!(batch.map(item => item.identity), scope, researchSignal, true));
          for (const candidate of batch) {
            const description = descriptions.find(item => item.identity === candidate.identity);
            if (description) Object.assign(candidate, description);
          }
        } catch { researchSignal.throwIfAborted(); }
      }
    }
    for (const candidate of discoveredCandidates) if (completeDocuments.has(documentKey(candidate)) || (candidate.readRange &&
      [candidate.readRange.key, ...(candidate.readRange.sections ?? []).map(section => section.key)]
        .some(key => acquiredRanges.has(acquiredRangeKey(candidate, key))))) {
      selectedCandidates.add(JSON.stringify([candidate.identity, candidate.scope]));
    }
  }
  const searchKey = candidateSearchKey;
  const discover = async (queries: string[], interpretation: Pick<Interpretation, "scopes">) => {
    for (const query of queries) labelQuery(query);
    await discoverReadCandidates({ interpretation: { ...interpretation, queries }, corpus: ports.corpus,
      signal: researchSignal, searches, failures: researchFailures, limits: researchLimits, retained: discoveredCandidates });
    await reconcile(interpretation);
    for (const query of queries) for (const scope of interpretation.scopes) {
      navigation.retain(JSON.stringify(["search", searchKey(query, scope)]), { kind: "search", query, scope },
        discoveredCandidates.filter(candidate => candidate.queries.includes(query)
          && JSON.stringify(candidate.scope) === JSON.stringify(scope)).map(candidate => candidate.id));
    }
  };
  const acquire = (queries: string[], interpretation: Interpretation) => {
    // Serialize seed scheduling across entry and subsequent acquisitions. Explicit
    // model-selected reads remain independent and never consume this allowance.
    const pending = acquisitionQueue.then(async () => {
      await discover(queries, interpretation);
      const limit = ports.corpus.automaticReadLimit ?? 0;
      if (!Number.isInteger(limit) || limit < 0 || limit > 6) throw new Error("RESEARCH_READ_POLICY_INVALID");
      if (!ports.corpus.describeCandidates || automaticReads >= limit) return;
      // Interleave formulations within each temporal scope, then scopes. A large
      // first search cannot monopolize the entire automatic acquisition allowance.
      const scopes = interpretation.scopes.map(scope => {
        const lanes = queries.map(query => discoveredCandidates.filter(candidate => candidate.queries.includes(query)
          && JSON.stringify(candidate.scope) === JSON.stringify(scope))
          .sort((a, b) => automaticReadPriority(a) - automaticReadPriority(b)
            || (a.ranks.find(rank => rank.query === query)?.rank ?? Infinity)
            - (b.ranks.find(rank => rank.query === query)?.rank ?? Infinity)).slice(0, 12));
        const queue: ReadCandidate[] = [];
        for (let rank = 0; rank < 12; rank++) for (const lane of lanes) {
          const candidate = lane[rank];
          if (candidate && !queue.includes(candidate)) queue.push(candidate);
        }
        return queue;
      });
      while (automaticReads < limit && scopes.some(queue => queue.length)) {
        for (const queue of scopes) {
          if (automaticReads >= limit) break;
          // Failed or covered candidates do not deprive this scope of its turn.
          while (queue.length) {
            const candidate = queue.shift()!;
            const scope = candidate.scope;
            if (selectedCandidates.has(JSON.stringify([candidate.identity, scope]))) continue;
            if (!candidate.readRange) {
              try {
                const [description] = await withinSignal(researchSignal, () =>
                  ports.corpus.describeCandidates!([candidate.identity], scope, researchSignal, true));
                if (description?.identity !== candidate.identity) throw new Error("CANDIDATE_DESCRIPTION_IDENTITY");
                Object.assign(candidate, description);
              } catch { researchSignal.throwIfAborted(); continue; }
            }
            const range = candidate.readRange;
            // A discovery hit for an entire document is navigation, not permission
            // to load an entire code. The model can request wholeDocument explicitly.
            if (!range || range.kind === "document") continue;
            const enclosure = ports.corpus.automaticReadScope === "section" && range.kind === "provision"
              && range.sections?.length === 1 ? range.sections[0] : undefined;
            const key = acquiredRangeKey(candidate, enclosure?.key ?? range.key);
            if (acquiredRanges.has(key) || completedSections.has(key)) continue;
            let provision = await acquireCandidate(candidate.identity, scope, enclosure?.position);
            if (!provision && enclosure) provision = await acquireCandidate(candidate.identity, scope);
            if (!provision) continue;
            automaticReads++;
            break;
          }
        }
      }
      // No implicit neighbor/introductory fan-out. Complete sections and their
      // navigation remain available for targeted governing-condition research.
      if (!researchSignal.aborted) await reconcile(interpretation);
    });
    acquisitionQueue = pending.catch(() => {});
    return pending;
  };
  const recoveryQueries = (interpretation: Interpretation, turn: ResearchTurn) =>
    turn.actions.filter(action => "query" in action)
      .map(action => action.query).filter(query => interpretation.scopes.some(scope =>
        !searches.has(searchKey(query, scope))));
  const recoveryCandidates = (turn: ResearchTurn, interpretation: Interpretation,
    onRejectedSelection?: (candidate: ReadCandidate, position: string | undefined,
      code: "RECOVERY_SECTION_NOT_OFFERED" | "RECOVERY_CANDIDATE_ALREADY_ATTEMPTED") => void) => {
    const requested = turn.actions
      .filter(action => "candidateId" in action).filter(action => !("contains" in action));
    const unique = new Map(requested.map(action => [JSON.stringify(action), action]));
    return [...unique.values()].flatMap(action => {
      const id = action.candidateId, sectionPosition = "sectionPosition" in action ? action.sectionPosition : undefined;
      const wholeSection = "wholeSection" in action && action.wholeSection;
      const wholeDocument = "wholeDocument" in action && action.wholeDocument;
      const candidate = discoveredCandidates.find(item => item.id === id);
      const section = sectionPosition ? offeredSections(candidate).find(item => item.position === sectionPosition) : undefined;
      if (!candidate) throw new Error("RECOVERY_CANDIDATE_INVALID");
      const publisherHeading = sectionPosition && candidate.publisherContents?.some(item => item.position === sectionPosition);
      if (!interpretation.scopes.some(scope => JSON.stringify(scope) === JSON.stringify(candidate.scope))) {
        throw new Error("RECOVERY_CANDIDATE_SCOPE");
      }
      if (sectionPosition && !section && !publisherHeading) {
        onRejectedSelection?.(candidate, sectionPosition, "RECOVERY_SECTION_NOT_OFFERED");
        return [];
      }
      if (sectionPosition ? Boolean(section && selectedSections.has(acquiredRangeKey(candidate, section.key))) || attemptedPublisherContents.has(publisherContentKey(candidate, sectionPosition))
        : !wholeSection && !wholeDocument && attemptedCandidateReads.has(JSON.stringify([candidate.identity, candidate.scope]))) {
        onRejectedSelection?.(candidate, sectionPosition, "RECOVERY_CANDIDATE_ALREADY_ATTEMPTED");
        return [];
      }
      return [{ ...candidate, sectionPosition, wholeSection, wholeDocument }];
    });
  };
  async function lookupLiteral(action: { candidateId: string; contains: string }): Promise<Omit<ResearchOutcome, "action">> {
    const parent = discoveredCandidates.find(candidate => candidate.id === action.candidateId);
    if (!parent) throw new Error("RECOVERY_CANDIDATE_INVALID");
    literalLookups.add(JSON.stringify([action.candidateId, action.contains]));
    labelQuery(action.contains);
    if (!ports.corpus.findInSource) {
      researchFailures.push({ candidate: parent.identity, scope: parent.scope, code: "SOURCE_LOOKUP_UNAVAILABLE" });
      return { kind: "unavailable", code: "SOURCE_LOOKUP_UNAVAILABLE" };
    }
    let identities: string[];
    try {
      identities = await withinSignal(researchSignal, () => ports.corpus.findInSource!(parent.identity, action.contains, parent.scope, researchSignal));
    } catch {
      researchSignal.throwIfAborted();
      researchFailures.push({ candidate: parent.identity, scope: parent.scope, code: "SOURCE_LOOKUP_UNAVAILABLE" });
      return { kind: "unavailable", code: "SOURCE_LOOKUP_UNAVAILABLE" };
    }
    for (let offset = 0; offset < identities.length; offset += 12) {
      const batch = identities.slice(offset, offset + 12);
      let descriptions: Awaited<ReturnType<NonNullable<WorkflowPorts["corpus"]["describeCandidates"]>>> = [];
      try {
        descriptions = await withinSignal(researchSignal, async () =>
          await ports.corpus.describeCandidates?.(batch, parent.scope, researchSignal, true) ?? []);
      } catch {
        researchSignal.throwIfAborted();
        for (const identity of batch) researchFailures.push({ candidate: identity, scope: parent.scope, code: "CATALOG_READ_UNAVAILABLE" });
      }
      for (const identity of batch) {
        if (discoveredCandidates.some(candidate => candidate.identity === identity && JSON.stringify(candidate.scope) === JSON.stringify(parent.scope))) continue;
        const description = descriptions.find(candidate => candidate.identity === identity);
        discoveredCandidates.push({ sourceUrl: parent.sourceUrl, scope: structuredClone(parent.scope),
          text: "Description unavailable; complete read required.", truncated: true,
          ...description, identity, id: `c${discoveredCandidates.length + 1}`,
          query: action.contains, queries: [action.contains], ranks: [] });
      }
    }
    navigation.retain(JSON.stringify(["literal", parent.id, action.contains]),
      { kind: "literal", query: action.contains, scope: parent.scope },
      discoveredCandidates.filter(candidate => identities.includes(candidate.identity)
        && JSON.stringify(candidate.scope) === JSON.stringify(parent.scope)).map(candidate => candidate.id));
    for (const candidate of discoveredCandidates) if (candidate.readRange &&
      [candidate.readRange.key, ...(candidate.readRange.sections ?? []).map(section => section.key)]
        .some(key => acquiredRanges.has(acquiredRangeKey(candidate, key)))) {
      selectedCandidates.add(JSON.stringify([candidate.identity, candidate.scope]));
    }
    if (!identities.length) researchFailures.push({ candidate: parent.identity, scope: parent.scope, code: "LITERAL_NO_MATCH" });
    return identities.length ? { kind: "navigation" } : { kind: "empty", code: "LITERAL_NO_MATCH" };
  }
  async function acquireReference(action: { sourceId: string; url: string }): Promise<Omit<ResearchOutcome, "action">> {
    const key = JSON.stringify([action.sourceId, action.url]);
    if (referenceReads.has(key)) return { kind: "duplicate" };
    const parent = inventory.all().find(item => item.identity === action.sourceId);
    if (!parent) throw new Error("RECOVERY_REFERENCE_INVALID");
    const scope = parent.applicableAt ? { kind: "historical" as const, at: parent.applicableAt } : { kind: "current" as const };
    const failure = (code: string) => researchFailures.push({ candidate: `reference:${action.sourceId}`, scope, code });
    referenceReads.add(key);
    if (!parent.operativeReferences?.some(reference => reference.url === action.url)) {
      // Reject the invented link before any corpus access. Returning the fixed
      // tool failure lets this same session choose an authenticated reference
      // or a targeted search; repeated invalid selections cannot loop.
      failure("RECOVERY_REFERENCE_INVALID");
      return { kind: "invalid", code: "RECOVERY_REFERENCE_INVALID" };
    }
    try {
      if (!ports.corpus.resolveReference) throw new Error("REFERENCE_READ_UNAVAILABLE");
      const locator = await withinSignal(researchSignal, () => ports.corpus.resolveReference!(action.sourceId, action.url, scope, researchSignal));
      if (!locator) throw new Error("REFERENCE_READ_UNAVAILABLE");
      if (locator.sourceStructure && locator.sourceStructure.rangeKind !== "article")
        throw new Error("COMPLETE_PROVISION_SELECTION_REQUIRED");
      const provision = await withinSignal(researchSignal, () => readOfficialProvision(locator, ports.corpus, scope, researchSignal));
      retainEvidence(provision);
      return { kind: "complete_read" };
    } catch (error) {
      researchSignal.throwIfAborted();
      const code = error instanceof Error && ["EVIDENCE_INVENTORY_LIMIT", "COMPLETE_PROVISION_SELECTION_REQUIRED"].includes(error.message)
        ? error.message : "REFERENCE_READ_UNAVAILABLE";
      failure(code);
      return { kind: "unavailable", code };
    }
  }

  const attempted = new Set<string>();
  async function execute(action: ResearchTurn["actions"][number], interpretation: Interpretation): Promise<ResearchOutcome> {
    const key = JSON.stringify(action);
    if (attempted.has(key) && !("selectSourceIds" in action) && !("resultSetId" in action)) return { action, kind: "duplicate",
      ...("candidateId" in action ? { code: "RECOVERY_CANDIDATE_ALREADY_ATTEMPTED" } : {}) };
    attempted.add(key);
    try {
      if ("selectSourceIds" in action) { workspace.select(action.selectSourceIds); return { action, kind: "selected" }; }
      if ("resultSetId" in action) return { action, kind: navigation.list(action.resultSetId, action.page) ? "navigation" : "duplicate" };
      researchSignal.throwIfAborted();
      const turn: ResearchTurn = { decision: "research", content: null, gaps: [], actions: [action] };
      if ("query" in action) {
        const queries = recoveryQueries(interpretation, turn);
        if (!queries.length) return { action, kind: "duplicate" };
        // Follow-up searches offer navigation. The model chooses which complete
        // sources to read; automatic seed reads belong to initial acquisition.
        await discover(queries, interpretation);
        const failure = researchFailures.find(item => item.candidate === `query:${action.query}`);
        if (failure) return { action, kind: "unavailable", code: failure.code };
        return { action, kind: discoveredCandidates.some(item => item.queries.includes(action.query)) ? "navigation" : "empty" };
      }
      if ("sourceId" in action) return { action, ...await acquireReference(action) };
      if ("contains" in action) return { action, ...await lookupLiteral(action) };
      let rejected: string | undefined;
      const [candidate] = recoveryCandidates(turn, interpretation, (candidate, position, code) => {
        rejected = code;
        const identity = JSON.stringify([candidate.id, position ?? null]);
        if (!researchFailures.some(failure => failure.candidate === identity && failure.code === code))
          researchFailures.push({ candidate: identity, scope: candidate.scope, code });
      });
      if (!candidate) return { action, kind: rejected === "RECOVERY_CANDIDATE_ALREADY_ATTEMPTED" ? "duplicate" : "invalid", code: rejected };
      const choice = discoveredCandidates.find(item => item.id === candidate.id)!;
      let position = candidate.sectionPosition;
      if (!candidate.wholeDocument && !candidate.wholeSection && !position && choice.readRange?.kind === "document")
        return { action, kind: "unavailable", code: "WHOLE_DOCUMENT_SELECTION_REQUIRED" };
      if (candidate.wholeDocument) {
        if (!ports.corpus.resolveDocument) return { action, kind: "unavailable", code: "OFFICIAL_READ_UNAVAILABLE" };
        if (completeDocuments.has(documentKey(choice))) return { action, kind: "duplicate" };
        const provision = await acquireCandidate(choice.identity, choice.scope, undefined, true);
        return { action, kind: provision ? "complete_read" : "unavailable" };
      }
      if (ports.corpus.candidateReadScope === "section" && !position && !candidate.wholeSection) {
        // A selected article's governing conditions may live beside it. Acquire
        // the authenticated enclosure when unambiguous, retaining the requested
        // article as a fallback if navigation or the larger read is unavailable.
        if (!choice.readRange && ports.corpus.describeCandidates) {
          try {
            const [description] = await withinSignal(researchSignal, () => ports.corpus.describeCandidates!([choice.identity], choice.scope, researchSignal, true));
            if (description?.identity === choice.identity) Object.assign(choice, description);
          } catch { researchSignal.throwIfAborted(); }
        }
        const enclosing = choice.readRange?.kind === "provision" ? choice.readRange.sections ?? [] : [];
        if (enclosing.length === 1) {
          const section = enclosing[0];
          if (completedSections.has(acquiredRangeKey(choice, section.key))) return { action, kind: "duplicate" };
          // Concurrent sibling selections share the read promise. A failed
          // enclosure must still let each sibling acquire its own complete law.
          const provision = await acquireCandidate(choice.identity, choice.scope, section.position);
          if (provision) return { action, kind: "complete_read" };
        }
      }
      if (candidate.wholeSection) {
        if (!choice.readRange && ports.corpus.describeCandidates) {
          const [description] = await withinSignal(researchSignal, () => ports.corpus.describeCandidates!([choice.identity], choice.scope, researchSignal, true));
          if (description?.identity === choice.identity) Object.assign(choice, description);
        }
        const enclosing = choice.readRange?.sections ?? [];
        if (enclosing.length === 1) position = enclosing[0].position;
        if (position ? selectedSections.has(acquiredRangeKey(choice, enclosing[0].key)) : attemptedCandidateReads.has(JSON.stringify([choice.identity, choice.scope])))
          return { action, kind: "duplicate" };
      }
      if (position) {
        const section = offeredSections(choice).find(section => section.position === position);
        if (section) selectedSections.add(acquiredRangeKey(choice, section.key));
        if (choice.publisherContents?.some(item => item.position === position)) {
          const key = publisherContentKey(choice, position);
          if (attemptedPublisherContents.has(key)) return { action, kind: "duplicate" };
          attemptedPublisherContents.add(key);
        }
      }
      selectedCandidates.add(JSON.stringify([choice.identity, choice.scope]));
      const provision = await acquireCandidate(choice.identity, choice.scope, position);
      const failure = researchFailures.find(item => item.candidate === choice.identity && JSON.stringify(item.scope) === JSON.stringify(choice.scope));
      return { action, kind: provision ? "complete_read" : "unavailable", ...(!provision && failure ? { code: failure.code } : {}) };
    } catch (error) {
      signal.throwIfAborted();
      if (researchSignal.aborted) return { action, kind: "cancelled", code: "ACQUISITION_CUTOFF" };
      const code = error instanceof Error && /^(RECOVERY|RESEARCH_RESULT|EVIDENCE_NOT_RETAINED)[A-Z_]*$/.test(error.message)
        ? error.message : "RESEARCH_ACTION_UNAVAILABLE";
      return { action, kind: code === "RESEARCH_ACTION_UNAVAILABLE" ? "unavailable" : "invalid", code };
    }
  }
  return { discover, acquire, execute, reconcile, navigation, discoveredCandidates, selectedCandidates, selectedSections, sectionReadKey: acquiredRangeKey, offeredSections,
    researchFailures, researchLimits, referenceReads, queryLabels };
}
