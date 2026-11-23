"use client";

import { WorkspaceTitle } from "./WorkspaceTitle";
import { usePlatformWorkspaceId } from "./PlatformRouteContext";
import { WorkspacePagination, useWorkspacePagination } from "./WorkspacePagination";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated billing data is hydrated after the first browser render */

import { Check, CircleAlert, CreditCard, FlaskConical, LoaderCircle, ReceiptText, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { platformBasePath, type AccountType, type PlatformLocale } from "../../lib/platform/routing";

type Plan = {
  planVersionId: string;
  code: string;
  nameRu: string;
  nameUz: string;
  nameEn?: string | null;
  billingPeriod: "monthly" | "annual" | "one_time";
  priceMinor: number;
  currency: "UZS";
  entitlementsJson: string;
};

type BillingData = {
  provider: { enabled: boolean; sandboxEnabled: boolean; productionApproved: boolean; reason: string };
  demo: { enabled: boolean; provider: "demo"; isSimulation: true; entitlementsActivated: false };
  subscription: { planCode: string; status: string; currentPeriodEndsAt: string | null } | null;
  payments: Array<{ id: string; amountMinor: number; currency: string; status: string; createdAt: string }>;
};

const billingCopy = {
  ru: { currency: "сум", status: { settled: "Демо: оплачено", paid: "Демо: оплачено", failed: "Демо: отклонено", cancelled: "Демо: отменено", refunded: "Демо: возвращено", pending: "Демо: ожидает" }, statusFallback: "Демо: статус обновляется", conditions: "Точные условия зафиксируются перед оплатой", billingLoadFailed: "Тарифы не загрузились.", pricesUnavailable: "Утверждённые цены недоступны.", orderFailed: "Не удалось создать заказ.", loading: "Загрузка тарифов", title: "Тариф и оплата", plans: "Тарифы", testPayments: "Тестовый режим", demoLabel: "Демо-оплата", retry: "Повторить", unavailable: "Оформление временно недоступно", staging: "Тестовые платежи не списывают реальные средства.", providerReview: "Оплата станет доступна после проверки платёжного провайдера.", demoDescription: "Без карт, списания, Uzum API и изменения тарифа.", demoAction: "Открыть демо", current: "Текущий план", monthly: "за месяц, без налога", annual: "за год, без налога", oneTime: "разовый платёж, без налога", calculate: "Перейти к расчёту", noPrices: "Нет утверждённых цен", noPricesDescription: "Тарифы появятся здесь после утверждения цен.", demoHistory: "История демо-платежей", history: "История платежей", emptyHistory: "Подтверждённых платежей пока нет." },
  uz: { currency: "so‘m", status: { settled: "Demo: to‘landi", paid: "Demo: to‘landi", failed: "Demo: rad etildi", cancelled: "Demo: bekor qilindi", refunded: "Demo: qaytarildi", pending: "Demo: kutilmoqda" }, statusFallback: "Demo: holat yangilanmoqda", conditions: "Aniq shartlar to‘lovdan oldin qayd etiladi", billingLoadFailed: "Tariflar yuklanmadi.", pricesUnavailable: "Tasdiqlangan narxlar mavjud emas.", orderFailed: "Buyurtma yaratilmadi.", loading: "Tariflar yuklanmoqda", title: "Tarif va to‘lov", plans: "Tariflar", testPayments: "Sinov rejimi", demoLabel: "Demo to‘lov", retry: "Qayta urinish", unavailable: "Rasmiylashtirish vaqtincha mavjud emas", staging: "Sinov to‘lovlarida haqiqiy mablag‘ yechilmaydi.", providerReview: "To‘lov faqat provayder tekshirilgandan keyin faollashadi.", demoDescription: "Karta, pul yechish, Uzum API va tarif o‘zgarishisiz.", demoAction: "Demoni ochish", current: "Joriy reja", monthly: "oyiga, soliqsiz", annual: "yiliga, soliqsiz", oneTime: "bir martalik, soliqsiz", calculate: "Hisob-kitobga o‘tish", noPrices: "Tasdiqlangan narxlar yo‘q", noPricesDescription: "Narxlar tasdiqlangach, tariflar shu yerda ko‘rinadi.", demoHistory: "Demo to‘lovlar tarixi", history: "To‘lovlar tarixi", emptyHistory: "Hozircha tasdiqlangan to‘lovlar yo‘q." },
  en: { currency: "UZS", status: { settled: "Demo: paid", paid: "Demo: paid", failed: "Demo: declined", cancelled: "Demo: cancelled", refunded: "Demo: refunded", pending: "Demo: pending" }, statusFallback: "Demo: status updating", conditions: "The final terms will be recorded before payment", billingLoadFailed: "We could not load billing details.", pricesUnavailable: "Approved prices are unavailable.", orderFailed: "We could not create your order.", loading: "Loading plans", title: "Plan and billing", plans: "Plans", testPayments: "Test mode", demoLabel: "Payment demo", retry: "Try again", unavailable: "Checkout is temporarily unavailable", staging: "Test payments use simulated funds.", providerReview: "Payments activate only after the provider has been verified.", demoDescription: "No cards, charges, Uzum API calls or plan changes.", demoAction: "Open demo", current: "Current plan", monthly: "per month, excluding tax", annual: "per year, excluding tax", oneTime: "one-time payment, excluding tax", calculate: "Review order", noPrices: "No approved prices", noPricesDescription: "Plans will appear here once prices are approved.", demoHistory: "Demo payment history", history: "Payment history", emptyHistory: "No confirmed payments yet." },
} as const;

function money(amountMinor: number, locale: PlatformLocale) {
  const numberLocale = { ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale];
  return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 }).format(amountMinor / 100)} ${billingCopy[locale].currency}`;
}

function paymentStatusLabel(status: string, locale: PlatformLocale, simulation: boolean) {
  if (!simulation) return status;
  const copy = billingCopy[locale];
  return copy.status[status.toLowerCase() as keyof typeof copy.status] ?? copy.statusFallback;
}

function planBenefits(plan: Plan, locale: PlatformLocale): string[] {
  try {
    const parsed = JSON.parse(plan.entitlementsJson) as { entitlements?: Array<{ code?: string; limitValue?: number | null }> };
    const values = (parsed.entitlements ?? []).slice(0, 4).map((item) => {
      const code = String(item.code ?? "").replaceAll(/[._-]/g, " ");
      return item.limitValue == null ? code : `${code}: ${item.limitValue}`;
    }).filter(Boolean);
    if (values.length) return values;
  } catch { /* invalid plan config is blocked by checkout; the list remains readable */ }
  return [billingCopy[locale].conditions];
}

export function BillingClient({ locale, accountType, workspaceId }: { locale: PlatformLocale; accountType: AccountType; workspaceId?: string }) {
  const copy = billingCopy[locale];
  const router = useRouter();
  const activeWorkspaceId = usePlatformWorkspaceId();
  const [data, setData] = useState<BillingData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingPlan, setPendingPlan] = useState("");
  const formatter = useMemo(() => new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], { dateStyle: "medium" }), [locale]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const [billingResponse, plansResponse] = await Promise.all([
        fetch("/api/platform/billing", { cache: "no-store", headers: { "x-juro-workspace-id": activeWorkspaceId }, signal }),
        fetch("/api/subscriptions/plans", { cache: "no-store", signal }),
      ]);
      const billingBody = await billingResponse.json() as BillingData & { error?: string };
      const plansBody = await plansResponse.json() as {
        plans?: Plan[];
        error?: string;
        code?: string;
      };
      if (!billingResponse.ok) throw new Error(billingBody.error || copy.billingLoadFailed);
      // A production checkout is deliberately closed until the owner approves a
      // real provider and price catalogue.  That is an expected safe state, not
      // a loading failure: keep the billing workspace visible so the explicitly
      // isolated demo flow remains reachable.
      if (!plansResponse.ok && plansBody.code !== "BILLING_UNAVAILABLE") {
        throw new Error(plansBody.error || copy.pricesUnavailable);
      }
      if (!signal?.aborted) {
        setData(billingBody);
        setPlans(plansBody.plans ?? []);
      }
    } catch (value) {
      if (!signal?.aborted) setError(value instanceof Error ? value.message : String(value));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeWorkspaceId, copy.billingLoadFailed, copy.pricesUnavailable]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function choose(planVersionId: string) {
    setPendingPlan(planVersionId);
    setError("");
    try {
      const response = await fetch("/api/checkout/create", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), planVersionId, locale, ...(workspaceId ? { workspaceId } : {}) }),
      });
      const body = await response.json() as { order?: { id?: unknown }; error?: string; code?: string };
      if (!response.ok || typeof body.order?.id !== "string") throw new Error(body.error || copy.orderFailed);
      router.push(`${platformBasePath(locale, accountType, workspaceId)}/checkout/${encodeURIComponent(body.order.id)}`);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setPendingPlan("");
    }
  }

  const payments = data?.payments ?? [];
  const history = useWorkspacePagination(payments.length, 5, activeWorkspaceId);
  return <section className="billing-workspace workspace-page">
    <WorkspaceTitle icon={<CreditCard />} title={copy.title} />
    {error && <div className="billing-error" role="alert"><CircleAlert aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => void load()}>{copy.retry}</button></div>}
    {loading && <div className="billing-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" />{copy.loading}</div>}
    {!loading && data && <div className="billing-overview">
      <section className="billing-catalogue" aria-labelledby="billing-plans-heading">
        <header className="billing-card-header"><WalletCards aria-hidden="true" /><h2 id="billing-plans-heading">{copy.plans}</h2>
          {data.provider.sandboxEnabled && <span className="billing-mode"><FlaskConical aria-hidden="true" />{copy.testPayments}</span>}
        </header>
        {plans.length ? <>
          {(!data.provider.enabled || data.provider.sandboxEnabled) && <div className="billing-provider"><ShieldCheck aria-hidden="true" /><div>
            {!data.provider.enabled && <strong>{copy.unavailable}</strong>}
            <p>{data.provider.sandboxEnabled ? copy.staging : copy.providerReview}</p>
          </div></div>}
          <div className="billing-plans">{plans.map(plan => {
            const current = data.subscription?.planCode === plan.code;
            return <article key={plan.planVersionId} className={current ? "current" : undefined}>
              {current && <span className="billing-mode">{copy.current}</span>}
              <h3>{locale === "ru" ? plan.nameRu : locale === "uz" ? plan.nameUz : plan.nameEn || `JURO ${plan.code}`}</h3>
              <strong className="billing-price">{money(plan.priceMinor, locale)}</strong>
              <p className="billing-period">{plan.billingPeriod === "monthly" ? copy.monthly : plan.billingPeriod === "annual" ? copy.annual : copy.oneTime}</p>
              <ul>{planBenefits(plan, locale).map(feature => <li key={feature}><Check aria-hidden="true" />{feature}</li>)}</ul>
              <button type="button" disabled={!data.provider.enabled || Boolean(pendingPlan)} onClick={() => void choose(plan.planVersionId)}>
                {pendingPlan === plan.planVersionId ? <LoaderCircle className="spin" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}{copy.calculate}
              </button>
            </article>;
          })}</div>
        </> : <div className="billing-catalogue-empty">
          <span className="billing-empty-icon"><ShieldCheck aria-hidden="true" /></span>
          <div><h3>{data.provider.enabled ? copy.noPrices : copy.unavailable}</h3>
            <p>{data.provider.enabled ? copy.noPricesDescription : copy.providerReview}</p>
          </div>
        </div>}
        {data.demo.enabled && <div className="billing-demo-entry"><div><strong>{copy.demoLabel}</strong><p>{copy.demoDescription}</p></div>
          <Link href={`${platformBasePath(locale, accountType, workspaceId)}/demo-payments`}>{copy.demoAction}</Link>
        </div>}
      </section>
      <section className="billing-history" aria-labelledby="billing-history-heading">
        <header className="billing-card-header"><ReceiptText aria-hidden="true" /><h2 id="billing-history-heading">{data.provider.sandboxEnabled ? copy.demoHistory : copy.history}</h2></header>
        {payments.length ? <div className="billing-history-list">
          <ul>{payments.slice(history.from, history.to).map(payment => <li key={payment.id}>
            <time dateTime={payment.createdAt}>{formatter.format(new Date(payment.createdAt))}</time>
            <strong>{money(payment.amountMinor, locale)}</strong>
            <span>{paymentStatusLabel(payment.status, locale, data.provider.sandboxEnabled)}</span>
          </li>)}</ul>
          <WorkspacePagination locale={locale} {...history} />
        </div> : <div className="billing-history-empty"><p>{copy.emptyHistory}</p></div>}
      </section>
    </div>}
  </section>;
}
