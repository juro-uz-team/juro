import { Activity, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import type {
  PublicComponentState,
  PublicStatusSnapshot,
  StatusIncidentState,
  StatusLocale,
} from "../../lib/operations/system-status";

const copy = {
  ru: {
    eyebrow: "Состояние сервисов JURO",
    title: "Статус платформы",
    description: "Публичная сводка зарегистрированных инцидентов и технических работ.",
    active: "Активные инциденты",
    recent: "Недавние инциденты",
    noActive: "Активных инцидентов не зарегистрировано.",
    noRecent: "Завершённых инцидентов пока нет.",
    components: "Компоненты",
    dependencyDetails: "Технические проверки",
    checked: "Проверено",
    age: "Возраст проверки",
    notChecked: "Проверка ещё не выполнялась",
    latency: "Задержка",
    error: "Последний безопасный код ошибки",
    source: "Источник проверки",
    updates: "Обновления",
    lastUpdate: "Последнее обновление реестра",
    generated: "Сводка сформирована",
    language: "Язык страницы",
    operational: "Работает штатно",
    unknown: "Проверка ожидается",
    stale: "Проверка устарела",
    degraded: "Сниженная производительность",
    partial_outage: "Частичная недоступность",
    outage: "Недоступно",
    maintenance: "Технические работы",
    investigating: "Изучаем",
    identified: "Причина определена",
    monitoring: "Наблюдаем",
    resolved: "Устранено",
    disclosure: "Статус отражает зарегистрированные события и не раскрывает внутреннюю инфраструктуру или данные пользователей.",
  },
  uz: {
    eyebrow: "JURO xizmatlari holati",
    title: "Platforma holati",
    description: "Ro‘yxatga olingan hodisalar va texnik ishlarning ochiq xulosasi.",
    active: "Faol hodisalar",
    recent: "So‘nggi hodisalar",
    noActive: "Faol hodisalar ro‘yxatga olinmagan.",
    noRecent: "Yakunlangan hodisalar hozircha yo‘q.",
    components: "Komponentlar",
    dependencyDetails: "Texnik tekshiruvlar",
    checked: "Tekshirildi",
    age: "Tekshiruv yoshi",
    notChecked: "Tekshiruv hali bajarilmagan",
    latency: "Kechikish",
    error: "Oxirgi xavfsiz xato kodi",
    source: "Tekshiruv manbasi",
    updates: "Yangilanishlar",
    lastUpdate: "Reyestrning so‘nggi yangilanishi",
    generated: "Xulosa tuzildi",
    language: "Sahifa tili",
    operational: "Odatdagi tartibda ishlamoqda",
    unknown: "Tekshiruv kutilmoqda",
    stale: "Tekshiruv eskirgan",
    degraded: "Ishlash sifati pasaygan",
    partial_outage: "Qisman ishlamayapti",
    outage: "Ishlamayapti",
    maintenance: "Texnik ishlar",
    investigating: "O‘rganilmoqda",
    identified: "Sabab aniqlandi",
    monitoring: "Kuzatilmoqda",
    resolved: "Bartaraf etildi",
    disclosure: "Holat ro‘yxatga olingan voqealarni aks ettiradi va ichki infratuzilma yoki foydalanuvchi ma’lumotlarini oshkor qilmaydi.",
  },
  en: {
    eyebrow: "JURO service health",
    title: "Platform status",
    description: "A public summary of registered incidents and scheduled maintenance.",
    active: "Active incidents",
    recent: "Recent incidents",
    noActive: "No active incidents have been reported.",
    noRecent: "There are no resolved incidents yet.",
    components: "Components",
    dependencyDetails: "Technical checks",
    checked: "Checked",
    age: "Check age",
    notChecked: "This check has not run yet",
    latency: "Latency",
    error: "Latest public-safe error code",
    source: "Evidence source",
    updates: "Updates",
    lastUpdate: "Last registry update",
    generated: "Status generated",
    language: "Page language",
    operational: "Operational",
    unknown: "Awaiting verification",
    stale: "Verification is stale",
    degraded: "Degraded performance",
    partial_outage: "Partial outage",
    outage: "Outage",
    maintenance: "Scheduled maintenance",
    investigating: "Investigating",
    identified: "Cause identified",
    monitoring: "Monitoring",
    resolved: "Resolved",
    disclosure: "This status page reflects registered events without exposing internal infrastructure or user data.",
  },
} as const;

function date(value: string, locale: StatusLocale): string {
  const intlLocale = locale === "ru" ? "ru-RU" : locale === "uz" ? "uz-Latn-UZ" : "en-GB";
  return new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
}

function duration(value: number, locale: StatusLocale): string {
  if (value < 1_000) return `${value} ms`;
  const intlLocale = locale === "ru" ? "ru-RU" : locale === "uz" ? "uz-Latn-UZ" : "en-GB";
  return `${new Intl.NumberFormat(intlLocale, {
    maximumFractionDigits: 1,
  }).format(value / 1_000)} s`;
}

function StateMark({ state }: { state: PublicComponentState }) {
  if (state === "operational") return <CheckCircle2 aria-hidden="true" />;
  if (state === "maintenance") return <Clock3 aria-hidden="true" />;
  return <Activity aria-hidden="true" />;
}

export function PublicStatusPage({
  locale,
  snapshot,
}: {
  locale: StatusLocale;
  snapshot: PublicStatusSnapshot;
}) {
  const t = copy[locale];
  const statusLabel = (state: PublicComponentState) => t[state];
  const incidentStateLabel = (state: StatusIncidentState) => t[state];
  return (
    <main className="public-status-shell" lang={locale}>
      <header className="public-status-header">
        <a className="public-status-brand" href="https://juro.uz" aria-label="JURO">
          <ShieldCheck aria-hidden="true" />
          <span><b>JURO</b><small>{t.eyebrow}</small></span>
        </a>
        <nav className="public-status-languages" aria-label={t.language}>
          {(["ru", "uz", "en"] as const).map((language) => (
            <a
              className="public-status-language"
              href={`/${language}/status`}
              hrefLang={language}
              aria-current={language === locale ? "page" : undefined}
              key={language}
            >
              {language.toUpperCase()}
            </a>
          ))}
        </nav>
      </header>

      <section className="public-status-intro" aria-labelledby="status-title">
        <p>{t.eyebrow}</p>
        <h1 id="status-title">{t.title}</h1>
        <p>{t.description}</p>
        <div className={`public-status-overall status-${snapshot.overallStatus}`} role="status">
          <StateMark state={snapshot.overallStatus} />
          <span>{statusLabel(snapshot.overallStatus)}</span>
        </div>
      </section>

      <section className="public-status-components" aria-labelledby="components-title">
        <h2 id="components-title">{t.components}</h2>
        <div className="public-status-component-list">
          {snapshot.components.map((component) => (
            <article key={component.key} className="public-status-component">
              <div className="public-status-component-summary">
                <span>{component.label}</span>
                <b className={`status-${component.status}`}><StateMark state={component.status} />{statusLabel(component.status)}</b>
              </div>
              <details className="public-status-dependencies">
                <summary className="juro-disclosure-summary">{t.dependencyDetails}</summary>
                <ul>{component.dependencies.map((dependency) => (
                  <li key={dependency.key}>
                    <div><span>{dependency.label}</span><b className={`status-${dependency.status}`}>{statusLabel(dependency.status)}</b></div>
                    <p>
                      {dependency.checkedAt ? <><span>{t.checked}: </span><time dateTime={dependency.checkedAt}>{date(dependency.checkedAt, locale)}</time></> : t.notChecked}
                      {dependency.checkAgeMs !== null ? <><br /><span>{t.age}: </span>{duration(dependency.checkAgeMs, locale)}</> : null}
                      {dependency.latencyMs !== null ? <><br /><span>{t.latency}: </span>{duration(dependency.latencyMs, locale)}</> : null}
                      {dependency.safeErrorCode ? <><br /><span>{t.error}: </span><code>{dependency.safeErrorCode}</code></> : null}
                      {dependency.evidenceKind ? <><br /><span>{t.source}: </span><code>{dependency.evidenceKind}</code></> : null}
                    </p>
                  </li>
                ))}</ul>
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className="public-status-incidents" aria-labelledby="active-incidents-title">
        <h2 id="active-incidents-title">{t.active}</h2>
        {snapshot.activeIncidents.length === 0 ? (
          <p className="public-status-empty">{t.noActive}</p>
        ) : snapshot.activeIncidents.map((incident) => (
          <article className="public-status-incident" key={incident.reference}>
            <header>
              <div>
                <span>{incident.reference}</span>
                <h3>{incident.title}</h3>
              </div>
              <b className={`status-${incident.severity}`}>{incidentStateLabel(incident.state)}</b>
            </header>
            <p>{incident.summary}</p>
            <ul className="public-status-tags" aria-label={t.components}>
              {incident.components.map((component) => <li key={component.key}>{component.label}</li>)}
            </ul>
            <div className="public-status-timeline">
              <h4>{t.updates}</h4>
              {incident.updates.map((update) => (
                <div key={`${update.createdAt}-${update.state}`}>
                  <time dateTime={update.createdAt}>{date(update.createdAt, locale)}</time>
                  <b>{incidentStateLabel(update.state)}</b>
                  <p>{update.message}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="public-status-incidents" aria-labelledby="recent-incidents-title">
        <h2 id="recent-incidents-title">{t.recent}</h2>
        {snapshot.recentIncidents.length === 0 ? (
          <p className="public-status-empty">{t.noRecent}</p>
        ) : snapshot.recentIncidents.map((incident) => (
          <article className="public-status-incident resolved" key={incident.reference}>
            <header>
              <div><span>{incident.reference}</span><h3>{incident.title}</h3></div>
              <b className="status-operational">{t.resolved}</b>
            </header>
            <p>{incident.summary}</p>
            {incident.resolvedAt ? <time dateTime={incident.resolvedAt}>{date(incident.resolvedAt, locale)}</time> : null}
          </article>
        ))}
      </section>

      <footer className="public-status-footer">
        <p>{t.disclosure}</p>
        <p>
          {t.lastUpdate}: {snapshot.lastIncidentUpdateAt ? date(snapshot.lastIncidentUpdateAt, locale) : "—"}<br />
          {t.generated}: <time dateTime={snapshot.generatedAt}>{date(snapshot.generatedAt, locale)}</time>
        </p>
      </footer>
    </main>
  );
}
