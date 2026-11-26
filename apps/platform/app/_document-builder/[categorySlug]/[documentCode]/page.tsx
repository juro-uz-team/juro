import { resolvedDocument } from "../../../../lib/document-builder/registry/published";
import { notFound } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "../../../chatgpt-auth";
import { templateAvailableOnPlan, templateLanguages } from "../../../../lib/document-builder/template-access";
import { templateWorkspaceTerms } from "../../template-workspace";
import { BuilderHeader } from "../../_components/BuilderHeader";
import { ConfigurableDocumentBuilder } from "../../_components/ConfigurableDocumentBuilder";
import { DocumentBuilderLoader } from "../../DocumentBuilderLoader";

export const dynamic = "force-dynamic";

export default async function ConfiguredDocumentPage({ params, workspaceId, accountType }: { params: Promise<{ categorySlug: string; documentCode: string }>; workspaceId?: string; accountType?: string }) {
  const { categorySlug, documentCode } = await params;
  const definition = await resolvedDocument(documentCode);
  if (!definition || definition.categorySlug !== categorySlug || definition.status !== "published") notFound();
  const user = await getChatGPTUser();
  const terms = await templateWorkspaceTerms(user, workspaceId, accountType);
  const languages = templateLanguages(definition);
  if (terms?.readOnly || !templateAvailableOnPlan(definition, terms?.planCode ?? "free") || languages.length === 0) notFound();
  const returnTo = `/document-builder/${categorySlug}/${documentCode}`;
  if (definition.specialBuilder === "receipt" && !definition.version.startsWith("control-")) {
    return <DocumentBuilderLoader initialUser={user} signInPath={chatGPTSignInPath(`${returnTo}?resume=1`)}/>;
  }
  return <div className="dbt-root"><BuilderHeader user={user} signInPath={chatGPTSignInPath(returnTo)}/><ConfigurableDocumentBuilder definition={definition} availableLanguages={languages} initialUser={user} signInPath={chatGPTSignInPath(returnTo)}/></div>;
}
