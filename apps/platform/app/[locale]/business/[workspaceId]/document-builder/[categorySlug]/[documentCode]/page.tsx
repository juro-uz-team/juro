import { notFound } from "next/navigation";

import ConfiguredDocumentPage from "../../../../../../_document-builder/[categorySlug]/[documentCode]/page";
import { requireChatGPTUser } from "../../../../../../chatgpt-auth";
import { isLocale, isWorkspaceId, platformBasePath } from "../../../../../../../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function BusinessConfiguredDocument({ params }: { params: Promise<{ locale: string; workspaceId: string; categorySlug: string; documentCode: string }> }) {
  const { locale, workspaceId, categorySlug, documentCode } = await params;
  if (!isLocale(locale) || !isWorkspaceId(workspaceId)) notFound();
  const base = platformBasePath(locale, "business", workspaceId);
  await requireChatGPTUser(`${base}/document-builder/${encodeURIComponent(categorySlug)}/${encodeURIComponent(documentCode)}`);
  return <ConfiguredDocumentPage workspaceId={workspaceId} params={Promise.resolve({ categorySlug, documentCode })} />;
}
