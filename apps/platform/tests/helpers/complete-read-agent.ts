import { runLegalAnswer } from "../../lib/legal-answer-workflow/workflow";
import type { Interpretation, LegalRequest, WorkflowPorts } from "../../lib/legal-answer-workflow/contracts";

/** Synthetic agent for integration fixtures whose candidate sets contain only the intended test evidence.
 * Real research-selection tests supply their own decisions directly to runLegalAnswer.
 */
export function runCompleteReadFixture(request: LegalRequest, ports: WorkflowPorts) {
  let interpretation: Interpretation;
  return runLegalAnswer(request, { ...ports, model: { complete: async operation => {
    if (operation.stage === "interpret") {
      const result = await ports.model.complete(operation);
      interpretation = result as Interpretation;
      return { conversationReply: null, interpretation };
    }
    const context = operation.input as { unreadCandidates: { id: string }[] };
    if (!ports.corpus.describeCandidates && context.unreadCandidates.length) return { decision: "research", content: null,
      gaps: [{ requirementId: interpretation.requirements[0].id, description: "Read the artificial fixture evidence." }],
      actions: context.unreadCandidates.map(candidate => ({ requirementId: interpretation.requirements[0].id, candidateId: candidate.id })) };
    return ports.model.complete(operation);
  } } });
}
