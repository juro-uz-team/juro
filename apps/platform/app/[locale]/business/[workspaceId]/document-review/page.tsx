import { isLocale, isWorkspaceId } from "../../../../../lib/platform/routing";
import { notFound, redirect } from "next/navigation";
import { renderBusinessModuleRoute } from "../../../../_platform/ModuleRoutePage";

export const dynamic = "force-dynamic";

export default async function BusinessDocumentReviewPage({ params, searchParams }: { searchParams: Promise<{ mode?: string }>; params: Promise<{ locale: string; workspaceId: string }> }) {
  const { locale, workspaceId } = await params;
  if (!isLocale(locale) || !isWorkspaceId(workspaceId)) notFound();
  if ((await searchParams).mode === "compare") redirect(`/${locale}/business/${workspaceId}/documents/comparisons`);
  return renderBusinessModuleRoute({ locale, workspaceId, module: "document-review" });
}
