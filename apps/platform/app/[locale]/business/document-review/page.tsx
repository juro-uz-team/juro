import { notFound } from "next/navigation";

import { redirectLegacyBusinessRoute } from "../../../_platform/LegacyBusinessRoute";
import { isLocale } from "../../../../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function LegacyBusinessEntry({
  params, searchParams,
}: {
  searchParams: Promise<{ mode?: string; analysisId?: string; caseId?: string; source?: string }>;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { mode, ...query } = await searchParams;
  return redirectLegacyBusinessRoute(locale, mode === "compare" ? ["documents", "comparisons"] : ["document-review"], query);
}
