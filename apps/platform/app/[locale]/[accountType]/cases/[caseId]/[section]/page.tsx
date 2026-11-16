import { notFound, redirect } from "next/navigation";

import { CaseWorkspaceClient } from "../../../../../_platform/CaseWorkspaceClient";
import { requireChatGPTUser } from "../../../../../chatgpt-auth";
import { isAccountType, isCaseSection, isLocale } from "../../../../../../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function CaseSectionPage({
  params,
}: {
  params: Promise<{ locale: string; accountType: string; caseId: string; section: string }>;
}) {
  const { locale, accountType, caseId, section } = await params;
  if (!isLocale(locale) || !isAccountType(accountType) || !isCaseSection(section)) notFound();
  await requireChatGPTUser(`/${locale}/${accountType}/cases/${encodeURIComponent(caseId)}/${section}`);
  if (section === "plan") redirect(`${`/${locale}/${accountType}`}/action-plan/${encodeURIComponent(caseId)}`);
  return <CaseWorkspaceClient locale={locale} caseId={caseId} section={section} />;
}
