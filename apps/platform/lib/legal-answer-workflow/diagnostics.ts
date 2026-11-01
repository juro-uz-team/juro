import { AsyncLocalStorage } from "node:async_hooks";
import type { ControllerEvent } from "./request-controller";

export type ResearchDiagnostic = ControllerEvent
  | { event: "input_count"; durationMs: number; inputTokens: number | null }
  | { event: "provider_packet"; serializedBytes: number; evidenceBytes: number; navigationBytes: number;
      contextBytes: number; schemaBytes: number; fileCount: number; rejected: boolean }
  | { event: "provider_completion"; durationMs: number; category: "accepted" | "rejected" | "cancelled" }
  | { event: "corpus_timing"; durationMs: number; queueMs: number | null; serviceMs: number | null;
      admissionWaitMs: number | null; responseWaitMs: number | null; bodyReadParseMs: number | null }
  | { event: "tool_outcome"; durationMs: number; kind: import("./research-workspace").ResearchOutcome["kind"]; activeCount: number; retainedCount: number };
const observer = new AsyncLocalStorage<(event: ResearchDiagnostic) => void>();
export function withResearchDiagnostics<T>(receive: ((event: ResearchDiagnostic) => void) | undefined, work: () => T): T {
  return observer.run(receive ?? (() => {}), work);
}
export function emitResearchDiagnostic(event: ResearchDiagnostic) {
  try { observer.getStore()?.(event); } catch { /* Optional diagnostics never govern saved delivery. */ }
}
