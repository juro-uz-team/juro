import { z } from "zod";
import { parseLegalChatResponse } from "./legal-chat-schema";
import { aiText } from "./localization";

export const saveAiActionPlanInputSchema = z.object({
  assistantMessageId: z.string().uuid(),
  targetCaseId: z.string().uuid().optional(),
  locale: z.enum(["ru", "uz", "en"]).default("uz"),
}).strict();

export type SaveAiActionPlanInput = z.infer<typeof saveAiActionPlanInputSchema>;

export class AiActionPlanSaveError extends Error {
  constructor(
    readonly code:
      | "AI_ACTION_PLAN_NOT_FOUND"
      | "AI_ACTION_PLAN_CASE_NOT_FOUND"
      | "AI_ACTION_PLAN_INVALID"
      | "AI_ACTION_PLAN_EMPTY"
      | "AI_ACTION_PLAN_PERSISTENCE_FAILED",
  ) {
    super(code);
    this.name = "AiActionPlanSaveError";
  }
}

type StoredPlanMessage = {
  structuredJson: string | null;
  accountType: string;
};

type ExistingCasePlan = {
  caseId: string;
  caseTitle: string;
  planId: string | null;
  planTitle: string | null;
  planRevision: number | null;
};

type ExistingPlanStep = {
  id: string;
  ordinal: number;
  title: string;
  description: string | null;
  status: string;
  dueAt: string | null;
  deadlineType: string;
  actionType: string;
  templateCode: string | null;
  revision: number;
};
