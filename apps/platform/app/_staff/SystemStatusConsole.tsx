"use client";

import { Select } from "../_components/Select";

import { Activity, CircleCheckBig, Plus, RefreshCw, Send, ServerCog, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import type {
  StatusComponentKey,
  StatusImpact,
  StatusIncidentAdminDashboard,
  StatusIncidentState,
  StatusLocale,
} from "../../lib/operations/system-status";
import type {
  DependencyHealthEvidenceKind,
  DependencyHealthKey,
  DependencyHealthSnapshot,
  DependencyHealthState,
} from "../../lib/operations/dependency-health";

const componentKeys: StatusComponentKey[] = [
  "platform", "otp", "ai", "document_analysis", "upload", "document_builder", "email", "lawyer_area",
];
const componentLabels = {
  ru: { platform: "Платформа", otp: "Вход и OTP", ai: "AI-юрист", document_analysis: "Анализ документов", upload: "Загрузка файлов", document_builder: "Конструктор документов", email: "Email", lawyer_area: "Работа с юристами" },
  uz: { platform: "Platforma", otp: "Kirish va OTP", ai: "AI-yurist", document_analysis: "Hujjatlar tahlili", upload: "Fayllarni yuklash", document_builder: "Hujjat konstruktori", email: "Email", lawyer_area: "Yuristlar bilan ishlash" },
  en: { platform: "Platform", otp: "Sign-in and OTP", ai: "AI legal assistant", document_analysis: "Document analysis", upload: "File uploads", document_builder: "Document builder", email: "Email", lawyer_area: "Lawyer services" },
} as const;
const copy = {
  ru: { title: "Статус и инциденты", eyebrow: "Операционный центр", secure: "Защищённая рабочая зона", fresh: "Недавняя 2FA", refresh: "Обновить", create: "Создать инцидент", titleRu: "Заголовок на русском", titleUz: "Заголовок на узбекском", titleEn: "Заголовок на английском", summaryRu: "Публичное описание на русском", summaryUz: "Публичное описание на узбекском", summaryEn: "Публичное описание на английском", messageRu: "Первое обновление на русском", messageUz: "Первое обновление на узбекском", messageEn: "Первое обновление на английском", startedAt: "Начало события", impact: "Влияние", components: "Затронутые компоненты", submit: "Опубликовать инцидент", active: "Активные", resolved: "Завершённые", empty: "Инцидентов нет", update: "Добавить обновление", state: "Следующий статус", send: "Опубликовать обновление", investigating: "Изучаем", identified: "Причина определена", monitoring: "Наблюдаем", resolvedState: "Устранено", degraded: "Сниженная производительность", partial_outage: "Частичная недоступность", outage: "Недоступно", maintenance: "Технические работы", saved: "Изменение сохранено", publicLink: "Открыть публичный статус", legacyIncident: "Для старого инцидента нет русской локализации" },
  uz: { title: "Holat va hodisalar", eyebrow: "Operatsion markaz", secure: "Himoyalangan ish maydoni", fresh: "Yaqindagi 2FA", refresh: "Yangilash", create: "Hodisa yaratish", titleRu: "Ruscha sarlavha", titleUz: "O‘zbekcha sarlavha", titleEn: "Inglizcha sarlavha", summaryRu: "Ruscha ochiq tavsif", summaryUz: "O‘zbekcha ochiq tavsif", summaryEn: "Inglizcha ochiq tavsif", messageRu: "Ruscha birinchi yangilanish", messageUz: "O‘zbekcha birinchi yangilanish", messageEn: "Inglizcha birinchi yangilanish", startedAt: "Hodisa boshlangan vaqt", impact: "Ta’sir", components: "Ta’sirlangan komponentlar", submit: "Hodisani e’lon qilish", active: "Faol", resolved: "Yakunlangan", empty: "Hodisalar yo‘q", update: "Yangilanish qo‘shish", state: "Keyingi holat", send: "Yangilanishni e’lon qilish", investigating: "O‘rganilmoqda", identified: "Sabab aniqlandi", monitoring: "Kuzatilmoqda", resolvedState: "Bartaraf etildi", degraded: "Ishlash sifati pasaygan", partial_outage: "Qisman ishlamayapti", outage: "Ishlamayapti", maintenance: "Texnik ishlar", saved: "O‘zgarish saqlandi", publicLink: "Ochiq holatni ko‘rish", legacyIncident: "Eski hodisa uchun o‘zbekcha matn mavjud emas" },
  en: { title: "Status and incidents", eyebrow: "Operations centre", secure: "Secure workspace", fresh: "Recent 2FA", refresh: "Refresh", create: "Create incident", titleRu: "Russian title", titleUz: "Uzbek title", titleEn: "English title", summaryRu: "Public description in Russian", summaryUz: "Public description in Uzbek", summaryEn: "Public description in English", messageRu: "First update in Russian", messageUz: "First update in Uzbek", messageEn: "First update in English", startedAt: "Incident start", impact: "Impact", components: "Affected components", submit: "Publish incident", active: "Active", resolved: "Resolved", empty: "No incidents", update: "Add update", state: "Next status", send: "Publish update", investigating: "Investigating", identified: "Cause identified", monitoring: "Monitoring", resolvedState: "Resolved", degraded: "Degraded performance", partial_outage: "Partial outage", outage: "Outage", maintenance: "Scheduled maintenance", saved: "Change saved", publicLink: "Open public status", legacyIncident: "English title unavailable for this legacy incident" },
} as const;

const dependencyLabels: Readonly<Record<DependencyHealthKey, Record<StatusLocale, string>>> = {
  d1: { ru: "Основная база данных", uz: "Asosiy ma’lumotlar bazasi", en: "Primary database" },
  private_r2: { ru: "Защищённое файловое хранилище", uz: "Himoyalangan fayl ombori", en: "Secure file storage" },
  queues: { ru: "Фоновые очереди", uz: "Fon navbatlari", en: "Background queues" },
  queue_dlq: { ru: "Очередь ошибок", uz: "Xatolar navbati", en: "Failed jobs queue" },
  malware_scanner: { ru: "Проверка файлов", uz: "Fayllarni tekshirish", en: "File security scanning" },
  openai: { ru: "OpenAI", uz: "OpenAI", en: "OpenAI" },
  anthropic: { ru: "Anthropic", uz: "Anthropic", en: "Anthropic" },
  resend: { ru: "Email-доставка", uz: "Email yetkazib berish", en: "Email delivery" },
  legal_source_sync: { ru: "Синхронизация правовых источников", uz: "Huquqiy manbalarni sinxronlash", en: "Legal source synchronisation" },
  document_analysis: { ru: "Анализ документов", uz: "Hujjatlarni tahlil qilish", en: "Document analysis" },
  document_builder: { ru: "Генерация документов", uz: "Hujjatlarni yaratish", en: "Document generation" },
  lawyer_area: { ru: "Рабочая зона юристов", uz: "Yuristlar ish maydoni", en: "Lawyer workspace" },
};

const dependencyStateLabels: Readonly<Record<DependencyHealthState, Record<StatusLocale, string>>> = {
  operational: { ru: "Работает", uz: "Ishlamoqda", en: "Operational" },
  degraded: { ru: "Есть ограничение", uz: "Cheklov mavjud", en: "Degraded" },
  partial_outage: { ru: "Частично недоступно", uz: "Qisman ishlamayapti", en: "Partial outage" },
  outage: { ru: "Недоступно", uz: "Ishlamayapti", en: "Outage" },
  maintenance: { ru: "Технические работы", uz: "Texnik ishlar", en: "Maintenance" },
  unknown: { ru: "Не проверено", uz: "Tekshirilmagan", en: "Unverified" },
  stale: { ru: "Проверка устарела", uz: "Tekshiruv eskirgan", en: "Stale verification" },
};

const evidenceLabels: Readonly<Record<DependencyHealthEvidenceKind, Record<StatusLocale, string>>> = {
  probe: { ru: "техническая проверка", uz: "texnik tekshiruv", en: "technical probe" },
  synthetic_probe: { ru: "синтетическая проверка", uz: "sintetik tekshiruv", en: "synthetic probe" },
  scheduled_job: { ru: "плановая задача", uz: "rejalashtirilgan vazifa", en: "scheduled job" },
  manual_verification: { ru: "ручная проверка", uz: "qo‘lda tekshiruv", en: "manual verification" },
  integration_event: { ru: "подтверждённая операция", uz: "tasdiqlangan amal", en: "verified operation" },
};

const healthCopy = {
  ru: { title: "Автоматические проверки", intro: "Содержит только технические коды без текстов запросов, ответов, ключей и идентификаторов клиентов.", updated: "Снимок", working: "Работают", attention: "Требуют внимания", unverified: "Нет свежего подтверждения", checked: "Проверено", lastSuccess: "Последний успех", latency: "Задержка", evidence: "Основание", action: "Что сделать", noAction: "Действий не требуется. Следующая проверка подтвердит состояние автоматически.", never: "нет данных", lessMinute: "меньше минуты назад" },
  uz: { title: "Avtomatik tekshiruvlar", intro: "Faqat texnik kodlar ko‘rsatiladi; so‘rovlar, javoblar, kalitlar va mijoz identifikatorlari saqlanmaydi.", updated: "Holat vaqti", working: "Ishlamoqda", attention: "E’tibor talab qiladi", unverified: "Yangi tasdiq yo‘q", checked: "Tekshirildi", lastSuccess: "Oxirgi muvaffaqiyat", latency: "Kechikish", evidence: "Asos", action: "Nima qilish kerak", noAction: "Amal talab qilinmaydi. Keyingi tekshiruv holatni avtomatik tasdiqlaydi.", never: "ma’lumot yo‘q", lessMinute: "bir daqiqadan kam oldin" },
  en: { title: "Automated checks", intro: "Only technical codes are shown; request text, responses, keys and customer identifiers are never included.", updated: "Snapshot", working: "Operational", attention: "Needs attention", unverified: "No fresh verification", checked: "Checked", lastSuccess: "Last success", latency: "Latency", evidence: "Evidence", action: "Recommended action", noAction: "No action is required. The next automated check will verify this service again.", never: "no data", lessMinute: "less than a minute ago" },
} as const;

type Dashboard = StatusIncidentAdminDashboard;

const dependencyStateRank: Readonly<Record<DependencyHealthState, number>> = {
  outage: 0,
  partial_outage: 1,
  degraded: 2,
  maintenance: 3,
  unknown: 4,
  stale: 5,
  operational: 6,
};

function formatDate(locale: StatusLocale, value: string | null, fallback: string): string {
  if (!value) return fallback;
  const intlLocale = locale === "ru" ? "ru-RU" : locale === "uz" ? "uz-UZ" : "en-GB";
  return new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
}

function formatAge(locale: StatusLocale, ageMs: number | null, fallback: string, lessMinute: string): string {
  if (ageMs === null) return fallback;
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return lessMinute;
  if (minutes < 60) return localize(locale, `${minutes} мин назад`, `${minutes} daqiqa oldin`, `${minutes} min ago`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return localize(locale, `${hours} ч назад`, `${hours} soat oldin`, `${hours} hr ago`);
  const days = Math.floor(hours / 24);
  return localize(locale, `${days} дн назад`, `${days} kun oldin`, `${days} d ago`);
}

function localize(locale: StatusLocale, ru: string, uz: string, en: string): string {
  return locale === "ru" ? ru : locale === "uz" ? uz : en;
}

function remediation(locale: StatusLocale, dependency: DependencyHealthSnapshot): string {
  switch (dependency.safeErrorCode) {
    case "PROVIDER_CREDIT_BALANCE_LOW":
      return localize(locale, "Пополните баланс организации, которой принадлежит активный API-ключ, или подключите ключ оплаченной организации. Затем дождитесь следующей проверки.", "Faol API kaliti tegishli tashkilot balansini to‘ldiring yoki to‘langan tashkilot kalitini ulang. So‘ng keyingi tekshiruvni kuting.", "Top up the organisation that owns the active API key, or connect a key from a funded organisation. Then wait for the next check.");
    case "PROVIDER_SPEND_LIMIT_REACHED":
      return localize(locale, "Проверьте лимит расходов организации и рабочей области провайдера. После изменения лимита дождитесь следующей проверки.", "Provayder tashkiloti va ish maydoni xarajat limitini tekshiring. Limit o‘zgargach, keyingi tekshiruvni kuting.", "Review the provider organisation and workspace spend limits. After changing them, wait for the next check.");
    case "PROVIDER_BILLING_CONFIGURATION":
      return localize(locale, "Проверьте платёжный профиль и доступность биллинга в организации провайдера, связанной с активным ключом.", "Faol kalit bog‘langan provayder tashkilotining to‘lov profili va billing holatini tekshiring.", "Review the billing profile and billing availability for the provider organisation linked to the active key.");
    case "PROVIDER_WORKSPACE_CONFIGURATION":
      return localize(locale, "Сверьте рабочую область, права ключа и политику организации провайдера. Секреты на этом экране не показываются.", "Provayder ish maydoni, kalit huquqlari va tashkilot siyosatini tekshiring. Bu ekranda sirlar ko‘rsatilmaydi.", "Review the provider workspace, key permissions and organisation policy. Secrets are never shown on this screen.");
    case "PROVIDER_REQUEST_CONFIGURATION":
      return localize(locale, "Проверьте разрешённую модель и технические параметры синтетической проверки перед следующим запуском.", "Keyingi ishga tushirishdan oldin ruxsat etilgan model va sintetik tekshiruv parametrlarini tekshiring.", "Review the allowed model and technical parameters of the synthetic probe before its next run.");
    case "PROBE_AUTH_ERROR":
      return localize(locale, "Проверьте срок действия и права активного ключа в защищённом хранилище, не копируя его в интерфейс или журнал.", "Faol kalitning amal qilish muddati va huquqlarini himoyalangan saqlash joyida tekshiring; uni interfeys yoki jurnalga ko‘chirmang.", "Review the active key expiry and permissions in secure storage without copying it into the interface or logs.");
    case "PROBE_CONFIGURATION_ERROR":
      return localize(locale, "Проверьте обязательные настройки и привязки окружения, затем повторите безопасную проверку.", "Majburiy sozlamalar va muhit bog‘lanishlarini tekshiring, so‘ng xavfsiz tekshiruvni takrorlang.", "Review required configuration and environment bindings, then repeat the safe check.");
    case "PROVIDER_TIMEOUT":
    case "PROBE_TIMEOUT":
      return localize(locale, "Проверьте задержку провайдера и сеть. Если следующий замер не восстановится, создайте публичный инцидент.", "Provayder kechikishi va tarmoqni tekshiring. Keyingi o‘lchov tiklanmasa, ochiq hodisa yarating.", "Review provider latency and network health. If the next check does not recover, create a public incident.");
    case "PROBE_LATENCY_HIGH":
      return localize(locale, "Зависимость доступна, но отдельная проверка превысила допустимую задержку. Сверьте следующий замер и создайте инцидент при повторении.", "Bog‘liqlik mavjud, ammo alohida tekshiruv ruxsat etilgan kechikishdan oshdi. Keyingi o‘lchovni tekshiring va takrorlansa hodisa yarating.", "The dependency is available, but one probe exceeded the latency threshold. Review the next result and create an incident if it recurs.");
    default:
      return dependency.state === "operational"
        ? healthCopy[locale].noAction
        : localize(locale, "Изучите связанный технический сервис. Если влияние подтверждено, создайте или обновите публичный инцидент.", "Bog‘liq texnik xizmatni tekshiring. Ta’sir tasdiqlansa, ochiq hodisa yarating yoki yangilang.", "Review the related technical service. If user impact is confirmed, create or update a public incident.");
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(body.code ?? `HTTP_${response.status}`);
  return body;
}

function localInputNow(): string {
  const value = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return value.toISOString().slice(0, 16);
}

function nextStates(state: StatusIncidentState): Array<Exclude<StatusIncidentState, "investigating">> {
  if (state === "investigating") return ["identified", "monitoring", "resolved"];
  if (state === "identified") return ["monitoring", "resolved"];
  if (state === "monitoring") return ["resolved"];
  return [];
}

export function SystemStatusConsole({ locale, staffName, initial }: { locale: StatusLocale; staffName: string; initial: Dashboard }) {
  const t = copy[locale];
  const [dashboard, setDashboard] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedComponents, setSelectedComponents] = useState<StatusComponentKey[]>(["platform"]);
  const [impact, setImpact] = useState<StatusImpact>("degraded");
  const [selectedIncident, setSelectedIncident] = useState<string>("");
  const [nextState, setNextState] = useState<Exclude<StatusIncidentState, "investigating">>("identified");

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setDashboard(await readJson<Dashboard>(await fetch("/api/platform/admin/system-status", { cache: "no-store" })));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "STATUS_LOAD_FAILED");
    } finally { setBusy(false); }
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedComponents.length) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const startedAtMs = Date.parse(String(form.get("startedAt")));
    if (!Number.isFinite(startedAtMs)) {
      setError("SYSTEM_STATUS_INVALID");
      return;
    }
    const startedAt = new Date(startedAtMs).toISOString();
    setBusy(true);
    try {
      await readJson(await fetch("/api/platform/admin/system-status", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ action: "create", value: {
          titleRu: form.get("titleRu"), titleUz: form.get("titleUz"), titleEn: form.get("titleEn"),
          summaryRu: form.get("summaryRu"), summaryUz: form.get("summaryUz"), summaryEn: form.get("summaryEn"),
          messageRu: form.get("messageRu"), messageUz: form.get("messageUz"), messageEn: form.get("messageEn"), startedAt,
          components: selectedComponents.map((key) => ({ key, impact })),
        } }),
      }));
      formElement.reset();
      setSelectedComponents(["platform"]);
      setNotice(t.saved);
      setError("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "STATUS_CREATE_FAILED");
    } finally { setBusy(false); }
  }

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!selectedIncident) return;
    setBusy(true);
    try {
      await readJson(await fetch("/api/platform/admin/system-status", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ action: "update", value: {
          incidentId: selectedIncident, state: nextState,
          messageRu: form.get("updateMessageRu"), messageUz: form.get("updateMessageUz"), messageEn: form.get("updateMessageEn"),
        } }),
      }));
      formElement.reset();
      setSelectedIncident("");
      setNotice(t.saved);
      setError("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "STATUS_UPDATE_FAILED");
    } finally { setBusy(false); }
  }

  const active = dashboard.incidents.filter((incident) => incident.state !== "resolved");
  const resolved = dashboard.incidents.filter((incident) => incident.state === "resolved");
  const selected = active.find((incident) => incident.id === selectedIncident);
  const allowedNext = selected ? nextStates(selected.state) : [];
  const stateLabel = (state: StatusIncidentState) => state === "resolved" ? t.resolvedState : t[state];
  const incidentTitle = (incident: Dashboard["incidents"][number]) => locale === "ru"
    ? incident.titleRu
    : locale === "uz"
      ? incident.titleUz
      : incident.titleEn ?? t.legacyIncident;
  const h = healthCopy[locale];
  const workingCount = dashboard.dependencies.filter((dependency) => dependency.state === "operational").length;
  const unverifiedCount = dashboard.dependencies.filter((dependency) => dependency.state === "unknown" || dependency.state === "stale").length;
  const attentionCount = dashboard.dependencies.length - workingCount - unverifiedCount;
  const sortedDependencies = [...dashboard.dependencies].sort((left, right) =>
    dependencyStateRank[left.state] - dependencyStateRank[right.state]
    || left.key.localeCompare(right.key));

  return <div className="staff-console" aria-busy={busy}>
    <header className="staff-topbar"><div className="staff-brand"><ShieldCheck aria-hidden="true"/><span><b>JURO</b><small>{t.secure}</small></span></div><div className="staff-session"><span>{t.fresh}</span><b>{staffName}</b></div></header>
    <main className="staff-main status-admin-main">
      <section className="staff-heading"><div><p>{t.eyebrow}</p><h1>{t.title}</h1></div><div className="status-admin-heading-actions"><a href={`/${locale}/status`} target="_blank" rel="noreferrer">{t.publicLink}</a><button type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw aria-hidden="true"/>{t.refresh}</button></div></section>
      <p className="sr-only" aria-live="polite">{notice}</p>{error ? <p className="staff-error" role="alert">{error}</p> : null}
      <section className="status-dependency-health" aria-labelledby="status-dependency-health-title" aria-live="polite">
        <header><div><span><ServerCog aria-hidden="true"/>{h.title}</span><h2 id="status-dependency-health-title">{h.title}</h2><p>{h.intro}</p></div><time dateTime={dashboard.generatedAt}>{h.updated}: {formatDate(locale, dashboard.generatedAt, h.never)}</time></header>
        <div className="status-dependency-summary">
          <article className="is-operational"><CircleCheckBig aria-hidden="true"/><span>{h.working}</span><b>{workingCount}</b></article>
          <article className="needs-attention"><TriangleAlert aria-hidden="true"/><span>{h.attention}</span><b>{attentionCount}</b></article>
          <article className="is-unverified"><RefreshCw aria-hidden="true"/><span>{h.unverified}</span><b>{unverifiedCount}</b></article>
        </div>
        <div className="status-dependency-list">
          {sortedDependencies.map((dependency) => <article className={`dependency-state-${dependency.state}`} key={dependency.key}>
            <header><div><b>{dependencyLabels[dependency.key][locale]}</b><code>{dependency.key}</code></div><span>{dependencyStateLabels[dependency.state][locale]}</span></header>
            <dl>
              <div><dt>{h.checked}</dt><dd><time dateTime={dependency.checkedAt ?? undefined}>{formatDate(locale, dependency.checkedAt, h.never)}</time><small>{formatAge(locale, dependency.checkAgeMs, h.never, h.lessMinute)}</small></dd></div>
              <div><dt>{h.lastSuccess}</dt><dd>{formatDate(locale, dependency.lastSuccessfulAt, h.never)}</dd></div>
              <div><dt>{h.latency}</dt><dd>{dependency.latencyMs === null ? "—" : `${dependency.latencyMs} ms`}</dd></div>
              <div><dt>{h.evidence}</dt><dd>{dependency.evidenceKind ? evidenceLabels[dependency.evidenceKind][locale] : h.never}</dd></div>
            </dl>
            <div className="status-dependency-action"><span>{h.action}</span>{dependency.safeErrorCode ? <code>{dependency.safeErrorCode}</code> : null}<p>{remediation(locale, dependency)}</p></div>
          </article>)}
        </div>
      </section>
      <div className="status-admin-grid">
        <form className="staff-decision status-admin-form" onSubmit={(event) => void create(event)}>
          <h2><Plus aria-hidden="true"/>{t.create}</h2>
          <label>{t.titleRu}<input name="titleRu" required minLength={3} maxLength={140}/></label>
          <label>{t.titleUz}<input name="titleUz" required minLength={3} maxLength={140}/></label>
          <label>{t.titleEn}<input name="titleEn" required minLength={3} maxLength={140}/></label>
          <label>{t.summaryRu}<textarea name="summaryRu" required minLength={10} maxLength={2000}/></label>
          <label>{t.summaryUz}<textarea name="summaryUz" required minLength={10} maxLength={2000}/></label>
          <label>{t.summaryEn}<textarea name="summaryEn" required minLength={10} maxLength={2000}/></label>
          <label>{t.messageRu}<textarea name="messageRu" required minLength={10} maxLength={2000}/></label>
          <label>{t.messageUz}<textarea name="messageUz" required minLength={10} maxLength={2000}/></label>
          <label>{t.messageEn}<textarea name="messageEn" required minLength={10} maxLength={2000}/></label>
          <label>{t.startedAt}<input name="startedAt" type="datetime-local" defaultValue={localInputNow()} required/></label>
          <label>{t.impact}<Select value={impact} onChange={(event) => setImpact(event.target.value as StatusImpact)}>{(["degraded", "partial_outage", "outage", "maintenance"] as StatusImpact[]).map((value) => <option key={value} value={value}>{t[value]}</option>)}</Select></label>
          <fieldset><legend>{t.components}</legend><div className="status-component-checks">{componentKeys.map((key) => <label key={key}><input type="checkbox" checked={selectedComponents.includes(key)} onChange={(event) => setSelectedComponents((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))}/>{componentLabels[locale][key]}</label>)}</div></fieldset>
          <button className="staff-approve" disabled={busy || !selectedComponents.length}><Activity aria-hidden="true"/>{t.submit}</button>
        </form>
        <section className="status-admin-list" aria-label={t.active}>
          <h2>{t.active}</h2>
          {active.length ? active.map((incident) => <button type="button" className={selectedIncident === incident.id ? "selected" : ""} key={incident.id} onClick={() => { const candidates = nextStates(incident.state); setSelectedIncident(incident.id); setNextState(candidates[0] ?? "resolved"); }}><span>{incident.publicReference}</span><b>{incidentTitle(incident)}</b><small>{stateLabel(incident.state)} · {t[incident.severity]}</small></button>) : <p className="staff-empty">{t.empty}</p>}
          <h2>{t.resolved}</h2>
          {resolved.slice(0, 10).map((incident) => <article key={incident.id}><span>{incident.publicReference}</span><b>{incidentTitle(incident)}</b><small>{t.resolvedState}</small></article>)}
        </section>
      </div>
      {selected && allowedNext.length ? <form className="staff-decision status-update-form" onSubmit={(event) => void update(event)}>
        <h2><Send aria-hidden="true"/>{t.update}: {selected.publicReference}</h2>
        <label>{t.state}<Select value={nextState} onChange={(event) => setNextState(event.target.value as typeof nextState)}>{allowedNext.map((state) => <option key={state} value={state}>{stateLabel(state)}</option>)}</Select></label>
        <label>{t.messageRu}<textarea name="updateMessageRu" required minLength={10} maxLength={2000}/></label>
        <label>{t.messageUz}<textarea name="updateMessageUz" required minLength={10} maxLength={2000}/></label>
        <label>{t.messageEn}<textarea name="updateMessageEn" required minLength={10} maxLength={2000}/></label>
        <button className="staff-approve" disabled={busy}><Send aria-hidden="true"/>{t.send}</button>
      </form> : null}
    </main>
  </div>;
}
