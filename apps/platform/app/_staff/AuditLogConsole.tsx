"use client";

import { Select } from "../_components/Select";

import { Download, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import type {
  PlatformAuditFilters,
  PlatformAuditRow,
  PlatformAuditSeverity,
  PlatformAuditSource,
} from "../../lib/operations/platform-audit-log";
import type { OperationalLocale } from "../../lib/operations/operational-feature-flags";

type AuditResponse = {
  rows: PlatformAuditRow[];
  filters: PlatformAuditFilters;
  accessEventId: string;
  accessIntegrity: { valid: true; checked: number };
};

const sources: PlatformAuditSource[] = ["security", "staff_role", "workspace", "operations"];
const severities: PlatformAuditSeverity[] = ["info", "warning", "critical"];
const copy = {
  ru: {
    skip: "К основному содержимому", secure: "Защищённая рабочая зона", fresh: "Недавняя 2FA",
    eyebrow: "Безопасность и доказательства", title: "Журнал действий платформы",
    description: "Только технические идентификаторы и состояния. Пользовательский текст, документы и provider payload не отображаются.",
    source: "Источник", severity: "Важность", action: "Действие содержит", actor: "ID исполнителя",
    scope: "Workspace / область", from: "С даты", to: "По дату", all: "Все", apply: "Применить",
    refresh: "Обновить", export: "Экспорт CSV", loading: "Загрузка журнала…", empty: "Событий по фильтру нет.",
    offline: "Нет сети. Журнал не загружался.", failed: "Не удалось получить журнал.",
    integrity: "Доступ к журналу записан в неизменяемую цепочку", event: "Событие доступа",
    created: "Время", entity: "Объект", identifiers: "Идентификаторы", navJobs: "Задания", navSecurity: "Функции", navCosts: "Расходы",
  },
  uz: {
    skip: "Asosiy mazmunga o‘tish", secure: "Himoyalangan ish maydoni", fresh: "Yaqindagi 2FA",
    eyebrow: "Xavfsizlik va dalillar", title: "Platforma harakatlari jurnali",
    description: "Faqat texnik identifikatorlar va holatlar. Foydalanuvchi matni, hujjatlar va provider payload ko‘rsatilmaydi.",
    source: "Manba", severity: "Muhimlik", action: "Harakat tarkibida", actor: "Bajaruvchi ID",
    scope: "Workspace / soha", from: "Boshlanish", to: "Tugash", all: "Barchasi", apply: "Qo‘llash",
    refresh: "Yangilash", export: "CSV eksport", loading: "Jurnal yuklanmoqda…", empty: "Filtr bo‘yicha hodisa yo‘q.",
    offline: "Tarmoq yo‘q. Jurnal yuklanmadi.", failed: "Jurnalni olish imkoni bo‘lmadi.",
    integrity: "Jurnalga kirish o‘zgarmas zanjirga yozildi", event: "Kirish hodisasi",
    created: "Vaqt", entity: "Obyekt", identifiers: "Identifikatorlar", navJobs: "Vazifalar", navSecurity: "Funksiyalar", navCosts: "Xarajatlar",
  },
  en: {
    skip: "Skip to main content", secure: "Secure workspace", fresh: "Recent 2FA",
    eyebrow: "Security and evidence", title: "Platform audit log",
    description: "Only technical identifiers and states are shown. User text, documents and provider payloads are excluded.",
    source: "Source", severity: "Severity", action: "Action contains", actor: "Actor ID",
    scope: "Workspace / scope", from: "From", to: "To", all: "All", apply: "Apply",
    refresh: "Refresh", export: "Export CSV", loading: "Loading audit log…", empty: "No events match these filters.",
    offline: "You are offline. The audit log was not loaded.", failed: "The audit log could not be loaded.",
    integrity: "Audit access was recorded in the immutable chain", event: "Access event",
    created: "Time", entity: "Entity", identifiers: "Identifiers", navJobs: "Jobs", navSecurity: "Features", navCosts: "Costs",
  },
} as const;

function timestamp(value: string): string {
  return `${value.replace("T", " ").slice(0, 19)} UTC`;
}

function filtersFromForm(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form);
  const filters: Record<string, unknown> = { limit: 200 };
  for (const key of ["source", "severity", "action", "actorUserId", "scopeId"] as const) {
    const value = String(data.get(key) ?? "").trim();
    if (value) filters[key] = value;
  }
  for (const key of ["from", "to"] as const) {
    const value = String(data.get(key) ?? "").trim();
    if (value) filters[key] = new Date(value).toISOString();
  }
  return filters;
}

async function requestAudit(action: "query" | "export", filters: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return fetch("/api/platform/admin/audit-log", {
    method: "POST",
    headers: { "content-type": "application/json", "x-juro-csrf": "1" },
    body: JSON.stringify({ action, filters }),
    cache: "no-store",
    signal,
  });
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function AuditLogConsole({ locale, staffName }: { locale: OperationalLocale; staffName: string }) {
  const t = copy[locale];
  const nextLocale: OperationalLocale = locale === "ru" ? "uz" : locale === "uz" ? "en" : "ru";
  const [rows, setRows] = useState<PlatformAuditRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [accessEventId, setAccessEventId] = useState("");
  const [integrityCount, setIntegrityCount] = useState(0);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  useEffect(() => {
    const controller = new AbortController();
    void requestAudit("query", { limit: 200 }, controller.signal)
      .then(async (response) => {
        const body = await response.json() as AuditResponse & { code?: string };
        if (!response.ok) throw new Error(body.code ?? `HTTP_${response.status}`);
        setRows(body.rows);
        setAccessEventId(body.accessEventId);
        setIntegrityCount(body.accessIntegrity.checked);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "PLATFORM_AUDIT_LOAD_FAILED");
      })
      .finally(() => setBusy(false));
    return () => {
      controller.abort();
    };
  }, []);

  async function runQuery(form: HTMLFormElement) {
    if (!online) { setError(t.offline); return; }
    setBusy(true);
    setError("");
    try {
      const response = await requestAudit("query", filtersFromForm(form));
      const body = await response.json() as AuditResponse & { code?: string };
      if (!response.ok) throw new Error(body.code ?? `HTTP_${response.status}`);
      setRows(body.rows);
      setAccessEventId(body.accessEventId);
      setIntegrityCount(body.accessIntegrity.checked);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.failed);
    } finally { setBusy(false); }
  }

  async function exportCsv(form: HTMLFormElement) {
    if (!online) { setError(t.offline); return; }
    setBusy(true);
    setError("");
    try {
      const response = await requestAudit("export", filtersFromForm(form));
      if (!response.ok) {
        const body = await response.json() as { code?: string };
        throw new Error(body.code ?? `HTTP_${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "juro-audit-log.csv";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setAccessEventId(response.headers.get("x-juro-audit-event") ?? "");
      setIntegrityCount((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.failed);
    } finally { setBusy(false); }
  }

  return <div className="staff-console audit-console" aria-busy={busy}>
    <a className="staff-skip" href="#audit-main">{t.skip}</a>
    <header className="staff-topbar"><div className="staff-brand"><ShieldCheck aria-hidden="true"/><span><b>JURO</b><small>{t.secure}</small></span></div><div className="staff-session"><span>{t.fresh}</span><b>{staffName}</b></div><a href={`/${nextLocale}/admin/audit-log`} hrefLang={nextLocale}>{nextLocale.toUpperCase()}</a></header>
    <main id="audit-main" className="staff-main audit-main">
      <section className="staff-heading"><div><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.description}</p></div><nav className="audit-nav" aria-label="Admin"><a href={`/${locale}/admin/jobs`}>{t.navJobs}</a><a href={`/${locale}/admin/feature-flags`}>{t.navSecurity}</a><a href={`/${locale}/admin/costs`}>{t.navCosts}</a></nav></section>
      <p className="sr-only" aria-live="polite">{busy ? t.loading : accessEventId ? `${t.integrity}: ${accessEventId}` : ""}</p>
      {!online ? <p className="staff-error" role="status">{t.offline}</p> : null}
      {error ? <p className="staff-error" role="alert">{error}</p> : null}
      {accessEventId ? <p className="audit-integrity"><ShieldCheck aria-hidden="true"/><span>{t.integrity} · {integrityCount}<small>{t.event}: <code>{accessEventId}</code></small></span></p> : null}
      <form className="audit-filters" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void runQuery(event.currentTarget); }}>
        <label>{t.source}<Select name="source"><option value="">{t.all}</option>{sources.map((source) => <option key={source} value={source}>{source}</option>)}</Select></label>
        <label>{t.severity}<Select name="severity"><option value="">{t.all}</option>{severities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}</Select></label>
        <label>{t.action}<input name="action" maxLength={80} pattern="[A-Za-z0-9._:-]+"/></label>
        <label>{t.actor}<input name="actorUserId" maxLength={180} pattern="[A-Za-z0-9:_-]+"/></label>
        <label>{t.scope}<input name="scopeId" maxLength={180} pattern="[A-Za-z0-9:_-]+"/></label>
        <label>{t.from}<input name="from" type="datetime-local"/></label>
        <label>{t.to}<input name="to" type="datetime-local"/></label>
        <div className="audit-filter-actions"><button disabled={busy || !online}><Search aria-hidden="true"/>{t.apply}</button><button type="button" onClick={(event) => void runQuery(event.currentTarget.form!)} disabled={busy || !online}><RefreshCw aria-hidden="true"/>{t.refresh}</button><button type="button" onClick={(event) => void exportCsv(event.currentTarget.form!)} disabled={busy || !online}><Download aria-hidden="true"/>{t.export}</button></div>
      </form>
      <section className="audit-table-wrap" aria-label={t.title}>
        {busy && !rows.length ? <p className="staff-empty">{t.loading}</p> : rows.length ? <table><thead><tr><th>{t.created}</th><th>{t.source}</th><th>{t.severity}</th><th>{t.action}</th><th>{t.entity}</th><th>{t.identifiers}</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.source}:${row.id}`}><td><time dateTime={row.createdAt}>{timestamp(row.createdAt)}</time></td><td>{row.source}</td><td><span className={`audit-severity audit-severity--${row.severity}`}>{row.severity}</span></td><td><code>{row.action}</code></td><td><b>{row.entityType}</b><small>{row.entityId ?? "—"}</small></td><td><details><summary>{t.identifiers}</summary><dl><div><dt>ID</dt><dd>{row.id}</dd></div><div><dt>actor</dt><dd>{row.actorUserId ?? "system"}</dd></div><div><dt>scope</dt><dd>{row.scopeId}</dd></div></dl></details></td></tr>)}</tbody></table> : <p className="staff-empty">{t.empty}</p>}
      </section>
    </main>
  </div>;
}
