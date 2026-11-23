"use client";

import { WorkspaceTitle } from "./WorkspaceTitle";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated billing data is hydrated after the first browser render */

import { Check, CircleAlert, CreditCard, LoaderCircle, ReceiptText, ShieldCheck } from "lucide-react";
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
  ru: { currency: "сум", status: { settled: "Демо: оплачено", paid: "Демо: оплачено", failed: "Демо: отклонено", cancelled: "Демо: отменено", refunded: "Демо: возвращено", pending: "Демо: ожидает" }, statusFallback: "Демо: статус обновляется", conditions: "Точные условия зафиксируются перед оплатой", billingLoadFailed: "Тарифы не загрузились.", pricesUnavailable: "Утверждённые цены недоступны.", orderFailed: "Не удалось создать заказ.", loading: "Загрузка тарифов", title: "Тариф и оплата", description: "Выберите утверждённый тариф. Полная сумма, налог и режим продления фиксируются в заказе до оплаты.", retry: "Повторить", ready: "Безопасное оформление включено", unavailable: "Оформление временно недоступно", staging: "Staging: тестовая оплата, реальные деньги не списываются.", providerReview: "Платёж активируется только после проверки провайдера.", demoTitle: "Посмотреть подключённую демонстрацию оплаты", demoDescription: "Без карт, списания, Uzum API и изменения тарифа.", demoAction: "Открыть демо", current: "Текущий план", monthly: "за месяц, без налога", annual: "за год, без налога", oneTime: "разовый платёж, без налога", calculate: "Перейти к расчёту", noPrices: "Нет утверждённых цен", noPricesDescription: "JURO не создаёт заказ по черновой или неподтверждённой цене.", demoHistory: "История демо-платежей", history: "История платежей", emptyHistory: "Подтверждённых платежей пока нет." },
  uz: { currency: "so‘m", status: { settled: "Demo: to‘landi", paid: "Demo: to‘landi", failed: "Demo: rad etildi", cancelled: "Demo: bekor qilindi", refunded: "Demo: qaytarildi", pending: "Demo: kutilmoqda" }, statusFallback: "Demo: holat yangilanmoqda", conditions: "Aniq shartlar to‘lovdan oldin qayd etiladi", billingLoadFailed: "Tariflar yuklanmadi.", pricesUnavailable: "Tasdiqlangan narxlar mavjud emas.", orderFailed: "Buyurtma yaratilmadi.", loading: "Tariflar yuklanmoqda", title: "Tarif va to‘lov", description: "Tasdiqlangan tarifni tanlang. To‘liq summa, soliq va uzaytirish tartibi to‘lovdan oldin buyurtmada qayd etiladi.", retry: "Qayta urinish", ready: "Xavfsiz rasmiylashtirish yoqilgan", unavailable: "Rasmiylashtirish vaqtincha mavjud emas", staging: "Staging: sinov to‘lovi, haqiqiy pul yechilmaydi.", providerReview: "To‘lov faqat provayder tekshirilgandan keyin faollashadi.", demoTitle: "Ulangan to‘lov namoyishini ko‘rish", demoDescription: "Karta, pul yechish, Uzum API va tarif o‘zgarishisiz.", demoAction: "Demoni ochish", current: "Joriy reja", monthly: "oyiga, soliqsiz", annual: "yiliga, soliqsiz", oneTime: "bir martalik, soliqsiz", calculate: "Hisob-kitobga o‘tish", noPrices: "Tasdiqlangan narxlar yo‘q", noPricesDescription: "JURO qoralama yoki tasdiqlanmagan narx bo‘yicha buyurtma yaratmaydi.", demoHistory: "Demo to‘lovlar tarixi", history: "To‘lovlar tarixi", emptyHistory: "Hozircha tasdiqlangan to‘lovlar yo‘q." },
  en: { currency: "UZS", status: { settled: "Demo: paid", paid: "Demo: paid", failed: "Demo: declined", cancelled: "Demo: cancelled", refunded: "Demo: refunded", pending: "Demo: pending" }, statusFallback: "Demo: status updating", conditions: "The final terms will be recorded before payment", billingLoadFailed: "We could not load billing details.", pricesUnavailable: "Approved prices are unavailable.", orderFailed: "We could not create your order.", loading: "Loading plans", title: "Plan and billing", description: "Choose an approved plan. The full price, tax and renewal preference are recorded in your order before payment.", retry: "Try again", ready: "Secure checkout is available", unavailable: "Checkout is temporarily unavailable", staging: "Staging: this is a test payment and no real money is charged.", providerReview: "Payments activate only after the provider has been verified.", demoTitle: "View the connected payment demonstration", demoDescription: "No cards, charges, Uzum API calls or plan changes.", demoAction: "Open demo", current: "Current plan", monthly: "per month, excluding tax", annual: "per year, excluding tax", oneTime: "one-time payment, excluding tax", calculate: "Review order", noPrices: "No approved prices", noPricesDescription: "JURO never creates an order from a draft or unapproved price.", demoHistory: "Demo payment history", history: "Payment history", emptyHistory: "No confirmed payments yet." },
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
  const [data, setData] = useState<BillingData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingPlan, setPendingPlan] = useState("");
  const formatter = useMemo(() => new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], { dateStyle: "medium" }), [locale]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [billingResponse, plansResponse] = await Promise.all([
        fetch("/api/platform/billing", { cache: "no-store" }),
        fetch("/api/subscriptions/plans", { cache: "no-store" }),
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
      setData(billingBody);
      setPlans(plansBody.plans ?? []);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [copy.billingLoadFailed, copy.pricesUnavailable]);

  useEffect(() => { void load(); }, [load]);

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

  if (loading) return <div className="billing-loading" role="status"><LoaderCircle className="spin" /><span className="sr-only">{copy.loading}</span></div>;
  return <section className="billing-workspace workspace-page">
    <WorkspaceTitle icon={<CreditCard />} title={copy.title} description={copy.description} />
    {error && <p className="billing-error" role="alert"><CircleAlert aria-hidden="true"/>{error}<button type="button" onClick={() => void load()}>{copy.retry}</button></p>}
    {data && <>
      <div className={`billing-provider ${data.provider.enabled ? "ready" : ""}`}><ShieldCheck aria-hidden="true"/><div><strong>{data.provider.enabled ? copy.ready : copy.unavailable}</strong><p>{data.provider.sandboxEnabled ? copy.staging : copy.providerReview}</p></div></div>
      {data.demo.enabled && <div className="billing-demo-entry"><div><small>PROVIDER=DEMO · SIMULATION</small><strong>{copy.demoTitle}</strong><p>{copy.demoDescription}</p></div><Link href={`${platformBasePath(locale, accountType, workspaceId)}/demo-payments`}>{copy.demoAction}</Link></div>}
      {plans.length ? <div className="billing-plans">{plans.map(plan => <article key={plan.planVersionId} className={data.subscription?.planCode === plan.code ? "current" : ""}><small>{data.subscription?.planCode === plan.code ? copy.current : "JURO"}</small><h2>{locale === "ru" ? plan.nameRu : locale === "uz" ? plan.nameUz : plan.nameEn || `JURO ${plan.code}`}</h2><div className="billing-price">{money(plan.priceMinor, locale)}</div><p className="billing-period">{plan.billingPeriod === "monthly" ? copy.monthly : plan.billingPeriod === "annual" ? copy.annual : copy.oneTime}</p><ul>{planBenefits(plan, locale).map(feature => <li key={feature}><Check aria-hidden="true"/>{feature}</li>)}</ul><button type="button" disabled={!data.provider.enabled || Boolean(pendingPlan)} onClick={() => void choose(plan.planVersionId)}>{pendingPlan === plan.planVersionId ? <LoaderCircle className="spin" aria-hidden="true"/> : <CreditCard aria-hidden="true"/>}{copy.calculate}</button></article>)}</div> : <div className="billing-empty" role="status"><ReceiptText aria-hidden="true"/><div><h2>{copy.noPrices}</h2><p>{copy.noPricesDescription}</p></div></div>}
      <section className="billing-history"><h2><ReceiptText aria-hidden="true"/>{data.provider.sandboxEnabled ? copy.demoHistory : copy.history}</h2>{data.payments.length ? data.payments.map(payment => <div key={payment.id}><strong>{money(payment.amountMinor, locale)}</strong><span>{paymentStatusLabel(payment.status, locale, data.provider.sandboxEnabled)}</span><time dateTime={payment.createdAt}>{formatter.format(new Date(payment.createdAt))}</time></div>) : <p>{copy.emptyHistory}</p>}</section>
    </>}
  </section>;
}
