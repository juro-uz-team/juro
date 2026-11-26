import { notFound } from "next/navigation";

import CategoryPage from "../../../../../_document-builder/[categorySlug]/page";
import { requireChatGPTUser } from "../../../../../chatgpt-auth";
import { isLocale, isWorkspaceId, platformBasePath } from "../../../../../../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function BusinessCategoryPage({ params }: { params: Promise<{ locale: string; workspaceId: string; categorySlug: string }> }) {
  const { locale, workspaceId, categorySlug } = await params;
  if (!isLocale(locale) || !isWorkspaceId(workspaceId)) notFound();
  const base = platformBasePath(locale, "business", workspaceId);
  await requireChatGPTUser(`${base}/document-builder/${encodeURIComponent(categorySlug)}`);
  return <CategoryPage workspaceId={workspaceId} params={Promise.resolve({ categorySlug })} />;
}
