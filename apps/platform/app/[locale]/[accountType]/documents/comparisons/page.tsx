import { DocumentComparisonClient } from "../../../../_platform/DocumentComparisonClient";
import { requireChatGPTUser } from "../../../../chatgpt-auth";
import { notFound } from "next/navigation";

import { isAccountType, isLocale } from "../../../../../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function ComparisonEntryPage({
  params,
}: {
  params: Promise<{ locale: string; accountType: string }>;
}) {
  const { locale, accountType } = await params;
  if (!isLocale(locale) || !isAccountType(accountType)) notFound();
  await requireChatGPTUser(`/${locale}/${accountType}/documents/comparisons`);
  return <DocumentComparisonClient locale={locale} />;
}
