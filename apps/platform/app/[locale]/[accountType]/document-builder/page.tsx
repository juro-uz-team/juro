import type { Metadata } from "next";
import { requireChatGPTUser } from "../../../chatgpt-auth";
import DocumentBuilderPage from "../../../_document-builder/page";
import { documentBuilderMetadataCopy } from "../../../../lib/platform/builder-workspace-copy";

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

export default async function CanonicalDocumentBuilder({ params }: { params: Promise<{ locale: string; accountType: string }> }) {
  const { locale, accountType } = await params;
  await requireChatGPTUser(`/${locale}/${accountType}/document-builder`);
  return <DocumentBuilderPage embedded accountType={accountType} signInPath={`/${locale}/${accountType}/document-builder`}/>;
}
