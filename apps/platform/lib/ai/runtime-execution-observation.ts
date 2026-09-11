import {z} from "zod";

const executionSchema = z.object({
  instanceId: z.string().uuid(),
  ordinal: z.number().int().positive(),
  requestId: z.string().min(1).max(200),
  versionId: z.string().min(1).max(200).nullable(),
  startedAt: z.string().datetime(),
}).strict();
const serviceExecutionSchema = executionSchema.extend({
  releaseIds: z.array(z.string().min(1).max(500)).max(2),
}).strict();
export type ServiceExecutionObservation = z.infer<typeof serviceExecutionSchema>;

/** Per-isolate observations contain no questions, user identities or answers. */
export function createRuntimeExecutionObserver() {
  let instanceId: string | undefined;
  let ordinal = 0;
  return (requestId: string, versionId?: string | null) => {
    instanceId ??= crypto.randomUUID();
    return executionSchema.parse({instanceId, ordinal: ++ordinal, requestId,
      versionId: typeof versionId === "string" && versionId.length > 0 && versionId.length <= 200 ? versionId : null,
      startedAt: new Date().toISOString()});
  };
}

export function readExecutionDiagnostic<T>(read: () => T, unavailable: T): T {
  try {return read();} catch {
    console.warn(JSON.stringify({event: "legal_execution_observer_failed"}));
    return unavailable;
  }
}

/** Missing or invalid diagnostics remain unknown; they cannot attest evidence. */
export function parseRuntimeExecutionHeader(value: string | null, requestId: string): ServiceExecutionObservation | null {
  if (!value || value.length > 4096) return null;
  try {
    const parsed = serviceExecutionSchema.safeParse(JSON.parse(value));
    return parsed.success && parsed.data.requestId === requestId ? parsed.data : null;
  } catch {return null;}
}
