import type { WorkflowPorts } from "../../lib/legal-answer-workflow/contracts";

/** Existing legal-only fixtures supply the interpretation; the entry envelope is not their subject. */
export function legalEntryFixture(model: WorkflowPorts["model"]): WorkflowPorts["model"] {
  return { complete: async operation => {
    const result = await model.complete(operation);
    if (operation.stage !== "interpret") return result;
    const interpretation = result && typeof result === "object" && "interpretation" in result
      ? result.interpretation : result;
    return { conversationReply: null, interpretation };
  } };
}
