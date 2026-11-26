import { resolvedDocument } from "../../../../lib/document-builder/registry/published";
import { requireChatGPTUser } from "../../../chatgpt-auth";
import { getDocumentAccess, hasDocumentPermission, loadStoredDocument } from "../../../../lib/document-builder/permissions";
import { notFound } from "next/navigation";
import { getOrCreateUserProfile } from "../../../../lib/document-builder/storage/db";
import { ConfigurableDocumentBuilder } from "../../_components/ConfigurableDocumentBuilder";
import { BuilderHeader } from "../../_components/BuilderHeader";
import { SharedDocumentClient } from "../../_components/SharedDocumentClient";
import { DocumentBuilderClient } from "../../DocumentBuilderClient";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string; consultation?: string; request?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireChatGPTUser(`/document-builder/documents/${id}${query.print === "1" ? "?print=1" : ""}`);
  const profile = await getOrCreateUserProfile(user);
  const access = await getDocumentAccess(id, profile.id);
  if (!access?.canView) notFound();
  const { templateCode, templateVersion } = access.document;
  if (access.role === "collaborator") {
    const shared = await loadStoredDocument(id, profile.id);
    if (!shared) notFound();
    const { id: documentId, title, revision, finalContent, signedFileId } = shared;
    return <div className="dbt-root"><BuilderHeader user={user}/><SharedDocumentClient initial={{ id: documentId, title, revision, finalContent, signedFileId }} canPropose={hasDocumentPermission(access, "create_suggestion")}/></div>;
  }
  const configured = templateCode ? await resolvedDocument(templateCode, templateVersion ?? undefined) : undefined;
  if (configured) {
    return <div className="dbt-root"><BuilderHeader user={user}/><ConfigurableDocumentBuilder definition={configured} initialUser={user} signInPath="" initialDocumentId={id}/></div>;
  }
  const consultation: { type: "ai" | "lawyer"; requestId: string } | null = (query.consultation === "ai" || query.consultation === "lawyer") && query.request
    ? { type: query.consultation, requestId: query.request }
    : null;
  return <DocumentBuilderClient initialUser={user} signInPath="" initialDocumentId={id} printMode={query.print === "1"} initialConsultation={consultation}/>;
}
