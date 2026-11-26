import { notFound } from "next/navigation";

import { redirectLegacyBusinessRoute } from "../../../../_platform/LegacyBusinessRoute";
import { isLocale } from "../../../../../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function LegacyBusinessComparisonEntry({
  params, searchParams,
}: {
  searchParams: Promise<{ first?: string; second?: string }>;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return redirectLegacyBusinessRoute(locale, ["documents", "comparisons"], await searchParams);
}
