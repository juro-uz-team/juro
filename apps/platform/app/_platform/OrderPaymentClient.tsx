"use client";

import { WorkspaceTitle } from "./WorkspaceTitle";

/* eslint-disable react-hooks/set-state-in-effect -- provider-confirmed order state is read after every action */

import { ArrowLeft, CheckCircle2, CircleAlert, CreditCard, LoaderCircle, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { platformBasePath, type AccountType, type PlatformLocale } from "../../lib/platform/routing";

type PaymentView = {
  availability?: { sandboxEnabled?: boolean };
  order: { id: string; orderType: string; status: string; totalAmountMinor: number; providerStatus: string | null; settledAt: string | null };
  invoice: { invoiceNumber: string; status: string; paidAt: string | null } | null;
  paymentAttempt: { internalStatus: string; providerStatus: string | null; amountMinor: number } | null;
};

const paymentCopy = {
  ru: { currency: "сум", missing: "Заказ не найден.", providerRejected: "Провайдер отклонил запрос.", loading: "Проверяем статус оплаты…", back: "Тариф и платежи", confirmed: "Оплата подтверждена", declined: "Оплата отклонена", confirmation: "Подтверждение оплаты", serviceActive: "Услуга активирована после проверенного серверного события. Создано обязательство перед юристом; выплата остаётся на безопасном hold до settlement.", subscriptionActive: "Подписка активирована только после проверенного серверного события. Платёж и проводки сохранены.", stagingDescription: "В staging можно проверить успешный и отклонённый сценарии без списания реальных денег.", amount: "Сумма", invoice: "Счёт", status: "Статус", paid: "Оплачен", rejected: "Отклонён", pending: "Ожидает подтверждения", returnToBilling: "Вернуться к тарифу", repeatTest: "Повторить тест", chooseProvider: "Выберите ответ провайдера", sandboxDescription: "Кнопка отправляет подписанное серверное событие через тот же обработчик, который активирует подписку.", testPay: "Тест: оплатить", testDecline: "Тест: отклонить", awaitingProvider: "Ожидаем платёжного провайдера", awaitingDescription: "Статус обновится только после проверенного webhook. Перезагрузите страницу позже.", checkAgain: "Проверить снова" },
  uz: { currency: "so‘m", missing: "Buyurtma topilmadi.", providerRejected: "Provayder so‘rovni rad etdi.", loading: "To‘lov holati tekshirilmoqda…", back: "Tarif va to‘lovlar", confirmed: "To‘lov tasdiqlandi", declined: "To‘lov rad etildi", confirmation: "To‘lovni tasdiqlash", serviceActive: "Xizmat tekshirilgan server hodisasidan keyin faollashdi. Yurist oldidagi majburiyat yaratildi; to‘lov settlementgacha xavfsiz hold’da.", subscriptionActive: "Obuna faqat tekshirilgan server hodisasidan keyin faollashtirildi. To‘lov va yozuvlar saqlandi.", stagingDescription: "Stagingda haqiqiy pul yechmasdan muvaffaqiyatli va rad etilgan ssenariylarni tekshirish mumkin.", amount: "Summa", invoice: "Hisob", status: "Holat", paid: "To‘langan", rejected: "Rad etilgan", pending: "Tasdiqlash kutilmoqda", returnToBilling: "Tarifga qaytish", repeatTest: "Sinovni takrorlash", chooseProvider: "Provayder javobini tanlang", sandboxDescription: "Tugma obunani faollashtiradigan ayni ishlovchi orqali imzolangan server hodisasini yuboradi.", testPay: "Sinov: to‘lash", testDecline: "Sinov: rad etish", awaitingProvider: "To‘lov provayderi kutilmoqda", awaitingDescription: "Holat faqat tekshirilgan webhookdan keyin yangilanadi. Sahifani keyinroq yangilang.", checkAgain: "Qayta tekshirish" },
  en: { currency: "UZS", missing: "Order not found.", providerRejected: "The payment provider declined the request.", loading: "Checking payment status…", back: "Billing and payments", confirmed: "Payment confirmed", declined: "Payment declined", confirmation: "Payment confirmation", serviceActive: "The service was activated only after a verified server event. The lawyer obligation has been recorded and the payout remains safely on hold until settlement.", subscriptionActive: "The subscription was activated only after a verified server event. The payment and ledger entries have been recorded.", stagingDescription: "In staging, you can test approved and declined outcomes without charging real money.", amount: "Amount", invoice: "Invoice", status: "Status", paid: "Paid", rejected: "Declined", pending: "Awaiting confirmation", returnToBilling: "Back to billing", repeatTest: "Run another test", chooseProvider: "Choose the provider response", sandboxDescription: "This sends a signed server event through the same handler used to activate a subscription.", testPay: "Test: approve", testDecline: "Test: decline", awaitingProvider: "Waiting for the payment provider", awaitingDescription: "The status changes only after a verified webhook. Check again later.", checkAgain: "Check again" },
} as const;

function money(value: number, locale: PlatformLocale) {
  const numberLocale = { ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale];
  return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 }).format(value / 100)} ${paymentCopy[locale].currency}`;
}

export function OrderPaymentClient({ locale, accountType, orderId, workspaceId }: { locale: PlatformLocale; accountType: AccountType; orderId: string; workspaceId?: string }) {
  const copy = paymentCopy[locale];
  const [view, setView] = useState<PaymentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<"FUNDED" | "DECLINED" | "">("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const workspaceQuery = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
      const response = await fetch(`/api/checkout/${encodeURIComponent(orderId)}${workspaceQuery}`, { cache: "no-store" });
      const body = await response.json() as PaymentView & { code?: string; error?: string };
      if (!response.ok || !body.order) throw new Error(body.error || copy.missing);
      setView(body);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  }, [copy.missing, orderId, workspaceId]);
  useEffect(() => { void load(); }, [load]);

  async function authorize(outcome: "FUNDED" | "DECLINED") {
    setProcessing(outcome);
    setError("");
    try {
      const response = await fetch(`/api/checkout/${encodeURIComponent(orderId)}/sandbox-authorize`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), locale, outcome, ...(workspaceId ? { workspaceId } : {}) }),
      });
      const body = await response.json() as { code?: string; error?: string };
      if (!response.ok) throw new Error(body.error || copy.providerRejected);
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setProcessing(""); }
  }

  if (loading) return <div className="billing-loading" role="status"><LoaderCircle className="spin"/><span>{copy.loading}</span></div>;
  if (!view) return <section className="checkout-workspace"><p className="billing-error" role="alert"><CircleAlert/>{error}</p></section>;
  const active = view.order.status === "ACTIVE" && (view.order.orderType === "LEGAL_SERVICE" || view.invoice?.status === "paid");
  const failed = view.paymentAttempt?.internalStatus === "failed";
  const basePath = platformBasePath(locale, accountType, workspaceId);
  const service = view.order.orderType === "LEGAL_SERVICE";
  return <section className="checkout-workspace payment-status-workspace workspace-page">
    <Link className="checkout-back" href={`${basePath}/billing`}><ArrowLeft/>{copy.back}</Link>
  <WorkspaceTitle icon={active ? <CheckCircle2 /> : <ShieldCheck />} title={active ? copy.confirmed : failed ? copy.declined : copy.confirmation} description={active ? (service ? copy.serviceActive : copy.subscriptionActive) : copy.stagingDescription} />
    {error && <p className="billing-error" role="alert"><CircleAlert/>{error}</p>}
    <article className="payment-card"><div><span>{copy.amount}</span><strong>{money(view.order.totalAmountMinor, locale)}</strong></div><div><span>{copy.invoice}</span><strong>{view.invoice?.invoiceNumber ?? "—"}</strong></div><div><span>{copy.status}</span><strong>{active ? copy.paid : failed ? copy.rejected : copy.pending}</strong></div></article>
    {active ? <div className="payment-actions"><Link className="payment-primary" href={`${basePath}/billing`}><CheckCircle2/>{copy.returnToBilling}</Link></div> : view.availability?.sandboxEnabled ? <div className="sandbox-panel"><div><small>STAGING SANDBOX</small><h2>{failed ? copy.repeatTest : copy.chooseProvider}</h2><p>{copy.sandboxDescription}</p></div><div className="sandbox-actions"><button type="button" disabled={Boolean(processing)} onClick={() => void authorize("FUNDED")}>{processing === "FUNDED" ? <LoaderCircle className="spin"/> : <CreditCard/>}{copy.testPay}</button><button type="button" className="secondary" disabled={Boolean(processing)} onClick={() => void authorize("DECLINED")}>{processing === "DECLINED" ? <LoaderCircle className="spin"/> : <CircleAlert/>}{copy.testDecline}</button></div></div> : <div className="billing-empty"><ShieldCheck/><div><h2>{copy.awaitingProvider}</h2><p>{copy.awaitingDescription}</p><button type="button" onClick={() => { setLoading(true); void load(); }}><RotateCcw/>{copy.checkAgain}</button></div></div>}
  </section>;
}
