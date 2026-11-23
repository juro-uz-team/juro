"use client";

import { usePlatformBasePath, usePlatformWorkspaceId } from "./PlatformRouteContext";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated monitoring preferences are hydrated after the first browser render */

import {
  BellRing,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileSearch,
  Gavel,
  LoaderCircle,
  RefreshCw,
  Save,
  Scale,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";
import {
  normalizeMonitoringAudience,
  type MonitoringAudience,
} from "../../lib/platform/monitoring-preferences";

const topicKeys = [
  "civil",
  "contract",
  "labor",
  "family",
  "tax",
  "entrepreneurship",
  "corporate",
  "administrative",
  "consumer",
  "personal_data_it",
  "banking_finance",
] as const;

type Topic = typeof topicKeys[number];
type Preference = {
  audience: MonitoringAudience;
  topics: string[];
  channels: string[];
  frequency: "immediate" | "daily" | "weekly";
  locale: PlatformLocale;
  documentImpactConsent: boolean;
  updatedAt?: string;
  lastDeliveredAt?: string | null;
};
type MonitoringStatus = {
  integration: "disabled" | "active" | "degraded";
  automaticPublication: boolean;
  controlledBeta: boolean;
  emailConfigured: boolean;
  lastCheckedAt: string | null;
  verifiedSourceCount: number;
  trustedSourceCount: number;
  lexIngestionEnabled: boolean;
  lastRun: {
    status: string;
    runType: string;
    discoveredCount: number;
    fetchedCount: number;
    changedCount: number;
    verifiedCount: number;
    errorCount: number;
    startedAt: string;
    finishedAt: string | null;
    errorSummary: string | null;
  } | null;
  freshness: {
    state: "fresh" | "stale" | "unavailable";
    latestCheckedAt: string | null;
    ageDays: number | null;
    maxAgeDays: number;
    freshSourceCount: number;
    trustedSourceCount: number;
  };
};
type LegislationUpdate = {
  id: string;
  title: string;
  summary: string | null;
  changeSummary: string | null;
  recommendedAction: string | null;
  originalLanguage: string;
  topics: string[];
  affectedAudiences: string[];
  adoptedAt: string | null;
  effectiveAt: string | null;
  publishedAt: string;
  sourceTitle: string;
  sourceIdentifier: string | null;
  officialUrl: string;
  sourceRevisionDate: string | null;
  sourceLastCheckedAt: string | null;
  sourceStatus: string;
};

const copy = {
  ru: {
    title: "Мониторинг законодательства",
    intro: "Последние записи из официальной RSS-ленты Lex.uz. Откройте акт в первоисточнике, чтобы проверить его содержание.",
    deliveryNote: "При изменении уже известной записи приходит уведомление в рабочем пространстве. Темы, аудитория и частота сохраняются как предпочтения.",
    runFailed: "Последняя проверка Lex.uz не удалась",
    preferences: "Предпочтения мониторинга",
    preferencesHint: "Настройки сохраняются для текущего пространства.",
    audience: "Кого затрагивают обновления",
    individual: "Физическое лицо",
    business: "Бизнес",
    topics: "Области права",
    frequency: "Частота",
    immediate: "Немедленно",
    daily: "Ежедневно",
    weekly: "Еженедельно",
    documentConsent: "Разрешить предлагать проверку выбранных мной документов при релевантном изменении закона.",
    consentHint: "JURO не сканирует все документы автоматически. Каждая проверка требует ваших прав доступа и отдельного запуска.",
    save: "Сохранить настройки",
    saved: "Настройки мониторинга сохранены.",
    integrationOff: "Lex.uz metadata-мониторинг сейчас отключён.",
    integrationPending: "Мониторинг Lex.uz включён, но свежий запуск ещё не завершён.",
    integrationActive: "Официальная лента Lex.uz доступна.",
    integrationAria: "Статус интеграции",
    controlledBeta: "Статус Lex.uz",
    fresh: "Есть свежий успешный запуск",
    stale: "Последняя сверка Lex.uz устарела",
    coverage: "Недавние записи и изменения в данных Lex.uz.",
    feed: "Обновления Lex.uz",
    empty: "Обнаруженных изменений Lex.uz пока нет",
    emptyHint: "Здесь появятся записи, найденные при проверке ленты.",
    lastCheck: "Последняя проверка источников",
    lastRun: "Последний запуск Lex.uz",
    never: "ещё не выполнялась",
    sources: "Проверено записей",
    adopted: "Принят",
    effective: "Вступает в силу",
    changed: "Что изменилось",
    action: "Рекомендуемое действие",
    original: "Язык оригинала",
    official: "Официальный источник",
    checkDocuments: "Проверить мои документы",
    createTask: "Создать задачу",
    lawyer: "Передать юристу",
    retry: "Повторить",
    loading: "Проверяем сохранённые записи…",
    loadError: "Мониторинг не загрузился.",
    selectTopicError: "Выберите хотя бы одну область права.",
    saveError: "Настройки не сохранены.",
  },
  uz: {
    title: "Qonunchilik monitoringi",
    intro: "Lex.uz rasmiy RSS lentasidagi so‘nggi yozuvlar. Hujjat mazmunini tekshirish uchun asl manbani oching.",
    deliveryNote: "Avvalgi yozuv o‘zgarsa, ish makonida bildirishnoma chiqadi. Mavzular, auditoriya va tezlik afzallik sifatida saqlanadi.",
    runFailed: "Lex.uz’ning oxirgi tekshiruvi muvaffaqiyatsiz tugadi",
    preferences: "Monitoring afzalliklari",
    preferencesHint: "Sozlamalar joriy makon uchun saqlanadi.",
    audience: "Yangilanishlar kimga taalluqli",
    individual: "Jismoniy shaxs",
    business: "Biznes",
    topics: "Huquq sohalari",
    frequency: "Tezlik",
    immediate: "Darhol",
    daily: "Har kuni",
    weekly: "Har hafta",
    documentConsent: "Qonundagi tegishli o‘zgarishda men tanlagan hujjatlarni tekshirishni taklif qilishga ruxsat berish.",
    consentHint: "JURO barcha hujjatlarni avtomatik skanerlamaydi. Har bir tekshiruv kirish huquqlaringiz va alohida ishga tushirishni talab qiladi.",
    save: "Sozlamalarni saqlash",
    saved: "Monitoring sozlamalari saqlandi.",
    integrationOff: "Lex.uz metadata monitoringi hozir o‘chirilgan.",
    integrationPending: "Lex.uz monitoringi yoqilgan, ammo yangi ishga tushirish hali tugamagan.",
    integrationActive: "Lex.uz rasmiy lentasi mavjud.",
    integrationAria: "Integratsiya holati",
    controlledBeta: "Lex.uz holati",
    fresh: "Yangi muvaffaqiyatli ishga tushirish mavjud",
    stale: "Lex.uz oxirgi tekshiruvi eskirgan",
    coverage: "Lex.uz’dagi so‘nggi yozuvlar va ma’lumot o‘zgarishlari.",
    feed: "Lex.uz yangilanishlari",
    empty: "Lex.uz’da aniqlangan o‘zgarishlar hozircha yo‘q",
    emptyHint: "Lenta tekshiruvida topilgan yozuvlar shu yerda ko‘rinadi.",
    lastCheck: "Manbalar oxirgi tekshirilgan vaqt",
    lastRun: "Lex.uz oxirgi ishga tushirilishi",
    never: "hali bajarilmagan",
    sources: "Tekshirilgan yozuvlar",
    adopted: "Qabul qilingan",
    effective: "Kuchga kiradi",
    changed: "Nima o‘zgardi",
    action: "Tavsiya etilgan harakat",
    original: "Asl til",
    official: "Rasmiy manba",
    checkDocuments: "Hujjatlarimni tekshirish",
    createTask: "Vazifa yaratish",
    lawyer: "Yuristga yuborish",
    retry: "Qayta urinish",
    loading: "Saqlangan yozuvlar tekshirilmoqda…",
    loadError: "Monitoring yuklanmadi.",
    selectTopicError: "Kamida bitta huquq sohasini tanlang.",
    saveError: "Sozlamalar saqlanmadi.",
  },
  en: {
    title: "Legislation monitoring",
    intro: "Recent records from the official Lex.uz RSS feeds. Open the official act to review its contents.",
    deliveryNote: "Changes to existing records appear in workspace notifications. Topics, audience and frequency are saved as preferences.",
    runFailed: "The last Lex.uz check failed",
    preferences: "Monitoring preferences",
    preferencesHint: "Preferences are saved for this workspace.",
    audience: "Who the updates affect",
    individual: "Individual",
    business: "Business",
    topics: "Areas of law",
    frequency: "Frequency",
    immediate: "Immediately",
    daily: "Daily",
    weekly: "Weekly",
    documentConsent: "Allow JURO to suggest checking documents I select when a relevant legal change is detected.",
    consentHint: "JURO does not scan all documents automatically. Each check requires your access rights and a separate action.",
    save: "Save settings",
    saved: "Monitoring settings saved.",
    integrationOff: "Lex.uz metadata monitoring is currently off.",
    integrationPending: "Lex.uz monitoring is on, but a recent run has not completed yet.",
    integrationActive: "The official Lex.uz feed is available.",
    integrationAria: "Integration status",
    controlledBeta: "Lex.uz status",
    fresh: "Recent successful run available",
    stale: "The latest Lex.uz check is out of date",
    coverage: "Recent Lex.uz records and changes to their metadata.",
    feed: "Lex.uz updates",
    empty: "No Lex.uz changes have been detected yet",
    emptyHint: "Records will appear here after the feed is checked.",
    lastCheck: "Last source check",
    lastRun: "Latest Lex.uz run",
    never: "not run yet",
    sources: "Records checked",
    adopted: "Adopted",
    effective: "Effective",
    changed: "What changed",
    action: "Recommended action",
    original: "Original language",
    official: "Official source",
    checkDocuments: "Check my documents",
    createTask: "Create task",
    lawyer: "Send to a lawyer",
    retry: "Try again",
    loading: "Checking saved records…",
    loadError: "Monitoring could not be loaded.",
    selectTopicError: "Choose at least one area of law.",
    saveError: "Settings could not be saved.",
  },
} as const;

const topicLabels: Record<Topic, Record<PlatformLocale, string>> = {
  civil: { ru: "Гражданское право", uz: "Fuqarolik huquqi", en: "Civil law" },
  contract: { ru: "Договорное право", uz: "Shartnoma huquqi", en: "Contract law" },
  labor: { ru: "Трудовое право", uz: "Mehnat huquqi", en: "Employment law" },
  family: { ru: "Семейное право", uz: "Oila huquqi", en: "Family law" },
  tax: { ru: "Налоговое право", uz: "Soliq huquqi", en: "Tax law" },
  entrepreneurship: { ru: "Предпринимательство", uz: "Tadbirkorlik", en: "Entrepreneurship" },
  corporate: { ru: "Корпоративное право", uz: "Korporativ huquq", en: "Corporate law" },
  administrative: { ru: "Административное право", uz: "Ma’muriy huquq", en: "Administrative law" },
  consumer: { ru: "Защита прав потребителей", uz: "Iste’molchilar huquqlarini himoya qilish", en: "Consumer protection" },
  personal_data_it: { ru: "Персональные данные и IT", uz: "Shaxsiy ma’lumotlar va IT", en: "Personal data and IT" },
  banking_finance: { ru: "Банковское и финансовое регулирование", uz: "Bank va moliyaviy tartibga solish", en: "Banking and financial regulation" },
};

const defaultStatus: MonitoringStatus = {
  integration: "disabled",
  automaticPublication: false,
  controlledBeta: true,
  emailConfigured: false,
  lastCheckedAt: null,
  verifiedSourceCount: 0,
  trustedSourceCount: 0,
  lexIngestionEnabled: false,
  lastRun: null,
  freshness: {
    state: "unavailable",
    latestCheckedAt: null,
    ageDays: null,
    maxAgeDays: 7,
    freshSourceCount: 0,
    trustedSourceCount: 0,
  },
};

export function MonitoringClient({ locale, accountType }: { locale: PlatformLocale; accountType: AccountType }) {
  const t = copy[locale];
  const workspaceId = usePlatformWorkspaceId();
  const [preference, setPreference] = useState<Preference>({
    audience: normalizeMonitoringAudience(accountType),
    topics: ["civil", "contract"],
    channels: ["in_app"],
    frequency: "weekly",
    locale,
    documentImpactConsent: false,
  });
  const [status, setStatus] = useState<MonitoringStatus>(defaultStatus);
  const [updates, setUpdates] = useState<LegislationUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setError("");
    try {
      const response = await fetch(`/api/platform/monitoring?locale=${locale}`, {
        cache: "no-store", headers: { "x-juro-workspace-id": workspaceId },
      });
      const body = await response.json() as {
        preference?: Preference | null;
        updates?: LegislationUpdate[];
        status?: MonitoringStatus;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || t.loadError);
      if (body.preference) {
        setPreference({
          ...body.preference,
          audience: normalizeMonitoringAudience(body.preference.audience),
        });
      }
      setUpdates(body.updates ?? []);
      setStatus(body.status ?? defaultStatus);
    } catch (value) {
      setLoadFailed(true);
      setError(value instanceof Error ? value.message : t.loadError);
    } finally {
      setLoading(false);
    }
  }, [locale, t.loadError, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const selectedTopics = useMemo(() => new Set(preference.topics), [preference.topics]);
  function toggleTopic(topic: Topic) {
    setPreference(current => ({
      ...current,
      topics: current.topics.includes(topic)
        ? current.topics.filter(item => item !== topic)
        : [...current.topics, topic],
    }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!preference.topics.length) {
      setError(t.selectTopicError);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform/monitoring", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-workspace-id": workspaceId },
        body: JSON.stringify({ ...preference, locale }),
      });
      const body = await response.json() as { preference?: Preference; error?: string };
      if (!response.ok) throw new Error(body.error || t.saveError);
      if (body.preference) {
        setPreference({
          ...body.preference,
          audience: normalizeMonitoringAudience(body.preference.audience),
        });
      }
      setNotice(t.saved);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="monitoring-workspace">
      <header>
        <Scale aria-hidden="true" />
        <div><h1>{t.title}</h1><p>{t.intro}</p></div>
      </header>

      {error && <p className="monitoring-message error" role="alert"><CircleAlert aria-hidden="true" />{error}{loadFailed && <button type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />{t.retry}</button>}</p>}
      {notice && <p className="monitoring-message success" role="status"><CheckCircle2 />{notice}</p>}

      {!loading && !loadFailed && <section className="monitoring-status" data-integration={status.integration} aria-label={t.integrationAria}>
        <div className="monitoring-status-copy">
          {status.integration === "active" ? <ShieldCheck aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
          <div>
            <small>{t.controlledBeta}</small>
            <strong>{status.integration === "disabled" ? t.integrationOff : status.integration === "active" ? t.fresh : status.lastRun?.status === "failed" ? t.runFailed : status.freshness.state === "stale" ? t.stale : t.integrationPending}</strong>
            {status.integration === "active" && <p>{t.integrationActive}</p>}
          </div>
        </div>
        <dl>
          <div><dt>{t.lastCheck}</dt><dd>{status.lastCheckedAt ? formatDate(status.lastCheckedAt, locale, true) : t.never}</dd></div>
          <div><dt>{t.sources}</dt><dd>{status.verifiedSourceCount}</dd></div>
          <div><dt>{t.lastRun}</dt><dd>{status.lastRun ? formatDate(status.lastRun.finishedAt ?? status.lastRun.startedAt, locale, true) : t.never}</dd></div>
        </dl>
      </section>}

      <div className="monitoring-layout">
        <form className="monitoring-settings" onSubmit={save}>
          <div className="monitoring-section-heading"><BellRing aria-hidden="true" /><div><h2>{t.preferences}</h2><p>{t.preferencesHint}</p></div></div>
          <p className="monitoring-preference-note">{t.deliveryNote}</p>

          <fieldset>
            <legend>{t.audience}</legend>
            <div className="monitoring-segmented">
              <label className={preference.audience === "individual" ? "selected" : ""}><input type="radio" name="audience" value="individual" checked={preference.audience === "individual"} onChange={() => setPreference(current => ({ ...current, audience: "individual" }))} /><UserRound />{t.individual}</label>
              <label className={preference.audience === "business" ? "selected" : ""}><input type="radio" name="audience" value="business" checked={preference.audience === "business"} onChange={() => setPreference(current => ({ ...current, audience: "business" }))} /><BriefcaseBusiness />{t.business}</label>
            </div>
          </fieldset>

          <fieldset>
            <legend>{t.topics}</legend>
            <div className="monitoring-topics">
              {topicKeys.map(topic => <label key={topic} className={selectedTopics.has(topic) ? "selected" : ""}><input type="checkbox" checked={selectedTopics.has(topic)} onChange={() => toggleTopic(topic)} /><span>{topicLabels[topic][locale]}</span></label>)}
            </div>
          </fieldset>

          <fieldset>
            <legend>{t.frequency}</legend>
            <div className="monitoring-segmented three">
              {(["immediate", "daily", "weekly"] as const).map(frequency => <label key={frequency} className={preference.frequency === frequency ? "selected" : ""}><input type="radio" name="frequency" value={frequency} checked={preference.frequency === frequency} onChange={() => setPreference(current => ({ ...current, frequency }))} /><CalendarClock />{t[frequency]}</label>)}
            </div>
          </fieldset>

          <label className="monitoring-consent"><input type="checkbox" checked={preference.documentImpactConsent} onChange={event => setPreference(current => ({ ...current, documentImpactConsent: event.target.checked }))} /><span><strong>{t.documentConsent}</strong><small>{t.consentHint}</small></span></label>
          <button className="monitoring-save" disabled={saving || loading || loadFailed}>{saving ? <LoaderCircle className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}{t.save}</button>
        </form>

        <section className="monitoring-feed">
          <div className="monitoring-section-heading"><Gavel /><div><h2>{t.feed}</h2><p>{t.coverage}</p></div></div>
          {loading ? <div className="monitoring-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" /><span>{t.loading}</span></div>
            : loadFailed ? null
            : updates.length ? <div className="monitoring-updates">{updates.map(update => <UpdateCard key={update.id} update={update} locale={locale} />)}</div>
              : <div className="monitoring-empty"><Scale /><h3>{t.empty}</h3><p>{t.emptyHint}</p></div>}
        </section>
      </div>
    </section>
  );
}

function UpdateCard({ update, locale }: { update: LegislationUpdate; locale: PlatformLocale }) {
  const t = copy[locale];
  const base = usePlatformBasePath();
  return <article className="monitoring-update">
    <div className="monitoring-update-meta">
      {update.topics.map(topic => <span key={topic}>{topicLabels[topic as Topic]?.[locale] ?? topic}</span>)}
      <time dateTime={update.publishedAt}>{formatDate(update.publishedAt, locale)}</time>
    </div>
    <h3>{update.title}</h3>
    {update.summary && <p>{update.summary}</p>}
    <dl>
      {update.adoptedAt && <div><dt>{t.adopted}</dt><dd>{formatDate(update.adoptedAt, locale)}</dd></div>}
      {update.effectiveAt && <div><dt>{t.effective}</dt><dd>{formatDate(update.effectiveAt, locale)}</dd></div>}
      <div><dt>{t.original}</dt><dd>{update.originalLanguage.toUpperCase()}</dd></div>
    </dl>
    {update.changeSummary && <section><h4>{t.changed}</h4><p>{update.changeSummary}</p></section>}
    {update.recommendedAction && <section><h4>{t.action}</h4><p>{update.recommendedAction}</p></section>}
    <a className="monitoring-source" href={update.officialUrl} target="_blank" rel="noopener noreferrer"><ExternalLink /><span><strong>{t.official}</strong><small>{update.sourceTitle}{update.sourceIdentifier ? ` · ${update.sourceIdentifier}` : ""}</small></span></a>
    <div className="monitoring-update-actions">
      <Link href={`${base}/document-review`}><FileSearch />{t.checkDocuments}</Link>
      <Link href={`${base}/action-plan`}>{t.createTask}</Link>
      <Link href={`${base}/consultations`}>{t.lawyer}</Link>
    </div>
  </article>;
}

function formatDate(value: string, locale: PlatformLocale, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  const dateLocale = locale === "ru" ? "ru-RU" : locale === "uz" ? "uz-UZ" : "en-GB";
  return new Intl.DateTimeFormat(dateLocale, withTime
    ? { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }
    : { dateStyle: "medium", timeZone: "Asia/Tashkent" }).format(date);
}
