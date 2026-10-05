import { resolvedDocument } from "../../../../lib/document-builder/registry/published";
import { notFound } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "../../../chatgpt-auth";
import { getDocumentByCode } from "../../../../lib/document-builder/registry";
import { BuilderHeader } from "../../_components/BuilderHeader";
import { ConfigurableDocumentBuilder } from "../../_components/ConfigurableDocumentBuilder";
import { DocumentBuilderLoader } from "../../DocumentBuilderLoader";

export const dynamic = "force-dynamic";

export default async function ConfiguredDocumentPage({ params }: { params: Promise<{ categorySlug: string; documentCode: string }> }) {
  const { categorySlug, documentCode } = await params;
  const definition = await resolvedDocument(documentCode);
  if (!definition || definition.categorySlug !== categorySlug || definition.status !== "published") notFound();
  const user = await getChatGPTUser();
  const returnTo = `/document-builder/${categorySlug}/${documentCode}`;
  if (definition.specialBuilder === "receipt" && !definition.version.startsWith("control-")) {
    return <DocumentBuilderLoader initialUser={user} signInPath={chatGPTSignInPath(`${returnTo}?resume=1`)}/>;
  }
  return <div className="dbt-root"><BuilderHeader user={user} signInPath={chatGPTSignInPath(returnTo)}/><ConfigurableDocumentBuilder definition={definition} initialUser={user} signInPath={chatGPTSignInPath(returnTo)}/></div>;
}
