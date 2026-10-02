import {resolvedCategories} from "../../../lib/control-center/template-access";
import {resolvedLibrary} from "../../../lib/document-builder/registry/published";
import { notFound } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "../../chatgpt-auth";
import { DOCUMENT_CATEGORIES, getCategory, getLibraryDocumentsByCategory } from "../../../lib/document-builder/registry";
import { BuilderHeader } from "../_components/BuilderHeader";
import { DocumentLibraryClient } from "../_components/DocumentLibraryClient";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: Promise<{ categorySlug: string }> }) {
  const { categorySlug } = await params;
  const categories=await resolvedCategories();const category=categories.find(v=>v.slug===categorySlug);
  if (!category) notFound();
  const user = await getChatGPTUser();
  return <div className="dbt-root"><BuilderHeader user={user} signInPath={chatGPTSignInPath(`/document-builder/${categorySlug}`)}/><DocumentLibraryClient categories={categories} documents={(await resolvedLibrary()).filter(v=>v.categorySlug===categorySlug)} activeCategory={category}/></div>;
}
