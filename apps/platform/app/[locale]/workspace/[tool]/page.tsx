import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getOrCreateUserProfile } from "../../../../lib/document-builder/storage/db";
import { isLawyerHostRequest, lawyerPublicOrigin } from "../../../../lib/platform/lawyer-entry-routing";
import { workspaceProfile } from "../../../../lib/platform/profile";
import { isLocale, platformPath } from "../../../../lib/platform/routing";
import { workspaceForUser, workspacesForUser } from "../../../../lib/platform/workspace";
import { requireChatGPTUser } from "../../../chatgpt-auth";

const destinations = new Map([
  ["ai-chat", "ai-chat"],
  ["document-analysis", "document-review"],
  ["document-builder", "document-builder"],
  ["document-comparison", "documents/comparisons"],
  ["action-plan", "action-plan"],
  ["cases", "cases"],
  ["lawyers", "lawyers"],
  ["monitoring", "monitoring"],
  ["calendar", "calendar"],
  ["search", "dashboard?search=open"],
  ["team", "team"],
  ["history", "history"],
  ["archive", "archive"],
  ["consultation-requests", "consultations?view=requests"],
  ["consultation-schedule", "consultations?view=schedule"],
]);

export const dynamic = "force-dynamic";

export default async function WorkspaceToolEntry({ params }: {
  params: Promise<{ locale: string; tool: string }>;
}) {
  const { locale, tool } = await params;
  const destination = destinations.get(tool);
  if (!isLocale(locale) || !destination) notFound();

  const user = await requireChatGPTUser(`/${locale}/workspace/${tool}`);
  const userProfile = await getOrCreateUserProfile(user);
  const profile = await workspaceProfile(user.email);
  const workspace = await workspaceForUser(userProfile);

  if (profile?.accountType === "lawyer") {
    const incomingHeaders = await headers();
    const origin = lawyerPublicOrigin(incomingHeaders.get("host"));
    const lawyerOrigin = !isLawyerHostRequest(incomingHeaders) && origin === "https://lawyer.juro.uz" ? origin : "";
    redirect(`${lawyerOrigin}${platformPath(locale, "lawyer", tool === "team" ? "settings#business-workspace" : destination)}`);
  }

  if (workspace.type === "business") redirect(platformPath(locale, "business", destination, workspace.id));
  const accountType = profile?.accountType === "entrepreneur" ? "entrepreneur" : "individual";
  if (tool === "team") {
    const business = (await workspacesForUser(userProfile.id)).find(option => option.type === "business");
    if (business) redirect(platformPath(locale, "business", destination, business.id));
    redirect(platformPath(locale, accountType, "settings#business-workspace"));
  }
  redirect(platformPath(locale, accountType, destination));
}
