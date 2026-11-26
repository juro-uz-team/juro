import {resolvedCategories} from "../../../lib/control-center/template-access";
import { workspaceTemplateLibrary } from "../../../lib/document-builder/template-access";
import { notFound } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "../../chatgpt-auth";
import { templateWorkspaceTerms } from "../template-workspace";
import { BuilderHeader } from "../_components/BuilderHeader";
import { DocumentLibraryClient } from "../_components/DocumentLibraryClient";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params, workspaceId, accountType }: { params: Promise<{ categorySlug: string }>; workspaceId?: string; accountType?: string }) {
  const { categorySlug } = await params;
  const categories=await resolvedCategories();const category=categories.find(v=>v.slug===categorySlug);
  if (!category) notFound();
  const user = await getChatGPTUser();
  const documents = await workspaceTemplateLibrary(await templateWorkspaceTerms(user, workspaceId, accountType));
  return <div className="dbt-root"><BuilderHeader user={user} signInPath={chatGPTSignInPath(`/document-builder/${categorySlug}`)}/><DocumentLibraryClient categories={categories} documents={documents.filter(document => document.categorySlug === categorySlug)} activeCategory={category} signedIn={Boolean(user)}/></div>;
}
