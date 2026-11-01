import { maximumGenerationCalls, maximumResearchRounds } from "./contracts";
import { legalAnswerDeadlineMs } from "./deadline";

export type StopReason = "cancelled" | "deadline" | "composition_deadline" | "provider_budget"
  | "provider_limit" | "context_capacity" | "context_repair_limit" | "repeated_work"
  | "research_unfinished" | "invalid_output" | "provider_failure";
export type RequestPhase = "research" | "selecting" | "composing" | "saving" | "complete" | "stopped";
export type ControllerEvent = { event: "transition" | "stop"; phase: RequestPhase; reason?: StopReason;
  remainingMs: number; acquisitions: number; contextRepairs: number; providerCalls: number };

/** Reserve time for complete composition after acquiring the necessary law.
 * This is an admission allowance, not a guarantee or a normal response target.
 * Shorter caller deadlines scale the allowance; saving keeps its separate window. */
export function requestControlPolicy(durationMs: number) {
  return { compositionMs: Math.min(50_000, durationMs * 0.5),
    decisionMs: Math.min(16_000, durationMs * 0.15), savingMs: Math.min(1500, durationMs * 0.1) };
}

/** One owner for request control. These bounds prevent loops, not establish legal sufficiency. */
export class RequestController {
  phase: RequestPhase = "research";
  acquisitions = 0;
  contextRepairs = 0;
  providerCalls = 0;
  reason?: StopReason;
  private compositionOnly = false;
  constructor(private readonly deadlineAt: number, private readonly observe?: (event: ControllerEvent) => void,
    private readonly durationMs = legalAnswerDeadlineMs) {}

  canAcquire(signal: AbortSignal, capacity?: { remainingCalls: number; canReserveResearchAndComposition: boolean }) {
    const policy = requestControlPolicy(this.durationMs);
    return !this.compositionOnly && !signal.aborted && this.acquisitions < maximumResearchRounds
      && this.deadlineAt - Date.now() > policy.compositionMs + policy.decisionMs + policy.savingMs
      && this.providerCalls < maximumGenerationCalls - 1
      && (!capacity || capacity.remainingCalls > 1 && capacity.canReserveResearchAndComposition);
  }
  canSelect(signal: AbortSignal) {
    return this.contextRepairStopReason(signal) === undefined;
  }
  contextRepairStopReason(signal: AbortSignal): StopReason | undefined {
    const policy = requestControlPolicy(this.durationMs);
    if (signal.aborted || this.deadlineAt - Date.now() <= policy.compositionMs + policy.decisionMs + policy.savingMs)
      return "composition_deadline";
    if (this.contextRepairs >= 2) return "context_repair_limit";
    if (this.providerCalls >= maximumGenerationCalls - 1) return "provider_limit";
    return undefined;
  }
  providerStarted() { this.providerCalls++; }
  capacityRejected() { this.providerCalls--; }
  acquired() { this.acquisitions++; }
  selected() { this.contextRepairs++; }
  finishResearch() { this.compositionOnly = true; }
  transition(phase: RequestPhase) { this.phase = phase; this.emit("transition"); }
  stop(reason: StopReason) { this.reason = reason; this.phase = "stopped"; this.emit("stop"); }
  private emit(event: ControllerEvent["event"]) {
    try { this.observe?.({ event, phase: this.phase, ...(this.reason ? { reason: this.reason } : {}),
      remainingMs: Math.max(0, this.deadlineAt - Date.now()), acquisitions: this.acquisitions,
      contextRepairs: this.contextRepairs, providerCalls: this.providerCalls }); } catch { /* Diagnostics cannot fail delivery. */ }
  }
}
