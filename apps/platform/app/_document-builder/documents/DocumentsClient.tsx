"use client";

import { Select } from "../../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- document list is loaded from D1 after mount */

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, ArchiveRestore, Copy, Download, Eye, FileCheck2, FilePlus2, Files, FolderArchive, Heart, Link2, LoaderCircle, MoreHorizontal, Pencil, Search, Star, Trash2, UploadCloud } from "lucide-react";
import type { ChatGPTUser } from "../../chatgpt-auth";
import type { DocumentRecord, FileRecord } from "../../../lib/document-builder/types";
import { BuilderHeader } from "../_components/BuilderHeader";
import { ApiClientError, apiFetch, downloadAuthenticatedFile } from "../_components/api-client";
import { useDebouncedEffect } from "../_hooks/useDebouncedEffect";
import { useModalFocus } from "../_hooks/useModalFocus";
import { builderNavigationPaths } from "../../../lib/platform/builder-paths";
import { localizedDocumentStatus, workspaceCopy } from "../../../lib/platform/builder-workspace-copy";
import { builderError, builderIntlLocale, builderUiLocale } from "../builder-localization";

type Folder = "all" | "created" | "shared" | "favorite" | "archive";
type StandaloneShare = { id: string; url: string; code: string | null; status: "active" | "expired" | "inactive" };
type CaseOption = { id: string; title: string };
type ListedDocument = DocumentRecord & { accessRole: "owner" | "collaborator" };
type RenameDecision = { id: string; kind: "document" | "standalone"; currentName: string };

export function DocumentsClient({
  user,
  signInPath,
  embedded = false,
}: {
  user: ChatGPTUser;
  signInPath: string;
  embedded?: boolean;
}) {
  const paths = builderNavigationPaths(usePathname());
  const locale = builderUiLocale(paths.locale);
  const copy = workspaceCopy(locale).documents;
  const loadError = copy.loadError;
  const dateLocale = builderIntlLocale(locale);
  const [documents, setDocuments] = useState<ListedDocument[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [standalone, setStandalone] = useState<FileRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [folder, setFolder] = useState<Folder>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [from, setFrom] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState("");
  const [linkingDocumentId, setLinkingDocumentId] = useState("");
  const [deleteDecision, setDeleteDecision] = useState<DocumentRecord | null>(null);
  const closeDeleteDecision = useCallback(() => setDeleteDecision(null), []);
  const deleteDialogRef = useModalFocus<HTMLElement>(Boolean(deleteDecision), closeDeleteDecision);
  const [renameDecision, setRenameDecision] = useState<RenameDecision | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const renamingRef = useRef(false);
  const closeRename = useCallback(() => {
    if (renamingRef.current) return;
    setRenameDecision(null);
    setRenameError("");
  }, []);
  const renameDialogRef = useModalFocus<HTMLFormElement>(Boolean(renameDecision), closeRename);
  const [standaloneShare, setStandaloneShare] = useState<Record<string, StandaloneShare | null>>({});
  const uploadRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ folder, search: debouncedSearch, status, sort });
      if (from) params.set("from", from);
      const result = await apiFetch<{ documents: ListedDocument[]; cases: CaseOption[]; standaloneFiles: FileRecord[]; total: number }>(`/api/document-builder/documents?${params}`);
      setDocuments(result.documents); setCases(result.cases); setStandalone(result.standaloneFiles); setTotal(result.total);
    } catch (caught) { setError(builderError(locale, caught, loadError)); }
    finally { setLoading(false); }
  // Locale changes remount this canonical route; only query controls must refresh the list in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, folder, from, sort, status]);
  useEffect(() => { void load(); }, [load]);
  useDebouncedEffect(() => { setDebouncedSearch(search); }, [search], 350);

  const patch = async (id: string, body: Record<string, unknown>) => {
    await apiFetch(`/api/document-builder/documents/${id}`, { method: "PATCH", body: JSON.stringify(body) }); setMenu(""); await load();
  };
  const duplicate = async (id: string) => {
    const result = await apiFetch<{ document: DocumentRecord }>("/api/document-builder/documents", { method: "POST", body: JSON.stringify({ sourceDocumentId: id }) });
    window.location.assign(paths.document(result.document.id));
  };
  const removeDocument = async (document: DocumentRecord, policy?: "keep" | "delete") => {
    try {
      const query = policy ? `?signed=${policy}` : "";
      await apiFetch(`/api/document-builder/documents/${document.id}${query}`, { method: "DELETE" });
      setDeleteDecision(null); setToast(copy.deleted); window.setTimeout(() => setToast(""), 2_500); await load();
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "SIGNED_FILE_DECISION_REQUIRED") { setDeleteDecision(document); return; }
      setError(builderError(locale, caught, copy.deleteError));
    }
  };
  const uploadSigned = async (document: DocumentRecord, file: File) => {
    const form = new FormData(); form.set("file", file);
    try { await apiFetch(`/api/document-builder/documents/${document.id}/signed-file`, { method: "POST", body: form }); await load(); }
    catch (caught) { setError(builderError(locale, caught, copy.uploadError)); }
  };
  const patchStandalone = async (id: string, body: Record<string, unknown>) => { await apiFetch(`/api/document-builder/standalone-files/${id}`, { method: "PATCH", body: JSON.stringify(body) }); await load(); };
  const beginRename = (decision: RenameDecision) => {
    setRenameDecision(decision);
    setRenameTitle(decision.currentName);
    setRenameError("");
  };
  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameDecision || !renameTitle.trim() || renamingRef.current) return;
    renamingRef.current = true;
    setRenaming(true);
    setRenameError("");
    try {
      const endpoint = renameDecision.kind === "document"
        ? `/api/document-builder/documents/${renameDecision.id}`
        : `/api/document-builder/standalone-files/${renameDecision.id}`;
      await apiFetch(endpoint, { method: "PATCH", body: JSON.stringify({ action: "rename", title: renameTitle.trim() }) });
      await load();
      renamingRef.current = false;
      setRenaming(false);
      closeRename();
      setToast(copy.renamed);
      window.setTimeout(() => setToast(""), 2_500);
    } catch (caught) {
      setRenameError(builderError(locale, caught, copy.renameError));
    } finally {
      renamingRef.current = false;
      setRenaming(false);
    }
  };
  const deleteStandalone = async (file: FileRecord) => { await apiFetch(`/api/document-builder/standalone-files/${file.id}`, { method: "DELETE" }); await load(); };
  const loadStandaloneShare = async (id: string) => {
    const result = await apiFetch<{ share: StandaloneShare | null }>(`/api/document-builder/standalone-files/${id}/share`); setStandaloneShare((value) => ({ ...value, [id]: result.share }));
  };
  const createStandaloneShare = async (id: string) => {
    try {
      const result = await apiFetch<{ share: StandaloneShare }>(`/api/document-builder/standalone-files/${id}/share`, { method: "POST", body: JSON.stringify({ action: "create" }) });
      setStandaloneShare((value) => ({ ...value, [id]: result.share }));
    } catch (caught) { setError(builderError(locale, caught, copy.shareError)); await loadStandaloneShare(id); }
  };
  const deleteExpiredShare = async (id: string) => {
    await apiFetch(`/api/document-builder/standalone-files/${id}/share`, { method: "POST", body: JSON.stringify({ action: "delete_expired" }) }); setStandaloneShare((value) => ({ ...value, [id]: null }));
  };
  const copyAll = (share: StandaloneShare) => share.code && navigator.clipboard.writeText(`${copy.copyLink}: ${share.url}\n${copy.code}: ${share.code}`);
  const changeCase = async (document: ListedDocument, nextCaseId: string) => {
    const previousCaseId = document.caseId ?? null;
    const caseId = nextCaseId || null;
    if (caseId === previousCaseId) return;
    setLinkingDocumentId(document.id);
    setError("");
    setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, caseId } : item));
    try {
      const result = await apiFetch<{ caseId: string | null; revision: number }>(`/api/document-builder/documents/${document.id}/case`, {
        method: "PUT",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ caseId }),
      });
      setDocuments((current) => current.map((item) => item.id === document.id
        ? { ...item, caseId: result.caseId, caseLinkRevision: result.revision }
        : item));
      setToast(result.caseId ? copy.caseLinked : copy.caseUnlinked);
      window.setTimeout(() => setToast(""), 2_500);
    } catch (caught) {
      setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, caseId: previousCaseId } : item));
      setError(builderError(locale, caught, copy.caseLinkError));
    } finally {
      setLinkingDocumentId("");
    }
  };

  return <div className="dbt-root"><BuilderHeader user={user} signInPath={signInPath} variant={embedded ? "embedded" : "standalone"}/><div className="dbt-documents-page">
    <header className="dbt-page-title"><div><span><Files size={22}/></span><div><h1>{copy.title}</h1><p>{total} {total === 1 ? copy.countOne : copy.countMany}</p></div></div><Link href={paths.library}><FilePlus2 size={18}/>{copy.create}</Link></header>
    {locale === "en" && <p className="dbt-inline-note">{copy.languageNote}</p>}
    {toast && <div className="dbt-toast" role="status">{toast}</div>}
    {error && <div className="dbt-global-error" role="alert"><span>{error}</span><button type="button" aria-label={copy.close} title={copy.close} onClick={() => setError("")}>×</button></div>}
    <div className="dbt-docs-layout"><aside className="dbt-folders">{([{ id: "all", label: copy.folders.all, icon: Files }, { id: "created", label: copy.folders.created, icon: FileCheck2 }, { id: "shared", label: copy.folders.shared, icon: Link2 }, { id: "favorite", label: copy.folders.favorite, icon: Star }, { id: "archive", label: copy.folders.archive, icon: FolderArchive }] as const).map(({ id, label, icon: Icon }) => <button type="button" className={folder === id ? "active" : ""} onClick={() => setFolder(id)} key={id}><Icon size={18}/>{label}</button>)}</aside><section className="dbt-docs-content"><div className="dbt-doc-filters"><label className="dbt-doc-search"><Search size={18}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.search} aria-label={copy.search}/></label><Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={copy.statusFilter}><option value="">{copy.allStatuses}</option><option value="Черновик">{copy.statuses.draft}</option><option value="Готов">{copy.statuses.ready}</option><option value="Согласован">{copy.statuses.approved}</option><option value="Подписан">{copy.statuses.signed}</option></Select><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label={copy.createdAfter}/><Select value={sort} onChange={(event) => setSort(event.target.value)} aria-label={copy.sort}><option value="newest">{copy.newest}</option><option value="oldest">{copy.oldest}</option><option value="title">{copy.byTitle}</option></Select></div>
      {loading ? <div className="dbt-list-loading"><LoaderCircle size={25}/><p>{copy.loading}</p></div> : documents.length === 0 && standalone.length === 0 ? <div className="dbt-empty-state"><FilePlus2 size={38}/><h2>{copy.emptyTitle}</h2><p>{copy.emptyBody}</p><Link href={paths.library}>{copy.chooseTemplate}</Link></div> : <div className="dbt-document-list">
        {documents.map((document) => <article className="dbt-document-card" key={document.id}><span className="dbt-file-icon"><FileCheck2 size={23}/></span><div className="dbt-document-main"><div><span className={`dbt-doc-status status-${document.status.toLocaleLowerCase()}`}>{localizedDocumentStatus(document.status, paths.locale)}</span>{document.accessRole === "collaborator" && <span className="dbt-incoming">{copy.sharedAccess}</span>}</div><h2>{document.title}</h2><p>{[document.lenderName, document.borrowerName].filter(Boolean).join(" ↔ ") || copy.participantsMissing}</p><small>{document.category} · {document.templateCode ? `№ ${document.templateCode} · ` : ""}{new Date(document.updatedAt).toLocaleDateString(dateLocale)}</small>{document.accessRole === "owner" && document.status !== "Архив" && <label className="dbt-document-case"><span>{copy.caseLabel}</span><Select value={document.caseId ?? ""} disabled={linkingDocumentId === document.id} aria-label={`${copy.caseLabel}: ${document.title}`} aria-busy={linkingDocumentId === document.id} onChange={(event) => void changeCase(document, event.target.value)}><option value="">{copy.noCase}</option>{document.caseId && !cases.some((item) => item.id === document.caseId) && <option value={document.caseId}>{copy.unavailableCase}</option>}{cases.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</Select><span className="sr-only" aria-live="polite">{linkingDocumentId === document.id ? copy.caseSaving : ""}</span></label>}</div><div className="dbt-document-actions"><a href={paths.document(document.id)}>{document.status === "Черновик" ? copy.continue : copy.open}</a>{document.signedFileId && <a href={`/api/document-builder/documents/${document.id}/files/${document.signedFileId}?inline=1`} target="_blank" rel="noreferrer">{copy.signedVersion}</a>}{document.accessRole === "owner" && <><button type="button" className={document.isFavorite ? "favorite" : ""} aria-label={document.isFavorite ? copy.removeFavorite : copy.addFavorite} onClick={() => void patch(document.id, { action: "favorite", value: !document.isFavorite })}><Heart size={18}/></button><button type="button" aria-label={copy.more} onClick={() => setMenu(menu === document.id ? "" : document.id)}><MoreHorizontal size={19}/></button>{menu === document.id && <div className="dbt-card-menu"><button type="button" onClick={() => beginRename({ id: document.id, kind: "document", currentName: document.title })}><Pencil size={16}/>{copy.rename}</button><button type="button" onClick={() => void duplicate(document.id)}><Copy size={16}/>{copy.duplicate}</button>{document.status === "Архив" ? <button type="button" onClick={() => void patch(document.id, { action: "restore" })}><ArchiveRestore size={16}/>{copy.restore}</button> : <button type="button" onClick={() => void patch(document.id, { action: "archive" })}><Archive size={16}/>{copy.moveArchive}</button>}{!document.signedFileId && <><input ref={(node) => { uploadRefs.current[document.id] = node; }} type="file" hidden accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSigned(document, file); event.currentTarget.value = ""; }}/><button type="button" onClick={() => uploadRefs.current[document.id]?.click()}><UploadCloud size={16}/>{copy.uploadSigned}</button></>}<button type="button" className="danger" onClick={() => void removeDocument(document)}><Trash2 size={16}/>{copy.remove}</button></div>}</>}</div></article>)}
        {standalone.map((file) => { const share = standaloneShare[file.id]; return <article className="dbt-document-card standalone" key={file.id}><span className="dbt-file-icon"><FileCheck2 size={23}/></span><div className="dbt-document-main"><h2>{file.fileName}</h2><p>{copy.standalone}</p><small>{(file.sizeBytes / 1024).toFixed(0)} {copy.kilobytes}</small>{share !== undefined && <div className="dbt-standalone-share">{share ? <><div className="dbt-share-line"><input readOnly value={share.url}/>{share.status === "active" && <><span className="active"><i/>{copy.active}</span><button type="button" onClick={() => void createStandaloneShare(file.id)}>{copy.newLink}</button></>}{share.status === "expired" && <button type="button" onClick={() => void deleteExpiredShare(file.id)}>{copy.deleteLink}</button>}</div>{share.status === "active" && <div className="dbt-share-code"><span>{share.code ? <>{copy.code}: <strong>{share.code}</strong></> : copy.codeShownOnce}</span><button type="button" onClick={() => navigator.clipboard.writeText(share.url)}>{copy.copyLink}</button>{share.code && <><button type="button" onClick={() => navigator.clipboard.writeText(share.code!)}>{copy.copyCode}</button><button type="button" onClick={() => void copyAll(share)}>{copy.copyAll}</button></>}</div>}</> : <button type="button" onClick={() => void createStandaloneShare(file.id)}><Link2 size={16}/>{copy.createDayLink}</button>}</div>}</div><div className="dbt-document-actions"><a href={`/api/document-builder/standalone-files/${file.id}?inline=1`} target="_blank" rel="noreferrer"><Eye size={17}/>{copy.open}</a><button type="button" onClick={() => void downloadAuthenticatedFile(`/api/document-builder/standalone-files/${file.id}`, file.fileName)}><Download size={17}/>{copy.download}</button><button type="button" onClick={() => void loadStandaloneShare(file.id)}><Link2 size={17}/>{copy.share}</button><button type="button" aria-label={`${copy.rename}: ${file.fileName}`} title={`${copy.rename}: ${file.fileName}`} onClick={() => beginRename({ id: file.id, kind: "standalone", currentName: file.fileName.replace(/\.pdf$/i, "") })}><Pencil size={17}/></button>{file.archivedAt ? <button type="button" aria-label={`${copy.restore}: ${file.fileName}`} title={`${copy.restore}: ${file.fileName}`} onClick={() => void patchStandalone(file.id, { action: "restore" })}><ArchiveRestore size={17}/></button> : <button type="button" aria-label={`${copy.moveArchive}: ${file.fileName}`} title={`${copy.moveArchive}: ${file.fileName}`} onClick={() => void patchStandalone(file.id, { action: "archive" })}><Archive size={17}/></button>}<button type="button" className="danger" aria-label={`${copy.remove}: ${file.fileName}`} title={`${copy.remove}: ${file.fileName}`} onClick={() => void deleteStandalone(file)}><Trash2 size={17}/></button></div></article>; })}
      </div>}
    </section></div>
    {renameDecision && <div className="dbt-modal-backdrop" role="presentation" onMouseDown={closeRename}><form ref={renameDialogRef} className="dbt-contact-form dbt-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-document-title" aria-describedby="rename-document-description" aria-busy={renaming} onSubmit={(event) => void submitRename(event)} onMouseDown={(event) => event.stopPropagation()}><header><h2 id="rename-document-title">{copy.renameDialogTitle}</h2><button type="button" disabled={renaming} aria-label={copy.close} title={copy.close} onClick={closeRename}>×</button></header><p id="rename-document-description">{copy.renameDialogBody}</p><label className="dbt-field"><span>{copy.renameLabel}</span><input data-dialog-initial-focus required minLength={1} maxLength={renameDecision.kind === "standalone" ? 180 : 300} value={renameTitle} disabled={renaming} onChange={(event) => setRenameTitle(event.target.value)} /></label>{renameError && <p className="dbt-inline-error" role="alert">{renameError}</p>}<footer><button type="button" disabled={renaming} onClick={closeRename}>{copy.cancel}</button><button type="submit" className="primary" disabled={renaming || !renameTitle.trim()}>{renaming ? copy.renameSaving : copy.renameSave}</button></footer></form></div>}
    {deleteDecision && <div className="dbt-modal-backdrop" role="presentation" onMouseDown={closeDeleteDecision}><section ref={deleteDialogRef} className="dbt-delete-choice" role="dialog" aria-modal="true" aria-labelledby="delete-document-title" aria-describedby="delete-document-description" onMouseDown={(event) => event.stopPropagation()}><h2 id="delete-document-title">{copy.deleteDialog}</h2><p id="delete-document-description">{copy.deleteDialogBody}</p><button type="button" onClick={() => void removeDocument(deleteDecision, "delete")}><Trash2 size={18}/>{copy.deleteTogether}</button><button type="button" onClick={() => void removeDocument(deleteDecision, "keep")}><FileCheck2 size={18}/>{copy.keepSigned}</button><button type="button" className="cancel" data-dialog-initial-focus onClick={closeDeleteDecision}>{copy.cancel}</button></section></div>}
  </div></div>;
}
