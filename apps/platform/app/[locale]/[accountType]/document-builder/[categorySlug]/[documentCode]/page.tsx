import { requireChatGPTUser } from "../../../../../chatgpt-auth";
import ConfiguredDocumentPage from "../../../../../_document-builder/[categorySlug]/[documentCode]/page";

export const dynamic = "force-dynamic";

export default async function CanonicalConfiguredDocument({ params }: { params: Promise<{ locale: string; accountType: string; categorySlug: string; documentCode: string }> }) {
  const { locale, accountType, categorySlug, documentCode } = await params;
  await requireChatGPTUser(`/${locale}/${accountType}/document-builder/${encodeURIComponent(categorySlug)}/${encodeURIComponent(documentCode)}`);
  return <ConfiguredDocumentPage accountType={accountType} params={Promise.resolve({ categorySlug, documentCode })}/>;
}
