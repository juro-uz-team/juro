import {resolvedCategories} from "../../lib/control-center/template-access";
import { workspaceTemplateLibrary } from "../../lib/document-builder/template-access";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";
import { templateWorkspaceTerms } from "./template-workspace";
import { BuilderHeader } from "./_components/BuilderHeader";
import { DocumentLibraryClient } from "./_components/DocumentLibraryClient";

export const dynamic = "force-dynamic";

export default async function DocumentBuilderPage({
  embedded = false,
  signInPath = chatGPTSignInPath("/document-builder"),
  workspaceId,
  accountType,
}: {
  embedded?: boolean;
  signInPath?: string;
  workspaceId?: string;
  accountType?: string;
} = {}) {
  const user = await getChatGPTUser();
  const [categories, documents] = await Promise.all([
    resolvedCategories(), templateWorkspaceTerms(user, workspaceId, accountType).then(workspaceTemplateLibrary),
  ]);
  return <div className="dbt-root"><BuilderHeader user={user} signInPath={signInPath} variant={embedded ? "embedded" : "standalone"}/><DocumentLibraryClient categories={categories} documents={documents} signedIn={Boolean(user)}/></div>;
}
