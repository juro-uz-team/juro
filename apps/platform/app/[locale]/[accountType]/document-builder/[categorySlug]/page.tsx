import { requireChatGPTUser } from "../../../../chatgpt-auth";
import CategoryPage from "../../../../_document-builder/[categorySlug]/page";

export const dynamic = "force-dynamic";

export default async function CanonicalCategoryPage({ params }: { params: Promise<{ locale: string; accountType: string; categorySlug: string }> }) {
  const { locale, accountType, categorySlug } = await params;
  await requireChatGPTUser(`/${locale}/${accountType}/document-builder/${encodeURIComponent(categorySlug)}`);
  return <CategoryPage accountType={accountType} params={Promise.resolve({ categorySlug })}/>;
}
