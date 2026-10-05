"use client";

import { Select } from "../_components/Select";

import { RefreshCw, Save, Settings2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type {
  AiResponseTone,
  AiRuntimeConfigHistoryRow,
  AiRuntimeModelAllowlist,
  AiRuntimeSettings,
} from "../../lib/ai/runtime-settings";
import { platformIntlLocale } from "../../lib/platform/date-time";
import { OPENAI_FAST_CHAT_MODEL, OPENAI_DEEP_CHAT_MODEL } from "../../lib/ai/provider-models";
import type { PlatformLocale } from "../../lib/platform/routing";

type Locale = PlatformLocale;
type Dashboard = { current: AiRuntimeSettings; allowlist: AiRuntimeModelAllowlist; history: AiRuntimeConfigHistoryRow[] };
const copy = {
  ru: {
    skip: "К настройкам",
    title: "Настройки AI-моделей", description: "Версионируемые runtime-настройки. Доступны только модели из серверного allowlist; защищённые правила JURO не редактируются.",
    secure: "ADMIN · свежая 2FA", environment: "Среда", chat: "Быстрый чат", deep: "Глубокий чат", anthropicChat: "Резерв чата", document: "Анализ документов", openaiDocument: "Резерв анализа", tone: "Тон ответа", clear: "Ясный", formal: "Формальный", concise: "Краткий", reason: "Причина изменения", save: "Создать версию", refresh: "Обновить", success: "Новая версия активна.", loading: "Загрузка…", history: "История версий", empty: "Версий в D1 пока нет — используются server variables.", protected: "Неизменяемые правила", protectedText: "Юрисдикция Узбекистана, allowlist источников, запрет вымышленных ссылок, tenant authorization, privacy, retention и prompt-injection защита остаются в коде.", version: "Версия", created: "Создана", hash: "Config hash", actor: "Автор",
  },
  uz: {
    skip: "Sozlamalarga o‘tish",
    title: "AI-modellar sozlamalari", description: "Versiyalangan runtime-sozlamalar. Faqat server allowlistidagi modellar tanlanadi; JUROning himoyalangan qoidalari tahrirlanmaydi.",
    secure: "ADMIN · yangi 2FA", environment: "Muhit", chat: "Tezkor chat", deep: "Chuqur chat", anthropicChat: "Chat zaxirasi", document: "Hujjat tahlili", openaiDocument: "Tahlil zaxirasi", tone: "Javob ohangi", clear: "Aniq", formal: "Rasmiy", concise: "Qisqa", reason: "O‘zgartirish sababi", save: "Versiya yaratish", refresh: "Yangilash", success: "Yangi versiya faol.", loading: "Yuklanmoqda…", history: "Versiyalar tarixi", empty: "D1da versiya yo‘q — server variables ishlatilmoqda.", protected: "O‘zgarmas qoidalar", protectedText: "O‘zbekiston yurisdiksiyasi, manbalar allowlisti, soxta havolalarni taqiqlash, tenant authorization, maxfiylik, retention va prompt-injection himoyasi kodda qoladi.", version: "Versiya", created: "Yaratilgan", hash: "Config hash", actor: "Muallif",
  },
  en: {
    skip: "Skip to settings",
    title: "AI model settings", description: "Versioned runtime settings. Only models on the server allowlist can be selected; JURO’s protected rules cannot be edited here.",
    secure: "ADMIN · recent 2FA", environment: "Environment", chat: "Fast chat", deep: "Deep chat", anthropicChat: "Chat fallback", document: "Document analysis", openaiDocument: "Analysis fallback", tone: "Response tone", clear: "Clear", formal: "Formal", concise: "Concise", reason: "Reason for change", save: "Create version", refresh: "Refresh", success: "The new version is active.", loading: "Loading…", history: "Version history", empty: "There are no versions in D1 yet — server variables are in use.", protected: "Immutable rules", protectedText: "Uzbekistan jurisdiction, the source allowlist, the ban on fabricated citations, tenant authorisation, privacy, retention and prompt-injection protection remain enforced in code.", version: "Version", created: "Created", hash: "Config hash", actor: "Author",
  },
} as const;

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/platform/admin/ai-settings", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-juro-csrf": "1" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(payload.code || `HTTP ${response.status}`);
  return payload;
}

export function AiSettingsConsole({ locale, staffName }: { locale: Locale; staffName: string }) {
  const t = copy[locale];
  const nextLocale: Locale = locale === "ru" ? "uz" : locale === "uz" ? "en" : "ru";
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [form, setForm] = useState<AiRuntimeSettings | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const value = await post<Dashboard>({ action: "query" });
      setDashboard(value); setForm(value.current);
    } catch (value) { setError(value instanceof Error ? value.message : "REQUEST_FAILED"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const update = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!form || !dashboard) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await post({
        action: "update", expectedVersion: dashboard.current.version,
        openaiChatModel: form.openaiChatModel, openaiDeepModel: form.openaiDeepModel,
        anthropicChatFallbackModel: form.anthropicChatFallbackModel,
        anthropicDocumentModel: form.anthropicDocumentModel,
        openaiDocumentFallbackModel: form.openaiDocumentFallbackModel,
        responseTone: form.responseTone, reason,
      });
      setReason(""); setMessage(t.success); await load();
    } catch (value) { setError(value instanceof Error ? value.message : "REQUEST_FAILED"); setBusy(false); }
  };
  const select = (field: keyof AiRuntimeSettings, values: string[], label: string) => <label>{label}<Select value={String(form?.[field] ?? "")} onChange={(event) => setForm((current) => current ? { ...current, [field]: event.target.value } : current)}>{values.map((value) => <option key={value}>{value}</option>)}</Select></label>;
  return <div className="staff-console ai-settings-console">
    <a className="staff-skip" href="#ai-settings-main">{t.skip}</a>
    <header className="staff-topbar"><div className="staff-brand"><Settings2 aria-hidden="true"/><span><b>JURO</b><small>AI SETTINGS</small></span></div><div className="staff-session"><span>{t.secure}</span><b>{staffName}</b></div><a href={`/${nextLocale}/admin/ai-settings`} hrefLang={nextLocale}>{nextLocale.toUpperCase()}</a></header>
    <main id="ai-settings-main" className="staff-main ai-settings-main">
      <section className="staff-heading"><div><span>JURO · {dashboard?.current.environment ?? "—"}</span><h1>{t.title}</h1><p>{t.description}</p></div><button type="button" onClick={() => void load()} disabled={busy}><RefreshCw aria-hidden="true"/>{t.refresh}</button></section>
      <div aria-live="polite">{error && <p className="staff-error" role="alert">{error}</p>}{message && <p className="staff-verified"><ShieldCheck aria-hidden="true"/>{message}</p>}</div>
      {!dashboard || !form ? <p className="staff-loading" role="status">{t.loading}</p> : <>
        <section className="ai-settings-protected"><ShieldCheck aria-hidden="true"/><div><h2>{t.protected}</h2><p>{t.protectedText}</p></div></section>
        <form className="staff-decision ai-settings-form" onSubmit={(event) => void update(event)}>
          <div className="ai-settings-grid">
            {select("openaiChatModel", [OPENAI_FAST_CHAT_MODEL], t.chat)}
            {select("openaiDeepModel", [OPENAI_DEEP_CHAT_MODEL], t.deep)}
            {select("anthropicChatFallbackModel", dashboard.allowlist.anthropic, t.anthropicChat)}
            {select("anthropicDocumentModel", dashboard.allowlist.anthropic, t.document)}
            {select("openaiDocumentFallbackModel", dashboard.allowlist.openai, t.openaiDocument)}
            <label>{t.tone}<Select value={form.responseTone} onChange={(event) => setForm({ ...form, responseTone: event.target.value as AiResponseTone })}><option value="clear">{t.clear}</option><option value="formal">{t.formal}</option><option value="concise">{t.concise}</option></Select></label>
          </div>
          <label>{t.reason}<textarea required minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
          <button className="staff-approve" type="submit" disabled={busy || reason.trim().length < 10}><Save aria-hidden="true"/>{t.save}</button>
        </form>
        <section className="feature-history"><h2>{t.history}</h2>{dashboard.history.length === 0 ? <div className="staff-empty"><p>{t.empty}</p></div> : dashboard.history.map((row) => <article className="ai-settings-history" key={row.id}><b>{t.version} {row.version}</b><span>{row.openaiChatModel} · {row.anthropicDocumentModel}<small>{row.reason}</small></span><code title={row.configHash}>{row.configHash.slice(0, 16)}…</code><time>{new Intl.DateTimeFormat(platformIntlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(row.createdAt))}</time></article>)}</section>
      </>}
    </main>
  </div>;
}
