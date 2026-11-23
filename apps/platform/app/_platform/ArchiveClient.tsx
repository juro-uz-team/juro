"use client";

import { WorkspacePagination, useWorkspacePagination } from "./WorkspacePagination";
import { WorkspaceTitle } from "./WorkspaceTitle";

import { usePlatformBasePath } from "./PlatformRouteContext";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated archive data is hydrated after the first browser render */

import Link from "next/link";
import { Archive, CircleAlert, FileCheck2, LoaderCircle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { platformApiError } from "../../content/platform-ui";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";

type Item = { id: string; title: string; category?: string; legalArea?: string; archivedAt: string; canRestore?: number };

const archiveCopy = {
  ru: { loadError: "Архив не загрузился.", restoreError: "Объект не восстановлен.", title: "Архив", description: "Архив скрывает объект из рабочих списков, но не удаляет его. Старые публичные ссылки не активируются при восстановлении.", documents: "Документы", open: "Открыть", restore: "Восстановить", noDocuments: "Архивных документов нет.", cases: "Дела", noCases: "Архивных дел нет." },
  uz: { loadError: "Arxiv yuklanmadi.", restoreError: "Obyekt tiklanmadi.", title: "Arxiv", description: "Arxiv obyektni ish ro‘yxatlaridan yashiradi, ammo o‘chirmaydi. Eski ommaviy havolalar tiklanganda faollashmaydi.", documents: "Hujjatlar", open: "Ochish", restore: "Tiklash", noDocuments: "Arxiv hujjatlari yo‘q.", cases: "Ishlar", noCases: "Arxiv ishlar yo‘q." },
  en: { loadError: "We could not load the archive.", restoreError: "We could not restore this item.", title: "Archive", description: "The archive hides an item from working lists without deleting it. Restoring an item does not reactivate old public links.", documents: "Documents", open: "Open", restore: "Restore", noDocuments: "No archived documents.", cases: "Matters", noCases: "No archived matters." },
} as const;

export function ArchiveClient({ locale }: { locale: PlatformLocale; accountType: AccountType }) {
  const copy = archiveCopy[locale];
  const base = usePlatformBasePath();
  const [documents, setDocuments] = useState<Item[]>([]);
  const [cases, setCases] = useState<Item[]>([]);
  const documentPages = useWorkspacePagination(documents.length, 5);
  const casePages = useWorkspacePagination(cases.length, 5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const restoreKeys = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/platform/archive", { cache: "no-store" });
      const body = await response.json() as { documents?: Item[]; cases?: Item[]; error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.loadError));
      setDocuments(body.documents ?? []);
      setCases(body.cases ?? []);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  }, [copy.loadError, locale]);
  useEffect(() => { void load(); }, [load]);
  async function restore(type: "document" | "case", id: string) {
    const operation = `${type}:${id}`;
    const idempotencyKey = restoreKeys.current.get(operation) ?? `archive-restore-${crypto.randomUUID()}`;
    restoreKeys.current.set(operation, idempotencyKey);
    const response = await fetch("/api/platform/archive", { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, "x-juro-csrf": "1" }, body: JSON.stringify({ type, id }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) { setError(platformApiError(locale, body.error, copy.restoreError)); return; }
    restoreKeys.current.delete(operation);
    await load();
  }
  return <section className="archive-workspace workspace-page"><WorkspaceTitle icon={<Archive />} title={copy.title} description={copy.description} />{error && <p className="archive-error"><CircleAlert />{error}</p>}{loading ? <div className="archive-loading"><LoaderCircle className="spin" /></div> : <div className="archive-grid"><section><h2>{copy.documents}</h2>{documents.length ? documents.slice(documentPages.from, documentPages.to).map(item => <article key={item.id}><FileCheck2 /><div><strong>{item.title}</strong><small>{item.category} · {formatDate(item.archivedAt, locale)}</small></div><Link href={`${base}/documents/${item.id}`}>{copy.open}</Link>{Boolean(item.canRestore) && <button onClick={() => void restore("document", item.id)}><RotateCcw />{copy.restore}</button>}</article>) : <p>{copy.noDocuments}</p>}<WorkspacePagination locale={locale} {...documentPages} /></section><section><h2>{copy.cases}</h2>{cases.length ? cases.slice(casePages.from, casePages.to).map(item => <article key={item.id}><Archive /><div><strong>{item.title}</strong><small>{item.legalArea} · {formatDate(item.archivedAt, locale)}</small></div><button onClick={() => void restore("case", item.id)}><RotateCcw />{copy.restore}</button></article>) : <p>{copy.noCases}</p>}<WorkspacePagination locale={locale} {...casePages} /></section></div>}</section>;
}
function formatDate(value: string, locale: PlatformLocale) { return new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], { dateStyle: "medium", timeZone: "Asia/Tashkent" }).format(new Date(value)); }
