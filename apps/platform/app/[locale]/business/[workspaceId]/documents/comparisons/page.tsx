import { DocumentComparisonClient } from "../../../../../_platform/DocumentComparisonClient";
import { requireChatGPTUser } from "../../../../../chatgpt-auth";
import { notFound } from "next/navigation";

import { isLocale, isWorkspaceId, platformBasePath } from "../../../../../../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function BusinessComparisonEntry({
  params,
}: {
  params: Promise<{ locale: string; workspaceId: string }>;
}) {
  const { locale, workspaceId } = await params;
  if (!isLocale(locale) || !isWorkspaceId(workspaceId)) notFound();
  await requireChatGPTUser(`${platformBasePath(locale, "business", workspaceId)}/documents/comparisons`);
  return <DocumentComparisonClient locale={locale} />;
}
