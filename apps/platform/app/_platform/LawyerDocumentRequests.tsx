"use client";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- request records are loaded from the authenticated handoff API */

import Link from "next/link";
import { FileCheck2, FileQuestion, LoaderCircle, Send, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { lawyerIntlLocale, lawyerText } from "../../lib/platform/lawyer-localization";
import type { PlatformLocale } from "../../lib/platform/routing";
import { lawyerWorkspaceOperationError } from "../../lib/platform/lawyer-workspace-operations";
import { usePlatformBasePath } from "./PlatformRouteContext";

type DocumentRequest = {
  id: string;
  title: string;
  description: string;
  status: "requested" | "provided" | "cancelled";
  providedDocumentId: string | null;
  providedDocumentTitle: string | null;
  createdAt: string;
};

type DocumentOption = { id: string; title: string; status: string; updatedAt: string };

export function LawyerDocumentRequests({
  requestId,
  locale,
  role,
}: {
  requestId: string;
  locale: PlatformLocale;
  role: "client" | "lawyer";
}) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);
  const base = usePlatformBasePath();
  const [requests, setRequests] = useState<DocumentRequest[]>([]);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/platform/lawyer-document-requests?requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" });
    const body = await response.json() as { requests?: DocumentRequest[]; documents?: DocumentOption[] };
    if (!response.ok) throw new Error(lawyerText(locale, "Не удалось загрузить запросы документов.", "Hujjat so‘rovlarini yuklab bo‘lmadi.", "We could not load the document requests."));
    setRequests(body.requests ?? []);
    setDocuments(body.documents ?? []);
  }, [locale, requestId]);

  useEffect(() => {
    void load().catch((value) => setError(value instanceof Error ? value.message : String(value))).finally(() => setLoading(false));
  }, [load]);

  async function mutate(payload: Record<string, unknown>, actionId: string) {
    setBusyId(actionId);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform/lawyer-document-requests", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ requestId, locale, ...payload }),
      });
      const body = await response.json() as { code?: string };
      if (!response.ok) throw new Error(lawyerWorkspaceOperationError(locale, body.code || "INVALID_INPUT"));
      setNotice(role === "lawyer"
        ? text("Запрос документов обновлён.", "Hujjat so‘rovi yangilandi.", "Document request updated.")
        : text("Документ предоставлен юристу.", "Hujjat yuristga taqdim etildi.", "Document shared with the lawyer."));
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await mutate({ action: "request", title, description }, "new");
      setTitle("");
      setDescription("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }

  return <section className="lawyer-document-requests" aria-label={text("Запросы документов", "Hujjat so‘rovlari", "Document requests")}>
    <header><FileQuestion aria-hidden="true" /><div><strong>{text("Документы по заявке", "So‘rov hujjatlari", "Request documents")}</strong><small>{text("Запрос и передача фиксируются в журнале дела", "So‘rov va taqdim etish ish jurnalida qayd etiladi", "Requests and disclosures are recorded in the case audit log")}</small></div></header>
    {error && <p className="lawyer-inline-error" role="alert">{error}</p>}
    {notice && <p className="lawyer-inline-notice" role="status">{notice}</p>}
    {role === "lawyer" && <form className="lawyer-document-request-form" onSubmit={(event) => void create(event)}>
      <label>{text("Что требуется", "Nima kerak", "Document required")}<input required minLength={2} maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>{text("Пояснение клиенту", "Mijoz uchun izoh", "Instructions for the client")}<textarea required minLength={4} maxLength={2_000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <button type="submit" disabled={busyId === "new" || title.trim().length < 2 || description.trim().length < 4}>{busyId === "new" ? <LoaderCircle className="spin" /> : <Send />}{text("Запросить документ", "Hujjatni so‘rash", "Request document")}</button>
    </form>}
    {loading ? <div className="lawyer-inline-loading"><LoaderCircle className="spin" /></div> : <div className="lawyer-document-request-list">
      {requests.map((item) => <article key={item.id} data-status={item.status}>
        <FileCheck2 aria-hidden="true" /><div><strong>{item.title}</strong><p>{item.description}</p><small>{documentRequestStatus(item.status, locale)} · {new Intl.DateTimeFormat(lawyerIntlLocale(locale), { dateStyle: "medium", timeZone: "Asia/Tashkent" }).format(new Date(item.createdAt))}</small></div>
        {item.providedDocumentId && <Link href={`${base}/documents/${encodeURIComponent(item.providedDocumentId)}`}>{item.providedDocumentTitle || text("Открыть документ", "Hujjatni ochish", "Open document")}</Link>}
        {role === "client" && item.status === "requested" && <div className="lawyer-document-provide"><Select aria-label={text("Выберите документ", "Hujjatni tanlang", "Select a document")} value={selection[item.id] || ""} onChange={(event) => setSelection((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">{documents.length ? text("Выберите документ дела", "Ish hujjatini tanlang", "Select a case document") : text("В деле пока нет документов", "Ishda hujjat yo‘q", "There are no documents in this case yet")}</option>{documents.map((document) => <option value={document.id} key={document.id}>{document.title}</option>)}</Select><button type="button" disabled={!selection[item.id] || busyId === item.id} onClick={() => void mutate({ action: "provide", documentRequestId: item.id, documentId: selection[item.id] }, item.id).catch((value) => setError(value instanceof Error ? value.message : String(value)))}>{busyId === item.id ? <LoaderCircle className="spin" /> : <FileCheck2 />}{text("Предоставить", "Taqdim etish", "Share document")}</button></div>}
        {role === "lawyer" && item.status === "requested" && <button className="lawyer-document-request-cancel" type="button" disabled={busyId === item.id} onClick={() => void mutate({ action: "cancel", documentRequestId: item.id }, item.id).catch((value) => setError(value instanceof Error ? value.message : String(value)))}><X />{text("Отменить", "Bekor qilish", "Cancel request")}</button>}
      </article>)}
      {!requests.length && <p className="lawyer-inline-empty">{text("Запросов документов пока нет.", "Hujjat so‘rovlari hozircha yo‘q.", "No document requests yet.")}</p>}
    </div>}
  </section>;
}

function documentRequestStatus(status: DocumentRequest["status"], locale: PlatformLocale) {
  const labels: Record<DocumentRequest["status"], [string, string, string]> = {
    requested: ["Ожидается документ", "Hujjat kutilmoqda", "Awaiting document"],
    provided: ["Документ предоставлен", "Hujjat taqdim etildi", "Document shared"],
    cancelled: ["Запрос отменён", "So‘rov bekor qilindi", "Request cancelled"],
  };
  return lawyerText(locale, labels[status][0], labels[status][1], labels[status][2]);
}
