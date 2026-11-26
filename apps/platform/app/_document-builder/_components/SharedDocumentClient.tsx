"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { paragraphsFromFinalText } from "../../../lib/document-builder/generation/paragraphs";
import type { StoredDocument } from "../../../lib/document-builder/types";
import { builderNavigationPaths } from "../../../lib/platform/builder-paths";
import { builderError } from "../builder-localization";
import { WorkspaceTitle } from "../../_platform/WorkspaceTitle";
import { ApiClientError, apiFetch } from "./api-client";
import { CollaborationPanel } from "./CollaborationPanel";
import { DocumentPreview } from "./DocumentPreview";

type SharedDocument = Pick<StoredDocument, "id" | "title" | "revision" | "finalContent" | "signedFileId">;

export function SharedDocumentClient({ initial }: { initial: SharedDocument }) {
  const paths = builderNavigationPaths(usePathname());
  const locale = paths.locale ?? "ru";
  const copy = {
    ru: { documents: "Мои документы", error: "Документ не удалось обновить." },
    uz: { documents: "Hujjatlarim", error: "Hujjatni yangilab bo‘lmadi." },
    en: { documents: "My documents", error: "Could not refresh this document." },
  }[locale];
  const [document, setDocument] = useState<SharedDocument | null>(initial);
  const [error, setError] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const { document: latest } = await apiFetch<{ document: SharedDocument }>(`/api/document-builder/documents/${initial.id}`, { signal, cache: "no-store" });
      setDocument((current) => !current || latest.revision >= current.revision ? latest : current);
      setError("");
    } catch (caught) {
      if (signal?.aborted) return;
      if (caught instanceof ApiClientError && [401, 403, 404].includes(caught.status)) setDocument(null);
      setError(builderError(locale, caught, copy.error));
    }
  }, [copy.error, initial.id, locale]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    // shortcut: refresh while the shared document is visible, use push updates if concurrent traffic grows.
    const update = async () => {
      if (!window.document.hidden) await refresh(controller.signal);
      if (!controller.signal.aborted) timer = window.setTimeout(update, 4_000);
    };
    void update();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [refresh]);

  return <main className="dbt-collaborator-page workspace-page">
    <Link className="dbt-back" href={paths.documents}>{copy.documents}</Link>
    {error && <p className="dbt-global-error" role="alert">{error}</p>}
    {document && <>
      <WorkspaceTitle icon={<FileText />} title={document.title} />
      <div className="dbt-tool-strip">
        <CollaborationPanel documentId={document.id} accessRole="collaborator" finalText={document.finalContent} revision={document.revision}
          signedFileId={document.signedFileId} locale={locale} onApplied={() => refresh()} />
      </div>
      <div className="dbt-collaborator-document">
        <DocumentPreview document={{ title: document.title, plainText: document.finalContent, paragraphs: paragraphsFromFinalText(document.finalContent) }} locale={locale} />
      </div>
    </>}
  </main>;
}
