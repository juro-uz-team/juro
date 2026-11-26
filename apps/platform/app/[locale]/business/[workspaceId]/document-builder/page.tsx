import type { Metadata } from "next";
import { notFound } from "next/navigation";

import DocumentBuilderPage from "../../../../_document-builder/page";
import { requireChatGPTUser } from "../../../../chatgpt-auth";
import { documentBuilderMetadataCopy } from "../../../../../lib/platform/builder-workspace-copy";
import { isLocale, isWorkspaceId, platformPath } from "../../../../../lib/platform/routing";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    ...documentBuilderMetadataCopy(locale === "en" ? "en" : locale === "uz" ? "uz" : "ru"),
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function BusinessDocumentBuilder({ params }: { params: Promise<{ locale: string; workspaceId: string }> }) {
  const { locale, workspaceId } = await params;
  if (!isLocale(locale) || !isWorkspaceId(workspaceId)) notFound();
  await requireChatGPTUser(platformPath(locale, "business", "document-builder", workspaceId));
  return <DocumentBuilderPage embedded workspaceId={workspaceId} signInPath={platformPath(locale, "business", "document-builder", workspaceId)} />;
}
