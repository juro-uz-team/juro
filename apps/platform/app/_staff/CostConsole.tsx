"use client";

import { Select } from "../_components/Select";

import {
  BarChart3,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UnlockKeyhole,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AiCostDashboard } from "../../lib/ai/provider-usage";
import { platformIntlLocale } from "../../lib/platform/date-time";
import type { PlatformLocale } from "../../lib/platform/routing";

type Locale = PlatformLocale;
type Provider = "openai" | "anthropic";

const copy = {
  ru: {
    title: "Стоимость и защита AI",
    eyebrow: "Операционная наблюдаемость",
    secure: "Защищённая рабочая зона",
    fresh: "Недавняя 2FA",
    refresh: "Обновить",
    unpriced: "Вызовы без цены",
    prices: "Версии цен",
    usage: "Дневное использование",
    addPrice: "Добавить версию цены",
    provider: "Провайдер",
    model: "Модель",
    operation: "Операция",
    inputRate: "Input, µUSD / 1 млн токенов",
    outputRate: "Output, µUSD / 1 млн токенов",
    cachedRate: "Cached input, µUSD / 1 млн",
    effective: "Действует с",
    source: "Официальный URL цены",
    savePrice: "Сохранить неизменяемую цену",
    date: "Дата",
    feature: "Функция",
    requests: "Запросы",
    failures: "Ошибки",
    tokens: "Токены",
    cost: "Оценка, USD",
    noData: "Данных пока нет",
    priceSuccess: "Версия цены добавлена",
    protection: "Circuit breaker",
    policy: "Новая версия порогов",
    dailyLimit: "Дневной лимит, USD",
    failureLimit: "Ошибок за окно",
    window: "Окно, минут",
    enabled: "Автоматическая защита включена",
    savePolicy: "Сохранить версию порогов",
    policySuccess: "Версия порогов добавлена",
    open: "Открыт — вызовы заблокированы",
    closed: "Закрыт — вызовы разрешены",
    openAction: "Остановить провайдера",
    closeAction: "Возобновить после проверки",
    circuitSuccess: "Состояние circuit обновлено",
    latestPolicy: "Текущий порог",
    alerts: "Операционные уведомления",
    status: "Статус",
    reason: "Причина",
  },
  uz: {
    title: "AI xarajati va himoyasi",
    eyebrow: "Operatsion kuzatuv",
    secure: "Himoyalangan ish maydoni",
    fresh: "Yaqindagi 2FA",
    refresh: "Yangilash",
    unpriced: "Narxsiz chaqiruvlar",
    prices: "Narx versiyalari",
    usage: "Kunlik foydalanish",
    addPrice: "Narx versiyasini qo‘shish",
    provider: "Provayder",
    model: "Model",
    operation: "Operatsiya",
    inputRate: "Input, µUSD / 1 mln token",
    outputRate: "Output, µUSD / 1 mln token",
    cachedRate: "Cached input, µUSD / 1 mln",
    effective: "Amal qilish vaqti",
    source: "Rasmiy narx URL manzili",
    savePrice: "O‘zgarmas narxni saqlash",
    date: "Sana",
    feature: "Funksiya",
    requests: "So‘rovlar",
    failures: "Xatolar",
    tokens: "Tokenlar",
    cost: "Baholash, USD",
    noData: "Hozircha ma’lumot yo‘q",
    priceSuccess: "Narx versiyasi qo‘shildi",
    protection: "Circuit breaker",
    policy: "Yangi limit versiyasi",
    dailyLimit: "Kunlik limit, USD",
    failureLimit: "Oynadagi xatolar",
    window: "Oyna, daqiqa",
    enabled: "Avtomatik himoya yoqilgan",
    savePolicy: "Limit versiyasini saqlash",
    policySuccess: "Limit versiyasi qo‘shildi",
    open: "Ochiq — chaqiruvlar bloklangan",
    closed: "Yopiq — chaqiruvlarga ruxsat",
    openAction: "Provayderni to‘xtatish",
    closeAction: "Tekshiruvdan keyin tiklash",
    circuitSuccess: "Circuit holati yangilandi",
    latestPolicy: "Joriy limit",
    alerts: "Operatsion bildirishnomalar",
    status: "Holat",
    reason: "Sabab",
  },
  en: {
    title: "AI cost and safeguards",
    eyebrow: "Operational observability",
    secure: "Secure workspace",
    fresh: "Recent 2FA",
    refresh: "Refresh",
    unpriced: "Unpriced calls",
    prices: "Price versions",
    usage: "Daily usage",
    addPrice: "Add price version",
    provider: "Provider",
    model: "Model",
    operation: "Operation",
    inputRate: "Input, µUSD / 1M tokens",
    outputRate: "Output, µUSD / 1M tokens",
    cachedRate: "Cached input, µUSD / 1M",
    effective: "Effective from",
    source: "Official pricing URL",
    savePrice: "Save immutable price",
    date: "Date",
    feature: "Feature",
    requests: "Requests",
    failures: "Failures",
    tokens: "Tokens",
    cost: "Estimate, USD",
    noData: "No data yet",
    priceSuccess: "Price version added",
    protection: "Circuit breaker",
    policy: "New threshold version",
    dailyLimit: "Daily limit, USD",
    failureLimit: "Failures per window",
    window: "Window, minutes",
    enabled: "Automatic protection enabled",
    savePolicy: "Save threshold version",
    policySuccess: "Threshold version added",
    open: "Open — calls are blocked",
    closed: "Closed — calls are allowed",
    openAction: "Stop provider",
    closeAction: "Resume after review",
    circuitSuccess: "Circuit state updated",
    latestPolicy: "Current threshold",
    alerts: "Operational alerts",
    status: "Status",
    reason: "Reason",
  },
} as const;

function usd(microusd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(microusd / 1_000_000);
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(body.code || `HTTP_${response.status}`);
  return body;
}

export function CostConsole({
  locale,
  staffName,
  initial,
}: {
  locale: Locale;
  staffName: string;
  initial: AiCostDashboard;
}) {
  const t = copy[locale];
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    setData(await json<AiCostDashboard>(await fetch("/api/platform/admin/costs", { cache: "no-store" })));
  }

  async function mutate(body: unknown, success: string): Promise<boolean> {
    setBusy(true);
    setNotice("");
    try {
      await json(await fetch("/api/platform/admin/costs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify(body),
      }));
      await reload();
      setNotice(success);
      setError("");
      return true;
    } catch (value) {
      setError(value instanceof Error ? value.message : "ERROR");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      await reload();
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "ERROR");
    } finally {
      setBusy(false);
    }
  }

  async function submitPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const saved = await mutate({
      action: "price",
      value: {
        provider: form.get("provider"),
        model: form.get("model"),
        operation: form.get("operation"),
        inputMicrousdPerMillionTokens: Number(form.get("inputRate")),
        outputMicrousdPerMillionTokens: Number(form.get("outputRate")),
        cachedInputMicrousdPerMillionTokens: Number(form.get("cachedRate")),
        effectiveFrom: new Date(String(form.get("effectiveFrom"))).toISOString(),
        sourceUrl: String(form.get("sourceUrl") || "") || null,
      },
    }, t.priceSuccess);
    if (saved) formElement.reset();
  }

  async function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const saved = await mutate({
      action: "policy",
      value: {
        provider: form.get("provider"),
        dailyCostLimitMicrousd: Math.round(Number(form.get("dailyLimit")) * 1_000_000),
        rollingFailureLimit: Number(form.get("failureLimit")),
        rollingWindowMinutes: Number(form.get("window")),
        enabled: form.get("enabled") === "on",
        effectiveFrom: new Date(String(form.get("effectiveFrom"))).toISOString(),
      },
    }, t.policySuccess);
    if (saved) formElement.reset();
  }

  const currentPolicy = (provider: Provider) => data.policies.find((policy) => policy.provider === provider);

  return <div className="staff-console cost-console" aria-busy={busy}>
    <header className="staff-topbar">
      <div className="staff-brand"><ShieldCheck aria-hidden="true"/><span><b>JURO</b><small>{t.secure}</small></span></div>
      <div className="staff-session"><span>{t.fresh}</span><b>{staffName}</b></div>
    </header>
    <main className="staff-main" id="main-content">
      <section className="staff-heading">
        <div><p>{t.eyebrow}</p><h1>{t.title}</h1></div>
        <button type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw aria-hidden="true"/>{t.refresh}</button>
      </section>
      <div className="cost-summary" role="status"><BarChart3 aria-hidden="true"/><span>{t.unpriced}</span><b>{data.unpricedEvents}</b></div>
      {error && <p className="staff-error" role="alert">{error}</p>}
      {notice && <p className="cost-success" role="status">{notice}</p>}

      <section className="cost-circuits" aria-labelledby="cost-protection-title">
        <h2 id="cost-protection-title"><ShieldAlert aria-hidden="true"/>{t.protection}</h2>
        <div className="cost-circuit-grid">
          {data.circuits.map((circuit) => {
            const policy = currentPolicy(circuit.provider);
            return <article className={`cost-circuit cost-circuit--${circuit.state}`} key={circuit.provider}>
              <div><strong>{circuit.provider === "openai" ? "OpenAI" : "Anthropic"}</strong><span>{circuit.state === "open" ? t.open : t.closed}</span></div>
              <p>{t.latestPolicy}: {policy ? `${usd(policy.dailyCostLimitMicrousd)} · ${policy.rollingFailureLimit}/${policy.rollingWindowMinutes}m` : "—"}</p>
              <button
                type="button"
                disabled={busy}
                className={circuit.state === "open" ? "staff-approve" : "staff-danger"}
                onClick={() => void mutate({ action: "circuit", value: { provider: circuit.provider, state: circuit.state === "open" ? "closed" : "open" } }, t.circuitSuccess)}
              >
                {circuit.state === "open" ? <UnlockKeyhole aria-hidden="true"/> : <LockKeyhole aria-hidden="true"/>}
                {circuit.state === "open" ? t.closeAction : t.openAction}
              </button>
            </article>;
          })}
        </div>
      </section>

      <section className="cost-layout">
        <form className="cost-price-form" onSubmit={(event) => void submitPolicy(event)}>
          <h2><ShieldAlert aria-hidden="true"/>{t.policy}</h2>
          <label>{t.provider}<Select name="provider" defaultValue="openai"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></Select></label>
          <label>{t.dailyLimit}<input name="dailyLimit" type="number" min="0.000001" max="1000000000" step="0.000001" required/></label>
          <label>{t.failureLimit}<input name="failureLimit" type="number" min="2" max="100000" step="1" defaultValue="5" required/></label>
          <label>{t.window}<input name="window" type="number" min="1" max="1440" step="1" defaultValue="15" required/></label>
          <label>{t.effective}<input name="effectiveFrom" type="datetime-local" required/></label>
          <label className="cost-checkbox"><input name="enabled" type="checkbox" defaultChecked/>{t.enabled}</label>
          <button className="staff-approve" disabled={busy}><Plus aria-hidden="true"/>{t.savePolicy}</button>
        </form>

        <form className="cost-price-form" onSubmit={(event) => void submitPrice(event)}>
          <h2><Plus aria-hidden="true"/>{t.addPrice}</h2>
          <label>{t.provider}<Select name="provider" defaultValue="openai"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></Select></label>
          <label>{t.model}<input name="model" defaultValue="text-embedding-3-large" required maxLength={120}/></label>
          <label>{t.operation}<input name="operation" defaultValue="embeddings" required pattern="[a-z0-9._-]+" maxLength={64}/></label>
          <label>{t.inputRate}<input name="inputRate" type="number" min="0" step="1" required/></label>
          <label>{t.outputRate}<input name="outputRate" type="number" min="0" step="1" defaultValue="0" required/></label>
          <label>{t.cachedRate}<input name="cachedRate" type="number" min="0" step="1" defaultValue="0" required/></label>
          <label>{t.effective}<input name="effectiveFrom" type="datetime-local" required/></label>
          <label>{t.source}<input name="sourceUrl" type="url" inputMode="url" placeholder="https://openai.com/api/pricing/"/></label>
          <button className="staff-approve" disabled={busy}><Plus aria-hidden="true"/>{t.savePrice}</button>
        </form>
      </section>

      <section className="cost-prices" aria-labelledby="cost-prices-title">
        <h2 id="cost-prices-title">{t.prices}</h2>
        {data.prices.length ? <div className="cost-table-wrap"><table><thead><tr><th>{t.provider}</th><th>{t.model}</th><th>{t.operation}</th><th>{t.inputRate}</th><th>{t.effective}</th></tr></thead><tbody>{data.prices.map((price) => <tr key={price.id}><td>{price.provider}</td><td><code>{price.model}</code></td><td>{price.operation}</td><td>{price.inputMicrousdPerMillionTokens.toLocaleString("en-US")}</td><td><time dateTime={price.effectiveFrom}>{new Date(price.effectiveFrom).toLocaleString(platformIntlLocale(locale))}</time></td></tr>)}</tbody></table></div> : <p className="staff-empty">{t.noData}</p>}
      </section>

      <section className="cost-usage" aria-labelledby="cost-usage-title">
        <h2 id="cost-usage-title">{t.usage}</h2>
        {data.daily.length ? <div className="cost-table-wrap"><table><thead><tr><th>{t.date}</th><th>{t.feature}</th><th>{t.provider}</th><th>{t.model}</th><th>{t.requests}</th><th>{t.failures}</th><th>{t.tokens}</th><th>{t.cost}</th></tr></thead><tbody>{data.daily.map((row) => <tr key={`${row.usageDay}:${row.feature}:${row.provider}:${row.model}`}><td>{row.usageDay}</td><td>{row.feature}</td><td>{row.provider}</td><td><code>{row.model}</code></td><td>{row.requestCount}</td><td>{row.failedRequestCount}</td><td>{row.inputTokens + row.outputTokens}</td><td>{usd(row.estimatedCostMicrousd)}{row.unpricedRequestCount > 0 ? ` · ${t.unpriced}: ${row.unpricedRequestCount}` : ""}</td></tr>)}</tbody></table></div> : <p className="staff-empty">{t.noData}</p>}
      </section>

      <section className="cost-usage" aria-labelledby="cost-alerts-title">
        <h2 id="cost-alerts-title">{t.alerts}</h2>
        {data.alerts.length ? <div className="cost-table-wrap"><table><thead><tr><th>{t.date}</th><th>{t.provider}</th><th>{t.reason}</th><th>{t.status}</th></tr></thead><tbody>{data.alerts.map((alert) => <tr key={alert.id}><td><time dateTime={alert.createdAt}>{new Date(alert.createdAt).toLocaleString(platformIntlLocale(locale))}</time></td><td>{alert.provider}</td><td>{alert.reason}</td><td>{alert.status}{alert.errorCode ? ` · ${alert.errorCode}` : ""}</td></tr>)}</tbody></table></div> : <p className="staff-empty">{t.noData}</p>}
      </section>
    </main>
  </div>;
}
