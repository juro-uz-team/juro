"use client";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- tenant-scoped demo history is loaded after hydration */

import { Ban, CheckCircle2, CircleAlert, CreditCard, LoaderCircle, RotateCcw, ShieldCheck, Undo2, WalletCards } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { platformBasePath, type AccountType, type PlatformLocale } from "../../lib/platform/routing";
import type { DemoPaymentAction, DemoPaymentFlowType, DemoPaymentRun } from "../../lib/billing/demo-payments";

type Data = {
  availability: {
    enabled: boolean;
    provider: "demo";
    isSimulation: true;
    externalNetwork: false;
    entitlementsActivated: false;
    reason: string;
  };
  runs: DemoPaymentRun[];
};

const FLOW_DEFAULTS: Record<DemoPaymentFlowType, number> = {
  subscription: 120_000,
  lawyer_service: 500_000,
  uzum_installment: 900_000,
};

const demoCopy = {
  ru: {
    invalidAmount: "Введите целую демо-сумму от 1 до 1 000 000 000 сум.",
    flows: { subscription: "Подписка JURO", lawyer_service: "Услуга юриста", uzum_installment: "Uzum — рассрочка" },
    statuses: { previewed: "Ожидает демо-решения", succeeded: "Демо: успешно", failed: "Демо: отклонено", cancelled: "Демо: отменено", refunded: "Демо: возврат", paid_out: "Демо: выплата юристу" },
    title: "Демонстрация платежей", description: "Связанный с D1 учебный контур без реальных денег, карт, Uzum API и изменения тарифа.", simulation: "Только симуляция", simulationDescription: "Даже успешный сценарий не создаёт подписку, entitlement, реальную оплату, чек или выплату.", retry: "Повторить", loading: "Загрузка демо-контуров", disabled: "Демо отключено", amount: "Условная сумма, сум", period: "Период", month3: "месяца", months: "месяцев", monthShort: "мес.", create: "Создать демо-сценарий", records: "Демо-записи", refresh: "Обновить демо-записи", succeed: "Успех", fail: "Отклонить", cancel: "Отменить", refund: "Демо-возврат", payout: "Демо-выплата", empty: "Демо-записей пока нет.", back: "Вернуться к тарифу", currency: "сум",
  },
  uz: {
    invalidAmount: "1 dan 1 000 000 000 so‘mgacha butun demo summani kiriting.",
    flows: { subscription: "JURO obunasi", lawyer_service: "Yurist xizmati", uzum_installment: "Uzum — bo‘lib to‘lash" },
    statuses: { previewed: "Demo qarorini kutmoqda", succeeded: "Demo: muvaffaqiyatli", failed: "Demo: rad etildi", cancelled: "Demo: bekor qilindi", refunded: "Demo: qaytarildi", paid_out: "Demo: yuristga to‘lov" },
    title: "To‘lovlar namoyishi", description: "Haqiqiy pul, karta, Uzum API va tarif o‘zgarishisiz D1 bilan bog‘langan o‘quv konturi.", simulation: "Faqat simulyatsiya", simulationDescription: "Muvaffaqiyatli ssenariy ham obuna, entitlement, haqiqiy to‘lov, chek yoki pul o‘tkazmasini yaratmaydi.", retry: "Qayta urinish", loading: "Demo konturlari yuklanmoqda", disabled: "Demo o‘chirilgan", amount: "Shartli summa, so‘m", period: "Muddat", month3: "oy", months: "oy", monthShort: "oy", create: "Demo ssenariy yaratish", records: "Demo yozuvlari", refresh: "Demo yozuvlarini yangilash", succeed: "Muvaffaqiyat", fail: "Rad etish", cancel: "Bekor qilish", refund: "Demo qaytarish", payout: "Demo to‘lov", empty: "Hozircha demo yozuvlari yo‘q.", back: "Tarifga qaytish", currency: "so‘m",
  },
  en: {
    invalidAmount: "Enter a whole-number demo amount from 1 to 1,000,000,000 UZS.",
    flows: { subscription: "JURO subscription", lawyer_service: "Legal service", uzum_installment: "Uzum instalments" },
    statuses: { previewed: "Awaiting demo decision", succeeded: "Demo: successful", failed: "Demo: declined", cancelled: "Demo: cancelled", refunded: "Demo: refunded", paid_out: "Demo: lawyer payout" },
    title: "Payment demonstration", description: "A D1-backed training environment with no real money, cards, Uzum API calls or subscription changes.", simulation: "Simulation only", simulationDescription: "Even a successful scenario creates no subscription, entitlement, real payment, receipt or payout.", retry: "Try again", loading: "Loading demo flows", disabled: "Demo unavailable", amount: "Simulated amount, UZS", period: "Period", month3: "months", months: "months", monthShort: "mo.", create: "Create demo scenario", records: "Demo records", refresh: "Refresh demo records", succeed: "Approve", fail: "Decline", cancel: "Cancel", refund: "Demo refund", payout: "Demo payout", empty: "No demo records yet.", back: "Back to billing", currency: "UZS",
  },
} as const;

function money(amountMinor: number, locale: PlatformLocale) {
  const numberLocale = { ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale];
  return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 }).format(amountMinor / 100)} ${demoCopy[locale].currency}`;
}

export function DemoPaymentsClient({ locale, accountType, workspaceId }: { locale: PlatformLocale; accountType: AccountType; workspaceId?: string }) {
  const copy = demoCopy[locale];
  const [data, setData] = useState<Data | null>(null);
  const [amounts, setAmounts] = useState<Record<DemoPaymentFlowType, string>>({
    subscription: String(FLOW_DEFAULTS.subscription),
    lawyer_service: String(FLOW_DEFAULTS.lawyer_service),
    uzum_installment: String(FLOW_DEFAULTS.uzum_installment),
  });
  const [installments, setInstallments] = useState<3 | 6 | 12>(3);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/platform/demo-payments${query}`, { cache: "no-store" });
      const body = await response.json() as Data & { code?: string; error?: string };
      if (!response.ok) throw new Error(body.error || body.code || "DEMO_PAYMENT_UNAVAILABLE");
      setData(body);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/platform/demo-payments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ ...body, requestId: crypto.randomUUID(), locale, ...(workspaceId ? { workspaceId } : {}) }),
      });
      const result = await response.json() as { code?: string; error?: string };
      if (!response.ok) throw new Error(result.error || result.code || "DEMO_PAYMENT_FAILED");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy("");
    }
  }

  async function create(flowType: DemoPaymentFlowType) {
    const sum = Number(amounts[flowType]);
    if (!Number.isInteger(sum) || sum <= 0 || sum > 1_000_000_000) {
      setError(copy.invalidAmount);
      return;
    }
    await post({
      action: "create",
      flowType,
      amountMinor: sum * 100,
      ...(flowType === "uzum_installment" ? { installmentCount: installments } : {}),
    }, `create:${flowType}`);
  }

  async function transition(runId: string, outcome: DemoPaymentAction) {
    await post({ action: "transition", runId, outcome }, `${runId}:${outcome}`);
  }

  const basePath = platformBasePath(locale, accountType, workspaceId);
  return <section className="demo-payments-workspace">
    <header><WalletCards aria-hidden="true"/><div><small>JURO · PAYMENT DEMO</small><h1>{copy.title}</h1><p>{copy.description}</p></div></header>
    <div className="demo-payment-warning" role="note"><ShieldCheck aria-hidden="true"/><div><strong>{copy.simulation}</strong><p><code>provider=demo</code> · <code>isSimulation=true</code>. {copy.simulationDescription}</p></div></div>
    {error && <p className="billing-error" role="alert"><CircleAlert aria-hidden="true"/>{error}<button type="button" onClick={() => void load()}>{copy.retry}</button></p>}
    {!data ? <div className="billing-loading" role="status"><LoaderCircle className="spin"/><span>{copy.loading}</span></div> : !data.availability.enabled ? <div className="billing-empty"><Ban aria-hidden="true"/><div><h2>{copy.disabled}</h2><p>{data.availability.reason}</p></div></div> : <>
      <div className="demo-payment-flows">
        {(Object.keys(copy.flows) as DemoPaymentFlowType[]).map(flowType => <article key={flowType}>
          <small>DEMO · {flowType === "uzum_installment" ? "UZUM" : "JURO"}</small><h2>{copy.flows[flowType]}</h2>
          <label>{copy.amount}<input type="number" min="1" max="1000000000" step="1" inputMode="numeric" value={amounts[flowType]} onChange={event => setAmounts(current => ({ ...current, [flowType]: event.target.value }))}/></label>
          {flowType === "uzum_installment" && <label>{copy.period}<Select value={installments} onChange={event => setInstallments(Number(event.target.value) as 3 | 6 | 12)}><option value="3">3 {copy.month3}</option><option value="6">6 {copy.months}</option><option value="12">12 {copy.months}</option></Select></label>}
          <button type="button" disabled={Boolean(busy)} onClick={() => void create(flowType)}>{busy === `create:${flowType}` ? <LoaderCircle className="spin"/> : <CreditCard/>}{copy.create}</button>
        </article>)}
      </div>
      <section className="demo-payment-history"><div className="demo-payment-history-title"><div><small>APPEND-ONLY EVENTS</small><h2>{copy.records}</h2></div><button type="button" onClick={() => void load()} aria-label={copy.refresh}><RotateCcw/></button></div>
        {data.runs.length ? data.runs.map(run => <article key={run.id}>
          <div><small>{run.externalId}</small><strong>{copy.flows[run.flowType]}</strong><span>{money(run.amountMinor, locale)}{run.installmentCount ? ` · ${run.installmentCount} ${copy.monthShort}` : ""}</span></div>
          <p className={`demo-payment-status ${run.status}`}>{copy.statuses[run.status]}</p>
          <div className="demo-payment-actions">
            {run.status === "previewed" && <><button type="button" disabled={Boolean(busy)} onClick={() => void transition(run.id, "succeed")}><CheckCircle2/>{copy.succeed}</button><button type="button" disabled={Boolean(busy)} onClick={() => void transition(run.id, "fail")}><CircleAlert/>{copy.fail}</button><button type="button" disabled={Boolean(busy)} onClick={() => void transition(run.id, "cancel")}><Ban/>{copy.cancel}</button></>}
            {run.status === "succeeded" && <button type="button" disabled={Boolean(busy)} onClick={() => void transition(run.id, "refund")}><Undo2/>{copy.refund}</button>}
            {run.status === "succeeded" && run.flowType === "lawyer_service" && <button type="button" disabled={Boolean(busy)} onClick={() => void transition(run.id, "payout")}><WalletCards/>{copy.payout}</button>}
          </div>
        </article>) : <p>{copy.empty}</p>}
      </section>
    </>}
    <Link className="demo-payment-back" href={`${basePath}/billing`}>{copy.back}</Link>
  </section>;
}
