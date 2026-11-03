import { z } from "zod";
import { researchTurnSchema, unreadResearchTurnSchema, initialReadTurnSchema, entrySchema, navigationEntrySchema, maximumGenerationCalls, researchConcurrencySchema,
  type ResearchTurn, type LegalOutcome, type LegalRequest, type PublishedAnswer, type WorkflowPorts } from "./contracts";
import { researchWritingInstruction, unreadResearchInstruction, entryInstruction } from "./prompts";
import { checkWrittenAnswer } from "./publication-checks";
import { requestLifetime, withinSignal } from "./lifetime";
import { withoutAnswerTracing } from "./privacy";
import { sourceFilesForEvidence } from "./source-files";
import { SourceFileContextLimit } from "./source-file-contract";
import { researchEvidence, researchCandidates, modelResearchDiscovery, researchReferences } from "./research-context";
import type { ReadCandidate } from "./candidate-selection";
import { createCorpusResearch } from "./corpus-research";
import { ResearchWorkspace } from "./research-workspace";
import { RequestController, requestControlPolicy, type StopReason } from "./request-controller";
import { withResearchDiagnostics, emitResearchDiagnostic } from "./diagnostics";
import { namedDocumentQuery, prepareInitialSearch } from "./initial-search";
import { IssueWriting, issuedResearchTurn, issueUpdateSchema } from "./issue-writing";
import { coverageRecordSchema } from "./research-workspace";

const unavailableText = {
  en: {
    research: "Official research could not finish; applicable law remains unverified.",
    read: "Complete selected official provisions could not be read within the request deadline.",
    write: "A complete supported answer could not be finalized within the available evidence and delivery limits.",
  },
  ru: {
    research: "Не удалось завершить поиск официальных норм; применимое право осталось неустановленным.",
    read: "Не удалось прочитать выбранные официальные нормы полностью за отведённое время.",
    write: "Не удалось подготовить полный ответ на основе найденных норм с учётом доступных материалов и отведённого времени.",
  },
  uz: {
    research: "Rasmiy normalarni izlash yakunlanmadi; qo‘llaniladigan huquq aniqlanmay qoldi.",
    read: "Tanlangan rasmiy normalarni ajratilgan vaqt ichida to‘liq o‘qib bo‘lmadi.",
    write: "Mavjud materiallar va ajratilgan vaqt doirasida topilgan normalarga asoslangan to‘liq javobni tayyorlab bo‘lmadi.",
  },
};

/** One controller, workspace and native model session per request. */
export async function runLegalAnswer(request: LegalRequest, ports: WorkflowPorts): Promise<PublishedAnswer> {
  return withoutAnswerTracing(() => withResearchDiagnostics(request.onDiagnostic, () => executeLegalAnswer(request, ports)));
}

async function executeLegalAnswer(request: LegalRequest, ports: WorkflowPorts): Promise<PublishedAnswer> {
  if (request.legalContextDate !== undefined) z.iso.date().parse(request.legalContextDate);
  const policy = requestControlPolicy(request.deadlineMs);
  const lifetime = requestLifetime(request.submittedAt, request.deadlineMs, request.signal, request.deadlineMs,
    policy.compositionMs + policy.savingMs);
  const { signal, researchSignal, writingSignal } = lifetime;
  const controller = new RequestController(request.submittedAt + request.deadlineMs, request.onDiagnostic, request.deadlineMs);
  const workspace = new ResearchWorkspace();
  const issueWriting = new IssueWriting(request.language);
  const inventory = workspace.inventory;
  const documentQuery = namedDocumentQuery(request.question);
  // Longer or contextual questions still use the full interpretation path;
  // eligibility changes scheduling, never the supplied conversation or law.
  const entryNavigation = Boolean(ports.corpus.entryNavigation && ports.corpus.describeCandidates
    && request.question.trim() && request.question.length <= 2000 && !request.history.length
    && !request.privateDocuments.length && !request.caseContext?.facts.length && !request.caseContext?.memories.length
    && !request.legalContextDate);
  const initialSearch = prepareInitialSearch(request,
    entryNavigation ? { ...ports.corpus, prefetchInitialSearch: false, questionFirstResearch: false } : ports.corpus, researchSignal);
  const corpus = createCorpusResearch({ ...ports, corpus: initialSearch.corpus }, workspace, researchSignal, signal);
  const { navigation, discoveredCandidates, selectedCandidates, selectedSections, sectionReadKey, offeredSections,
    researchFailures, researchLimits, referenceReads, queryLabels } = corpus;
  let previousResearch: { gaps: ResearchTurn["gaps"]; consideredEvidenceIds: string[];
    knownEvidenceIds: Set<string>; candidateCount: number; failureCount: number } | null = null;
  const publish = async (outcome: LegalOutcome) => {
    signal.throwIfAborted(); controller.transition("saving"); request.onProgress?.("saving");
    const result = await withinSignal(signal, () => ports.publication.publish({ request, outcome, signal }));
    controller.transition("complete"); return result;
  };
  try {
    request.onProgress?.("interpreting");
    if (entryNavigation) await corpus.discover([...new Set([request.question, ...documentQuery ? [documentQuery] : []])], { scopes: [{ kind: "current" }] });
    controller.providerStarted();
    const raw = await withinSignal(researchSignal, () => ports.model.complete({ stage: "interpret", researchSession: true,
      instruction: entryInstruction, input: { question: request.question, language: request.language, format: request.format,
        legalContextDate: request.legalContextDate, history: request.history, privateDocuments: request.privateDocuments,
        caseContext: request.caseContext, searchCapabilities: { resultWindowLimit: 50, continuationSupported: false, rankedPageExhaustsCorpus: false },
        ...(entryNavigation ? { entryNavigation: true, ...modelResearchDiscovery(discoveredCandidates, undefined, queryLabels) } : {}) },
      schema: z.toJSONSchema(entryNavigation ? navigationEntrySchema : entrySchema), signal: researchSignal }));
    const entry = (entryNavigation ? navigationEntrySchema : entrySchema).parse(raw);
    if (entry.conversationReply !== null) {
      request.onBudgetSelected?.(15_000);
      return await publish({ kind: "conversation", text: entry.conversationReply, checkedEvidence: [], clarificationQuestions: [] });
    }
    const interpretation = entry.interpretation!;
    if (new Set(interpretation.requirements.map(item => item.id)).size !== interpretation.requirements.length) throw new Error("REQUIREMENT_ID_CONFLICT");
    request.onBudgetSelected?.(Math.min(request.deadlineMs, interpretation.complexity === "simple" ? 15_000 : 30_000));
    if (request.legalContextDate && !interpretation.scopes.some(scope => scope.kind === "historical" && scope.at === request.legalContextDate))
      throw new Error("INTERPRETATION_DATE_MISMATCH");
    if (interpretation.needsClarification) return await publish({ kind: "clarification_required", checkedEvidence: [],
      clarificationQuestions: interpretation.clarificationQuestions });
    const unfinished = async (reason: StopReason, gaps?: ResearchTurn["gaps"]) => {
      controller.stop(reason);
      const withdrawal = issueWriting.withdrawIncomplete();
      if (withdrawal) request.onWriting?.(withdrawal);
      return publish({ kind: "insufficient_evidence", researchIncomplete: true, checkedEvidence: workspace.active(),
        revisionNotes: issueWriting.correctionNotes(),
        gaps: gaps?.length ? gaps : interpretation.requirements.map(item => ({ requirementId: item.id, description: unavailableText[request.language][
          ["context_capacity", "context_repair_limit", "provider_budget", "provider_limit", "composition_deadline"].includes(reason) ? "write" : "research"] })),
        clarificationQuestions: interpretation.clarificationQuestions });
    };
    request.onProgress?.("researching"); navigation.beginBatch();
    try {
      const selected = "candidateIds" in entry ? z.array(z.string()).parse(entry.candidateIds) : [];
      if (selected.some(id => !discoveredCandidates.some(candidate => candidate.id === id))) throw new Error("INITIAL_CANDIDATE_INVALID");
      const eligible = selected.filter(id => discoveredCandidates.some(candidate => candidate.id === id
        && interpretation.scopes.some(scope => JSON.stringify(scope) === JSON.stringify(candidate.scope))));
      for (const candidateId of selected.filter(id => !eligible.includes(id))) workspace.record({
        action: { requirementId: interpretation.requirements[0].id, candidateId }, kind: "invalid", code: "RECOVERY_CANDIDATE_SCOPE",
      });
      const queries = [...new Set([...(await initialSearch.queries(interpretation)), ...documentQuery ? [documentQuery] : []])].filter(query => !(eligible.length
        && query === request.question && interpretation.scopes.length === 1 && interpretation.scopes[0].kind === "current"));
      await Promise.all([
        ...(queries.length ? [corpus.acquire(queries, interpretation)] : []),
        ...eligible.map(async candidateId => {
          const result = await corpus.execute({ requirementId: interpretation.requirements[0].id, candidateId }, interpretation);
          workspace.record(result);
        }),
      ]);
      if (!researchSignal.aborted) await corpus.reconcile(interpretation);
    }
    catch (error) { signal.throwIfAborted(); if (!researchSignal.aborted) throw error; controller.finishResearch(); }
    while (!writingSignal.aborted && controller.providerCalls < maximumGenerationCalls) {
      signal.throwIfAborted();
      const evidence = workspace.active();
      const canResearch = controller.canAcquire(researchSignal, ports.model.capacity?.());
      const canSelectEvidence = false;
      if (researchSignal.aborted && !evidence.length) return await unfinished("research_unfinished");
      controller.transition(canResearch ? "research" : "composing");
      request.onProgress?.(canResearch ? "researching" : "writing");
      try {
        const visibleIds = navigation.visibleIds();
        const navigationCandidates = (canResearch ? discoveredCandidates : []).filter(item => visibleIds.has(item.id) &&
          interpretation.scopes.some(scope => JSON.stringify(scope) === JSON.stringify(item.scope)));
        const unreadCandidates = navigationCandidates.filter(item => !selectedCandidates.has(JSON.stringify([item.identity, item.scope])));
        const sectionIdentity = (section: { key: string; position: string; title: string },
          candidate: { scope: ReadCandidate["scope"]; readRange?: ReadCandidate["readRange"] }) =>
          JSON.stringify([section.key, section.position, section.title, candidate.readRange?.language, candidate.scope]);
        // Match the representatives actually exposed by modelResearchDiscovery.
        // A duplicate menu may be omitted only while its exact range, language,
        // scope and heading remain selectable through an unread candidate.
        const unreadSections = new Set(researchCandidates(unreadCandidates).flatMap(candidate =>
          [...(candidate.readRange?.sections ?? []), ...(candidate.readRange?.sourceSections ?? [])]
            .map(section => sectionIdentity(section, candidate))));
        const availableSections = [...new Map(navigationCandidates.filter(item => selectedCandidates.has(JSON.stringify([item.identity, item.scope])))
          .flatMap(item => offeredSections(item).filter(section => !selectedSections.has(sectionReadKey(item, section.key))
            && !unreadSections.has(sectionIdentity(section, item)))
            .map(section => [sectionIdentity(section, item), { candidateId: item.id,
              sectionPosition: section.position, title: section.title, scope: item.scope }] as const))).values()];

        const sourceFiles = await sourceFilesForEvidence(evidence, ports.corpus, writingSignal);
        const sourceMetadata = request.onWriting && ports.citations
          ? (await withinSignal(writingSignal, () => ports.citations!(inventory.all(), writingSignal))).map(citation => citation.source) : undefined;
        const emitWriting = (draft: import("./writing-stream").WritingDraft) => request.onWriting?.({ ...draft,
          ...(sourceMetadata ? { sources: sourceMetadata } : {}) });
        const outputLanguage = { en: "English", ru: "Russian", uz: "Uzbek in Latin script" }[request.language];
        controller.providerStarted();
        const raw = await withinSignal(writingSignal, () => ports.model.complete({ stage: "write", researchSession: true,
          onWriting: request.onWriting ? draft => {
            if (draft.issueUpdate) {
              issueWriting.project(draft.issueUpdate, draft.blocks, new Set(evidence.map(item => item.identity)), draft.citations);
            } else emitWriting(issueWriting.publicSnapshot(draft));
          } : undefined,
          instruction: `${evidence.length ? researchWritingInstruction : unreadResearchInstruction}\nFor this request write user-facing prose in ${outputLanguage}. Keep source and candidate identifiers unchanged. Maintain only useful revisable coverage records: issue, relevance, provisional support, unresolved dependency and next action. These records are task state, never legal evidence.`,
          sourceFiles, input: { researchAgent: true, question: request.question, language: request.language, format: request.format,
            ...(ports.model.issueWriting ? { issueWriting: true, publishedIssues: issueWriting.published(), issueCorrections: issueWriting.correctionCount() } : {}),
            legalContextDate: request.legalContextDate, interpretation, history: request.history, privateDocuments: request.privateDocuments, caseContext: request.caseContext,
            searchCapabilities: { resultWindowLimit: 50, continuationSupported: false, rankedPageExhaustsCorpus: false },
            previousResearch: previousResearch ? { gaps: previousResearch.gaps, consideredEvidenceIds: previousResearch.consideredEvidenceIds,
              newlyReadEvidenceIds: inventory.all().filter(item => !previousResearch!.knownEvidenceIds.has(item.identity)).map(item => item.identity),
              newCandidateCount: discoveredCandidates.length - previousResearch.candidateCount,
              newFailures: researchFailures.slice(previousResearch.failureCount) } : null,
            coverageRecords: workspace.coverage(), actionOutcomes: workspace.outcomes(),
            researchFailures: structuredClone(researchFailures), availableEvidence: workspace.catalog(discoveredCandidates),
            researchLimits: structuredClone(researchLimits), canResearch, canSelectEvidence,
            availableReferences: researchReferences(evidence, referenceReads), availableSections,
            retainedResults: canResearch ? navigation.catalog(new Set(discoveredCandidates.filter(item => selectedCandidates.has(JSON.stringify([item.identity, item.scope]))).map(item => item.id))) : [],
            ...modelResearchDiscovery(unreadCandidates, undefined, queryLabels), evidence: researchEvidence(evidence) },
          schema: z.toJSONSchema(evidence.length ? researchTurnSchema : inventory.all().length ? unreadResearchTurnSchema : initialReadTurnSchema), signal: writingSignal }));
        const requirements = new Set(interpretation.requirements.map(item => item.id));
        if (ports.model.issueWriting && typeof raw === "object" && raw !== null && issuedResearchTurn in raw) {
          const parsed = z.object({ issueUpdates: z.array(issueUpdateSchema), coverageUpdates: z.array(coverageRecordSchema).optional() }).parse(raw);
          const updates = parsed.issueUpdates;
          issueWriting.commit(updates, new Set(evidence.map(item => item.identity)), requirements);
          if (parsed.coverageUpdates) workspace.revise(parsed.coverageUpdates);
          continue;
        }
        const turn = researchTurnSchema.parse(raw);
        if (turn.gaps.some(gap => !requirements.has(gap.requirementId)) || turn.actions.some(action => !requirements.has(action.requirementId)))
          throw new Error("RESEARCH_REQUIREMENT_INVALID");
        if (turn.coverageUpdates) workspace.revise(turn.coverageUpdates);
        previousResearch = { gaps: structuredClone(turn.gaps), consideredEvidenceIds: evidence.map(item => item.identity),
          knownEvidenceIds: new Set(inventory.all().map(item => item.identity)), candidateCount: discoveredCandidates.length, failureCount: researchFailures.length };
        if (turn.decision === "answer") {
          if (!evidence.length) throw new Error("WRITING_EVIDENCE_EMPTY");
          const content = issueWriting.finalize(turn.content!);
          checkWrittenAnswer(content, interpretation, null, evidence);
          return await publish({ kind: "answer", content, evidence });
        }
        if (turn.decision !== "research") return await unfinished("research_unfinished", turn.gaps);
        if (!canResearch) return await unfinished("repeated_work");
        navigation.beginBatch();
        const selections = turn.actions.filter(action => "selectSourceIds" in action);
        const acquisitions = turn.actions.filter(action => !("selectSourceIds" in action) && !("resultSetId" in action));
        if (selections.length) throw new Error("EVIDENCE_REMOVAL_DISABLED");
        if (acquisitions.length) controller.acquired();
        const previousOutcomes = workspace.outcomes();
        const execute = async (action: ResearchTurn["actions"][number]) => {
          const started = performance.now();
          const allowed = "resultSetId" in action ? canResearch : canResearch && !researchSignal.aborted;
          const result = allowed ? await corpus.execute(action, interpretation)
            : { action, kind: "not_executed" as const, code: "ACQUISITION_CLOSED" };
          workspace.record(result);
          emitResearchDiagnostic({ event: "tool_outcome", kind: result.kind, durationMs: performance.now() - started,
            activeCount: workspace.active().length, retainedCount: inventory.all().length });
          return result;
        };
        const actions = turn.actions.filter(action => !("selectSourceIds" in action));
        let cursor = 0;
        const results = (await Promise.all(Array.from({ length: Math.min(researchConcurrencySchema.parse(ports.corpus.researchConcurrency), actions.length) }, async () => {
          const completed = [];
          while (cursor < actions.length) completed.push(await execute(actions[cursor++]));
          return completed;
        }))).flat();
        if (!researchSignal.aborted) await corpus.reconcile(interpretation);
        const repeated = results.length > 0 && results.every(item => item.kind === "duplicate");
        if (repeated && (!workspace.active().length || results.every(item => previousOutcomes.some(previous =>
          JSON.stringify(previous.action) === JSON.stringify(item.action) && ["invalid", "unavailable"].includes(previous.kind)))))
          return await unfinished("repeated_work");
        if (researchSignal.aborted || !canResearch || repeated) controller.finishResearch();
      } catch (error) {
        signal.throwIfAborted();
        if (researchSignal.aborted && error === researchSignal.reason && !writingSignal.aborted) {
          controller.finishResearch();
          continue;
        }
        const capacity = error instanceof SourceFileContextLimit || (error instanceof Error && error.message === "PROVIDER_INPUT_LIMIT");
        if (capacity) {
          controller.capacityRejected();
          return await unfinished("context_capacity");
        }
        const code = error instanceof Error ? error.message : "";
        if (code === "PROVIDER_COMPOSITION_RESERVE") {
          controller.capacityRejected();
          controller.finishResearch();
          continue;
        }
        if (code === "PROVIDER_REQUEST_BUDGET") { controller.capacityRejected(); return await unfinished("provider_budget"); }
        if (code === "PROVIDER_CALL_LIMIT") { controller.capacityRejected(); return await unfinished("provider_limit"); }
        if (writingSignal.aborted) return await unfinished("composition_deadline");
        throw error;
      }
    }
    return await unfinished(writingSignal.aborted ? "composition_deadline" : "provider_limit");
  } catch (error) {
    controller.stop(request.signal?.aborted ? "cancelled" : signal.aborted ? "deadline" : "provider_failure");
    throw error;
  } finally {
    lifetime.dispose();
    await initialSearch.finish();
    await ports.drain?.();
  }
}
