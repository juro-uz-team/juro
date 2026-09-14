import { z } from "zod";

/** A scope describes what must be answered, not evidence that it is covered. */
export const legalCoverageScopeSchema = z.enum([
  "general", "personal_status", "action_stage", "forum", "claim_kind", "consequence",
]);
export type LegalCoverageScope = z.infer<typeof legalCoverageScopeSchema>;
