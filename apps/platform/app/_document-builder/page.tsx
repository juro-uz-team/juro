import {resolvedCategories} from "../../lib/control-center/template-access";
import { resolvedLibrary } from "../../lib/document-builder/registry/published";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";
import { DOCUMENT_CATEGORIES, DOCUMENT_LIBRARY } from "../../lib/document-builder/registry";
import { BuilderHeader } from "./_components/BuilderHeader";
import { DocumentLibraryClient } from "./_components/DocumentLibraryClient";

export const dynamic = "force-dynamic";

export default async function DocumentBuilderPage({
  embedded = false,
  signInPath = chatGPTSignInPath("/document-builder"),
}: {
  embedded?: boolean;
  signInPath?: string;
} = {}) {
  const user = await getChatGPTUser();
  return <div className="dbt-root"><BuilderHeader user={user} signInPath={signInPath} variant={embedded ? "embedded" : "standalone"}/><DocumentLibraryClient categories={await resolvedCategories()} documents={await resolvedLibrary()} signedIn={Boolean(user)}/></div>;
}
