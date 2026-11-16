import { notFound, redirect } from "next/navigation";

import { CaseWorkspaceClient } from "../../../../../../_platform/CaseWorkspaceClient";
import { requireChatGPTUser } from "../../../../../../chatgpt-auth";
import { isCaseSection, isLocale, isWorkspaceId, platformBasePath } from "../../../../../../../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function BusinessCaseSectionPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceId: string; caseId: string; section: string }>;
}) {
  const { locale, workspaceId, caseId, section } = await params;
  if (!isLocale(locale) || !isWorkspaceId(workspaceId) || !isCaseSection(section)) notFound();
  const base = platformBasePath(locale, "business", workspaceId);
  await requireChatGPTUser(`${base}/cases/${encodeURIComponent(caseId)}/${section}`);
  if (section === "plan") redirect(`${base}/action-plan/${encodeURIComponent(caseId)}`);
  return <CaseWorkspaceClient locale={locale} caseId={caseId} section={section} />;
}
