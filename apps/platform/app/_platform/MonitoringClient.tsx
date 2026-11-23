"use client";

import { usePlatformBasePath, usePlatformWorkspaceId } from "./PlatformRouteContext";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated monitoring preferences are hydrated after the first browser render */

import {
  BellRing,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FileSearch,
  Library,
  LoaderCircle,
  RefreshCw,
  Save,
  Scale,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";
import {
  normalizeMonitoringAudience,
  type MonitoringAudience,
} from "../../lib/platform/monitoring-preferences";
import { CorpusBrowser, CorpusText, monitoringLabels } from "./MonitoringCorpus";

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
  lastCheckedAt: string | null;
  lastCorpusCheckedAt?: string | null;
  lastRun: { status: string } | null;
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
  changeType: string;
  corpusWork?: string | null;
};

const copy = {
  ru: {
    title: "Мониторинг законодательства",
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
    empty: "Обнаруженных изменений Lex.uz пока нет",
    lastCheck: "Последняя проверка источников",
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
    empty: "Lex.uz’da aniqlangan o‘zgarishlar hozircha yo‘q",
    lastCheck: "Manbalar oxirgi tekshirilgan vaqt",
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
    empty: "No Lex.uz changes have been detected yet",
    lastCheck: "Last source check",
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
  lastCheckedAt: null,
  lastRun: null,
};

export function MonitoringClient({ locale, accountType }: { locale: PlatformLocale; accountType: AccountType }) {
  const t = copy[locale];
  const labels = monitoringLabels[locale];
  const updateType = (type: string) => type === "edition" ? labels.edition
    : type === "metadata_changed" ? labels.correction : labels.newAct;
  const updateDate = (update: LegislationUpdate) => update.sourceRevisionDate
    ? formatDate(update.sourceRevisionDate, locale)
    : formatDate(update.publishedAt, locale);
  const workspaceId = usePlatformWorkspaceId();
  const settings = useRef<HTMLDialogElement>(null);
  const updateReader = useRef<HTMLHeadingElement>(null);
  const activeRow = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"updates" | "corpus">("updates");
  const [selected, setSelected] = useState<LegislationUpdate | null>(null);
  const [query, setQuery] = useState("");
  const [changeType, setChangeType] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [preference, setPreference] = useState<Preference>({
    audience: normalizeMonitoringAudience(accountType),
    topics: ["civil", "contract"],
    channels: ["in_app"],
    frequency: "weekly",
    locale,
    documentImpactConsent: false,
  });
  const [status, setStatus] = useState<MonitoringStatus>(defaultStatus);
  const lastCheck = status.lastCorpusCheckedAt ?? status.lastCheckedAt;
  const [updates, setUpdates] = useState<LegislationUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadFailed(false);
    setError("");
    try {
      const params = new URLSearchParams({ locale, q: query, changeType, page: String(page) });
      const response = await fetch(`/api/platform/monitoring?${params}`, {
        cache: "no-store", signal, headers: { "x-juro-workspace-id": workspaceId },
      });
      const body = await response.json() as {
        preference?: Preference | null;
        updates?: LegislationUpdate[];
        status?: MonitoringStatus;
        hasMore?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || t.loadError);
      if (signal?.aborted) return;
      if (body.preference) {
        setPreference({
          ...body.preference,
          audience: normalizeMonitoringAudience(body.preference.audience),
        });
      }
      setUpdates(body.updates ?? []);
      setHasMore(body.hasMore ?? false);
      setStatus(body.status ?? defaultStatus);
    } catch (value) {
      if (signal?.aborted) return;
      setLoadFailed(true);
      setError(value instanceof Error ? value.message : t.loadError);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [changeType, locale, page, query, t.loadError, workspaceId]);

  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, retry]);
  useEffect(() => { if (selected) updateReader.current?.focus({ preventScroll: true }); }, [selected]);

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
      settings.current?.close();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="monitoring-workspace">
      <header className="monitoring-masthead">
        <div className="monitoring-mark"><Scale aria-hidden="true" /></div>
        <div><h1>{t.title}</h1><p>{labels.subtitle}</p></div>
        <button className="monitoring-button monitoring-preferences-trigger" type="button" onClick={() => settings.current?.showModal()}>
          <BellRing aria-hidden="true" /><span>{labels.settings}</span>
        </button>
      </header>

      {error && loadFailed && <p className="monitoring-message error" role="alert"><CircleAlert aria-hidden="true" />{error}<button type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw aria-hidden="true" />{t.retry}</button></p>}
      {notice && <p className="monitoring-message success" role="status"><CheckCircle2 />{notice}</p>}

      <div className="monitoring-shell">
        <nav className="monitoring-nav" aria-label={t.title}>
          <button type="button" aria-pressed={mode === "updates"} onClick={() => setMode("updates")}><CalendarClock aria-hidden="true" />{labels.updates}</button>
          <button type="button" aria-pressed={mode === "corpus"} onClick={() => setMode("corpus")}><Library aria-hidden="true" />{labels.corpus}</button>
          {lastCheck && <small><ShieldCheck aria-hidden="true" />
            {status.lastCorpusCheckedAt ? labels.catalogueCheck : t.lastCheck} · {formatDate(lastCheck, locale, true)}</small>}
        </nav>
        <dialog className="monitoring-dialog" aria-labelledby="monitoring-preferences-heading" ref={settings}>
        <form className="monitoring-settings" onSubmit={save}>
          <div className="monitoring-section-heading"><div><h2 id="monitoring-preferences-heading">{t.preferences}</h2><p>{t.preferencesHint}</p></div><button className="monitoring-button" type="button" onClick={() => settings.current?.close()}>{labels.close}</button></div>
          {error && !loadFailed && <p role="alert" className="monitoring-message error">{error}</p>}
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
        </dialog>
        <div hidden={mode !== "updates"}>
          <div className="monitoring-split" data-reading={Boolean(selected)}>
            <section className="monitoring-list" aria-label={labels.updates}>
              <form className="monitoring-filter" onSubmit={event => {
                event.preventDefault();
                setQuery(String(new FormData(event.currentTarget).get("search") ?? ""));
                setSelected(null);
                setPage(0);
              }}>
                <label><span>{labels.search}</span><input name="search" type="search" maxLength={120} placeholder={labels.updatePlaceholder} /></label>
                <label><span>{labels.change}</span><select value={changeType} onChange={event => {
                  setChangeType(event.target.value);
                  setSelected(null);
                  setPage(0);
                }}><option value="">{labels.all}</option><option value="new_act">{labels.newAct}</option><option value="edition">{labels.edition}</option><option value="metadata_changed">{labels.correction}</option></select></label>
                <button className="monitoring-button" type="submit">{labels.search}</button>
              </form>
              {!loading && !loadFailed && !status.lastCorpusCheckedAt && status.integration !== "active" && <p className="monitoring-feed-note">
                {status.integration === "disabled" ? t.integrationOff : status.lastRun?.status === "failed" ? t.runFailed : t.integrationPending}
              </p>}
              {loading ? <p className="monitoring-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" />{t.loading}</p>
                : loadFailed ? null
                : updates.length ? <div>{updates.map((update, index) => {
                  const date = updateDate(update);
                  return <div key={update.id}>
                    {(index === 0 || date !== updateDate(updates[index - 1])) && <h2 className="monitoring-date">{date}</h2>}
                    <button type="button" className="monitoring-result" aria-pressed={selected?.id === update.id} onClick={event => {
                      activeRow.current = event.currentTarget;
                      setSelected(update);
                    }}>
                      <span><small>{updateType(update.changeType)}</small><strong>{update.title}</strong></span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                  </div>;
                })}</div>
                  : <p className="monitoring-empty">{query || changeType ? labels.noResults : t.empty}</p>}
              <div className="monitoring-pagination">
                {page > 0 && <button type="button" className="monitoring-button" onClick={() => { setSelected(null); setPage(page - 1); }}>{labels.previous}</button>}
                {hasMore && <button type="button" className="monitoring-button" onClick={() => { setSelected(null); setPage(page + 1); }}>{labels.next}</button>}
              </div>
            </section>
            {selected ? <section className="monitoring-reader" aria-label={selected.title}>
              <button type="button" className="monitoring-button" onClick={() => {
                setSelected(null);
                requestAnimationFrame(() => activeRow.current?.focus());
              }}>{labels.back}</button>
              <UpdateCard update={selected} locale={locale} workspaceId={workspaceId} headingRef={updateReader} />
            </section> : <div className="monitoring-reader-placeholder"><Scale aria-hidden="true" /><p>{labels.pickUpdate}</p></div>}
          </div>
        </div>
        {mode === "corpus" && <CorpusBrowser locale={locale} workspaceId={workspaceId} />}
      </div>
    </section>
  );
}

function UpdateCard({ update, locale, workspaceId, headingRef }: {
  update: LegislationUpdate; locale: PlatformLocale; workspaceId: string; headingRef: React.Ref<HTMLHeadingElement>;
}) {
  const t = copy[locale];
  const labels = monitoringLabels[locale];
  const base = usePlatformBasePath();
  return <article className="monitoring-update">
    <div className="monitoring-update-meta">
      {update.topics.map(topic => <span key={topic}>{topicLabels[topic as Topic]?.[locale] ?? topic}</span>)}
      <time dateTime={update.publishedAt}>{formatDate(update.publishedAt, locale)}</time>
    </div>
    <h2 ref={headingRef} tabIndex={-1}>{update.title}</h2>
    {update.summary && <p>{update.summary}</p>}
    <dl>
      {update.adoptedAt && <div><dt>{t.adopted}</dt><dd>{formatDate(update.adoptedAt, locale)}</dd></div>}
      {update.effectiveAt && <div><dt>{t.effective}</dt><dd>{formatDate(update.effectiveAt, locale)}</dd></div>}
      {update.sourceRevisionDate && <div><dt>{labels.edition}</dt><dd>{formatDate(update.sourceRevisionDate, locale)}</dd></div>}
      <div><dt>{labels.observed}</dt><dd>{formatDate(update.publishedAt, locale, true)}</dd></div>
      <div><dt>{t.original}</dt><dd>{update.originalLanguage.toUpperCase()}</dd></div>
    </dl>
    {update.changeSummary && <section><h4>{t.changed}</h4><p>{update.changeSummary}</p></section>}
    {update.recommendedAction && <section><h4>{t.action}</h4><p>{update.recommendedAction}</p></section>}
    <a className="monitoring-source" href={update.officialUrl} target="_blank" rel="noopener noreferrer"><ExternalLink /><span><strong>{t.official}</strong><small>{update.sourceTitle}{update.sourceIdentifier ? ` · ${update.sourceIdentifier}` : ""}</small></span></a>
    {update.corpusWork && <CorpusText key={update.corpusWork} entry={{ url: update.officialUrl, work: update.corpusWork }}
      locale={locale} workspaceId={workspaceId} fromUpdate />}
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
