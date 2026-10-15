import type { AccountType } from "./routing";

export type ProfileReadiness = "business_optional" | "lawyer_draft" | "lawyer_review" | "lawyer_changes" | "lawyer_restricted";

/** Workspace access and professional approval are separate from optional personal details. */
export function profileReadiness(input: {
  accountType: AccountType;
  lawyerProfileStatus: string | null;
  lawyerMarketplaceStatus: string | null;
  hasBusinessWorkspace: boolean;
}): ProfileReadiness | null {
  if (input.accountType === "entrepreneur") return input.hasBusinessWorkspace ? null : "business_optional";
  if (input.accountType !== "lawyer") return null;
  const states = [input.lawyerProfileStatus, input.lawyerMarketplaceStatus];
  if (states.some(state => state && ["suspended", "blocked", "archived", "rejected"].includes(state))) return "lawyer_restricted";
  if (states.every(state => state === "public_approved")) return null;
  if (states.includes("changes_requested")) return "lawyer_changes";
  if (states.includes("pending_review")) return "lawyer_review";
  return "lawyer_draft";
}
