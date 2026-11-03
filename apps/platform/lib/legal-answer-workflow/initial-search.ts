import type { Interpretation, LegalRequest, WorkflowPorts } from "./contracts";

/** Preserve an explicitly supplied act title separately from the conversational request. */
export function namedDocumentQuery(question: string): string | undefined {
  const text = question.trim();
  const quoted = /[«“"]([^»”"\n]{40,1000})[»”"]/u.exec(text)?.[1];
  const prefix = text.split(/\s*[;\n]\s*/u)[0];
  const title = (quoted ?? (prefix !== text ? prefix : undefined))?.trim();
  if (!title || title.length < 40 || title.length > 1000
    || !/^(?:об?\s|закон\s|постановление\s|указ\s|on\s|law\s|resolution\s|decree\s)/iu.test(title)) return undefined;
  return title;
}

/** Speculative navigation overlaps interpretation; only its confirmed scope may enter research. */
export function prepareInitialSearch(request: LegalRequest, corpus: WorkflowPorts["corpus"], signal: AbortSignal) {
  const local = new AbortController(), searchSignal = AbortSignal.any([signal, local.signal]);
  const eligible = (corpus.prefetchInitialSearch || corpus.questionFirstResearch) && !request.history.length && !request.privateDocuments.length
    && !request.caseContext?.facts.length && !request.caseContext?.memories.length
    && !request.legalContextDate && Boolean(request.question.trim()) && request.question.length <= 2000;
  const pending = eligible ? Promise.resolve().then(() => corpus.search(request.question, { kind: "current" }, searchSignal))
    .catch(() => null) : null;
  let retained: Awaited<ReturnType<typeof corpus.search>> | null = null;
  return {
    corpus: { ...corpus, search: (query, scope, callerSignal) => {
      callerSignal.throwIfAborted();
      return retained && query === request.question && scope.kind === "current" ? Promise.resolve(retained)
        : corpus.search(query, scope, callerSignal);
    } } satisfies WorkflowPorts["corpus"],
    async queries(interpretation: Interpretation) {
      if (!pending || interpretation.scopes.length !== 1 || interpretation.scopes[0].kind !== "current") {
        return interpretation.queries;
      }
      const result = await pending;
      signal.throwIfAborted();
      if (result?.candidates.length && result.sparseAvailable && result.denseAvailable) {
        retained = result;
        // Generated formulations remain in the full interpretation supplied to
        // the researcher. This policy lets it inspect the original question's
        // complete evidence before choosing which additional searches are useful.
        if (corpus.questionFirstResearch) return [request.question];
        // The raw question does not replace formulations that identify necessary
        // procedures or exceptions. Reuse its navigation alongside those queries.
        return [...new Set([request.question, ...interpretation.queries])];
      }
      return interpretation.queries;
    },
    // Drain the real corpus promise before the execution ledger can close.
    // Its request signal already bounds cancellation and abandoned work.
    async finish() { local.abort(); await pending; },
  };
}
