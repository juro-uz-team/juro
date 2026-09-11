import { legalChatResponseSchema, type LegalChatResponse } from "./legal-chat-schema";
import type { LegalAiRunResult } from "./provider";

export function combineCoverageSynthesis(parts: readonly LegalAiRunResult[], latencyMs: number): LegalAiRunResult {
  const first = parts[0];
  if (!first || parts.some(part => part.model !== first.model || part.provider !== first.provider)) {
    throw new TypeError("LEGAL_SYNTHESIS_PARTS_INVALID");
  }
  const findings = new Map<string, LegalChatResponse["confirmedFindings"][number]>();
  for (const part of parts) for (const finding of part.data.confirmedFindings) {
    const key = JSON.stringify([finding.title, finding.explanation, finding.answerRole, [...finding.sourceIds].sort()]);
    const previous = findings.get(key);
    findings.set(key, {...finding, requirementIds: [...new Set([
      ...(previous?.requirementIds ?? []), ...(finding.requirementIds ?? []),
    ])]});
  }
  const unique = <T>(items: T[]) => [...new Map(items.map(item => [JSON.stringify(item), item])).values()];
  // Validation rejects an oversized combined answer; never truncate a scope
  // or publish a successful sibling in place of a failed one.
  const data = legalChatResponseSchema.parse({...first.data,
    responseKind: parts.every(part => part.data.responseKind === "answer") ? "answer" : "clarification_required",
    confirmedFindings: [...findings.values()],
    conditionalBranches: unique(parts.flatMap(part => part.data.conditionalBranches ?? [])),
    clarificationQuestions: unique(parts.flatMap(part => part.data.clarificationQuestions)),
    actionPlan: unique(parts.flatMap(part => part.data.actionPlan)),
    risks: unique(parts.flatMap(part => part.data.risks)),
    deadlines: unique(parts.flatMap(part => part.data.deadlines)),
    suggestLawyer: parts.some(part => part.data.suggestLawyer),
    urgency: parts.some(part => part.data.urgency === "critical") ? "critical"
      : parts.some(part => part.data.urgency === "high") ? "high" : "normal",
  });
  return {...first, data, latencyMs: Math.max(0, Math.trunc(latencyMs)), providerResponseId: null,
    guidanceAssessments: parts.flatMap(part => part.guidanceAssessments ?? []),
    findingAssessments: parts.flatMap(part => part.findingAssessments ?? []),
    attempts: parts.reduce((sum, part) => sum + part.attempts, 0),
    usage: parts.reduce((sum, part) => ({inputTokens: sum.inputTokens + part.usage.inputTokens,
      outputTokens: sum.outputTokens + part.usage.outputTokens,
      cachedInputTokens: sum.cachedInputTokens + part.usage.cachedInputTokens}),
    {inputTokens: 0, outputTokens: 0, cachedInputTokens: 0}),
  };
}
