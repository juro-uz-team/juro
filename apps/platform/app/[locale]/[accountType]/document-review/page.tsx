import { isLocale, isAccountType } from "../../../../lib/platform/routing";
import { notFound, redirect } from "next/navigation";
import { renderAccountModuleRoute } from "../../../_platform/ModuleRoutePage";

export const dynamic = "force-dynamic";

export default async function DocumentReviewPage({ params, searchParams }: { searchParams: Promise<{ mode?: string }>; params: Promise<{ locale: string; accountType: string }> }) {
  const { locale, accountType } = await params;
  if (!isLocale(locale) || !isAccountType(accountType)) notFound();
  if ((await searchParams).mode === "compare") redirect(`/${locale}/${accountType}/documents/comparisons`);
  return renderAccountModuleRoute({ locale, accountType, module: "document-review" });
}
