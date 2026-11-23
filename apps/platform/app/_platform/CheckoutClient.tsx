"use client";

import { WorkspaceTitle } from "./WorkspaceTitle";

/* eslint-disable react-hooks/set-state-in-effect -- the order is intentionally read from the authenticated API */

import { ArrowLeft, Check, CircleAlert, FileCheck2, LoaderCircle, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { platformBasePath, type AccountType, type PlatformLocale } from "../../lib/platform/routing";

type CheckoutView = {
  order: { id: string; status: string; totalAmountMinor: number; currency: string; expiresAt: string | null };
  items: Array<{ id: string; titleRu: string; titleUz: string; titleEn?: string | null; baseAmountMinor: number; taxAmountMinor: number; totalAmountMinor: number }>;
  pricingSnapshot: { id: string; juroBaseAmountMinor: number; juroVatAmountMinor: number; clientTotalMinor: number } | null;
  invoice: { invoiceNumber: string; status: string; dueAt: string | null } | null;
  paymentAttempt: { internalStatus: string; checkoutUrl: string | null } | null;
};

const checkoutCopy = {
  ru: { currency: "сум", missing: "Заказ не найден.", confirmFailed: "Подтверждение не выполнено.", loading: "Загружаем расчёт…", back: "К тарифам", opening: "Открываем оплату…", title: "Проверьте расчёт", description: "Цена зафиксирована в неизменяемом снимке. Оплата не активирует подписку до подтверждённого события провайдера.", order: "Заказ", subscription: "Подписка JURO", cost: "Стоимость", tax: "Налог", total: "Итого к оплате", invoice: "Счёт", renewal: "Порядок продления", renewalLegend: "Выберите порядок продления", oneTime: "Один платёж", oneTimeDescription: "Без автоматического продления", autoRenew: "Автопродление", autoRenewDescription: "Требует отдельного согласия и может быть отключено", consent: "Я проверил сумму и подтверждаю выбранный порядок продления.", action: "Подтвердить и перейти к оплате", note: "Staging использует тестовый провайдер: реальные деньги не списываются." },
  uz: { currency: "so‘m", missing: "Buyurtma topilmadi.", confirmFailed: "Tasdiqlash bajarilmadi.", loading: "Hisob-kitob yuklanmoqda…", back: "Tariflarga", opening: "To‘lov ochilmoqda…", title: "Hisob-kitobni tekshiring", description: "Narx o‘zgarmas suratda qayd etilgan. Provayder tasdiqlagan hodisagacha obuna faollashmaydi.", order: "Buyurtma", subscription: "JURO obunasi", cost: "Narx", tax: "Soliq", total: "Jami to‘lov", invoice: "Hisob", renewal: "Uzaytirish tartibi", renewalLegend: "Uzaytirish tartibini tanlang", oneTime: "Bir martalik to‘lov", oneTimeDescription: "Avtomatik uzaytirishsiz", autoRenew: "Avtomatik uzaytirish", autoRenewDescription: "Alohida rozilik talab qiladi va o‘chirilishi mumkin", consent: "Summani tekshirdim va tanlangan uzaytirish tartibini tasdiqlayman.", action: "Tasdiqlash va to‘lovga o‘tish", note: "Staging sinov provayderidan foydalanadi: haqiqiy pul yechilmaydi." },
  en: { currency: "UZS", missing: "Order not found.", confirmFailed: "We could not confirm this order.", loading: "Loading your order…", back: "Back to plans", opening: "Opening payment…", title: "Review your order", description: "The price is stored in an immutable snapshot. Your subscription activates only after a verified provider event.", order: "Order", subscription: "JURO subscription", cost: "Price", tax: "Tax", total: "Total due", invoice: "Invoice", renewal: "Renewal preference", renewalLegend: "Choose a renewal preference", oneTime: "One-time payment", oneTimeDescription: "No automatic renewal", autoRenew: "Automatic renewal", autoRenewDescription: "Requires separate consent and can be disabled", consent: "I have reviewed the amount and confirm my selected renewal preference.", action: "Confirm and continue to payment", note: "Staging uses a test provider. No real money is charged." },
} as const;

function money(value: number, locale: PlatformLocale) {
  const numberLocale = { ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale];
  return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 }).format(value / 100)} ${checkoutCopy[locale].currency}`;
}

export function CheckoutClient({ locale, accountType, orderId, workspaceId }: { locale: PlatformLocale; accountType: AccountType; orderId: string; workspaceId?: string }) {
  const copy = checkoutCopy[locale];
  const router = useRouter();
  const [view, setView] = useState<CheckoutView | null>(null);
  const [renewalMode, setRenewalMode] = useState<"ONE_TIME" | "AUTO_RENEW">("ONE_TIME");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const workspaceQuery = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
      const response = await fetch(`/api/checkout/${encodeURIComponent(orderId)}${workspaceQuery}`, { cache: "no-store" });
      const body = await response.json() as CheckoutView & { code?: string; error?: string };
      if (!response.ok || !body.order) throw new Error(body.error || body.code || copy.missing);
      setView(body);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [copy.missing, orderId, workspaceId]);
  useEffect(() => { void load(); }, [load]);

  async function confirm() {
    if (!accepted || !view) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/checkout/${encodeURIComponent(orderId)}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), locale, accountType, renewalMode, paymentMethod: "SANDBOX_CARD", ...(workspaceId ? { workspaceId } : {}) }),
      });
      const body = await response.json() as { error?: string; code?: string };
      if (!response.ok) throw new Error(body.error || body.code || copy.confirmFailed);
      router.push(`${platformBasePath(locale, accountType, workspaceId)}/orders/${encodeURIComponent(orderId)}/payment`);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setSubmitting(false);
    }
  }

  if (loading) return <div className="billing-loading" role="status"><LoaderCircle className="spin"/><span>{copy.loading}</span></div>;
  const basePath = platformBasePath(locale, accountType, workspaceId);
  if (!view) return <section className="checkout-workspace"><Link className="checkout-back" href={`${basePath}/billing`}><ArrowLeft/>{copy.back}</Link><p className="billing-error" role="alert"><CircleAlert/>{error}</p></section>;
  if (view.order.status === "AWAITING_PAYMENT" || view.order.status === "ACTIVE") {
    router.replace(`${basePath}/orders/${encodeURIComponent(orderId)}/payment`);
    return <div className="billing-loading" role="status"><LoaderCircle className="spin"/><span>{copy.opening}</span></div>;
  }
  const item = view.items[0];
  const snapshot = view.pricingSnapshot;
  return <section className="checkout-workspace workspace-page">
    <Link className="checkout-back" href={`${basePath}/billing`}><ArrowLeft aria-hidden="true"/>{copy.back}</Link>
    <WorkspaceTitle icon={<LockKeyhole />} title={copy.title} description={copy.description} />
    {error && <p className="billing-error" role="alert"><CircleAlert/>{error}</p>}
    <div className="checkout-grid">
      <article className="checkout-summary"><div className="checkout-title"><FileCheck2/><div><small>{copy.order}</small><h2>{item ? (locale === "ru" ? item.titleRu : locale === "uz" ? item.titleUz : item.titleEn || copy.subscription) : copy.subscription}</h2></div></div><dl><div><dt>{copy.cost}</dt><dd>{money(snapshot?.juroBaseAmountMinor ?? 0, locale)}</dd></div><div><dt>{copy.tax}</dt><dd>{money(snapshot?.juroVatAmountMinor ?? 0, locale)}</dd></div><div className="checkout-total"><dt>{copy.total}</dt><dd>{money(snapshot?.clientTotalMinor ?? view.order.totalAmountMinor, locale)}</dd></div></dl><p className="checkout-invoice">{copy.invoice}: <strong>{view.invoice?.invoiceNumber ?? "—"}</strong></p></article>
      <article className="checkout-confirm"><h2>{copy.renewal}</h2><fieldset><legend className="sr-only">{copy.renewalLegend}</legend><label><input type="radio" name="renewal" checked={renewalMode === "ONE_TIME"} onChange={() => setRenewalMode("ONE_TIME")}/><span><strong>{copy.oneTime}</strong><small>{copy.oneTimeDescription}</small></span></label><label><input type="radio" name="renewal" checked={renewalMode === "AUTO_RENEW"} onChange={() => setRenewalMode("AUTO_RENEW")}/><span><strong>{copy.autoRenew}</strong><small>{copy.autoRenewDescription}</small></span></label></fieldset><label className="checkout-consent"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/><span>{copy.consent}</span></label><button type="button" disabled={!accepted || submitting} onClick={() => void confirm()}>{submitting ? <LoaderCircle className="spin"/> : <Check/>}{copy.action}</button><p className="checkout-note">{copy.note}</p></article>
    </div>
  </section>;
}
