"use client";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated audit data is hydrated after the first browser render */

import { CircleAlert, Filter, History, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { platformApiError } from "../../content/platform-ui";
import type { PlatformLocale } from "../../lib/platform/routing";

type EventItem = { id: string; source: string; entityType: string; entityId: string | null; action: string; createdAt: string };

const historyCopy = {
  ru: { loadError: "История не загрузилась.", eyebrow: "JURO · ХРОНОЛОГИЯ", title: "История действий", description: "Проверяемая хронология работы: вопросы, документы, дела и системные проверки.", filter: "Фильтр истории", all: "Все события", workspace: "Пространство", documents: "Документы", cases: "Дела", empty: "Событий пока нет" },
  uz: { loadError: "Tarix yuklanmadi.", eyebrow: "JURO · XRONOLOGIYA", title: "Harakatlar tarixi", description: "Tekshiriladigan ish xronologiyasi: savollar, hujjatlar, ishlar va tizim tekshiruvlari.", filter: "Tarix filtri", all: "Barcha voqealar", workspace: "Makon", documents: "Hujjatlar", cases: "Ishlar", empty: "Hozircha voqealar yo‘q" },
  en: { loadError: "We could not load the activity history.", eyebrow: "JURO · ACTIVITY", title: "Activity history", description: "A verifiable timeline of questions, documents, matters and system checks.", filter: "Filter activity history", all: "All events", workspace: "Workspace", documents: "Documents", cases: "Matters", empty: "No events yet" },
} as const;

export function HistoryClient({ locale }: { locale: PlatformLocale }) {
  const copy = historyCopy[locale];
  const [events, setEvents] = useState<EventItem[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/platform/history", { cache: "no-store" });
      const body = await response.json() as { events?: EventItem[]; error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.loadError));
      setEvents(body.events ?? []);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  }, [copy.loadError, locale]);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => filter === "all" ? events : events.filter(event => event.source === filter), [events, filter]);
  return <section className="history-workspace"><header><History /><div><small>{copy.eyebrow}</small><h1>{copy.title}</h1><p>{copy.description}</p></div></header>{error && <p className="history-error"><CircleAlert />{error}</p>}<div className="history-filter"><Filter /><label><span className="sr-only">{copy.filter}</span><Select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">{copy.all}</option><option value="workspace">{copy.workspace}</option><option value="document">{copy.documents}</option><option value="case">{copy.cases}</option></Select></label></div>{loading ? <div className="history-loading"><LoaderCircle className="spin" /></div> : visible.length ? <ol className="history-list">{visible.map(event => <li key={`${event.source}-${event.id}`}><span>{sourceLabel(event.source, locale)}</span><div><strong>{actionLabel(event.action, locale)}</strong><small>{entityLabel(event.entityType, locale)}</small></div><time>{formatDateTime(event.createdAt, locale)}</time></li>)}</ol> : <div className="history-empty"><History /><h2>{copy.empty}</h2></div>}</section>;
}

function sourceLabel(source: string, locale: PlatformLocale) {
  const labels: Record<string, Record<PlatformLocale, string>> = { workspace: { ru: "Пространство", uz: "Makon", en: "Workspace" }, document: { ru: "Документ", uz: "Hujjat", en: "Document" }, case: { ru: "Дело", uz: "Ish", en: "Matter" } };
  return labels[source]?.[locale] ?? source;
}
function actionLabel(action: string, locale: PlatformLocale) {
  const labels: Record<string, Record<PlatformLocale, string>> = {
    workspace_created: { ru: "Создано пространство", uz: "Makon yaratildi", en: "Workspace created" }, onboarding_completed: { ru: "Завершён onboarding", uz: "Onboarding yakunlandi", en: "Onboarding completed" },
    profile_updated: { ru: "Обновлён профиль", uz: "Profil yangilandi", en: "Profile updated" }, document_created: { ru: "Создан документ", uz: "Hujjat yaratildi", en: "Document created" },
    document_archived: { ru: "Документ архивирован", uz: "Hujjat arxivlandi", en: "Document archived" }, document_restored: { ru: "Документ восстановлен", uz: "Hujjat tiklandi", en: "Document restored" },
    case_created: { ru: "Создано дело", uz: "Ish yaratildi", en: "Matter created" }, ai_intake_completed: { ru: "Завершён AI-разбор", uz: "AI tahlili yakunlandi", en: "AI intake completed" },
    ai_chat_completed: { ru: "AI-ответ подготовлен", uz: "AI javobi tayyorlandi", en: "AI response prepared" },
    upload_initiated: { ru: "Загрузка файла начата", uz: "Fayl yuklash boshlandi", en: "File upload started" },
    upload_completed: { ru: "Файл загружен", uz: "Fayl yuklandi", en: "File uploaded" },
    upload_quarantined: { ru: "Файл изолирован для проверки", uz: "Fayl tekshiruv uchun ajratildi", en: "File quarantined for review" },
    malware_scan_clean: { ru: "Проверка файла завершена", uz: "Fayl tekshiruvi yakunlandi", en: "File security check completed" },
    invitation_sent: { ru: "Отправлено приглашение", uz: "Taklif yuborildi", en: "Invitation sent" }, invitation_accepted: { ru: "Приглашение принято", uz: "Taklif qabul qilindi", en: "Invitation accepted" },
  };
  return labels[action]?.[locale] ?? { ru: "Системное действие", uz: "Tizim harakati", en: "System action" }[locale];
}
function entityLabel(entityType: string, locale: PlatformLocale) {
  const labels: Record<string, Record<PlatformLocale, string>> = {
    conversation: { ru: "Юридический диалог", uz: "Yuridik suhbat", en: "Legal conversation" },
    document: { ru: "Документ", uz: "Hujjat", en: "Document" },
    document_analysis: { ru: "Анализ документа", uz: "Hujjat tahlili", en: "Document analysis" },
    case: { ru: "Юридическое дело", uz: "Yuridik ish", en: "Legal matter" },
    workspace: { ru: "Рабочее пространство", uz: "Ish makoni", en: "Workspace" },
    user: { ru: "Профиль", uz: "Profil", en: "Profile" },
  };
  return labels[entityType]?.[locale] ?? { ru: "Событие пространства", uz: "Makon voqeasi", en: "Workspace event" }[locale];
}
function formatDateTime(value: string, locale: PlatformLocale) {
  return new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(value));
}
