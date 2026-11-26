"use client";

import { BriefcaseBusiness, Building2, FileCheck2, Layers3, Sparkles, WalletCards } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { subscriptionExtras, subscriptionPlans } from "../../config/pricing";
import type { WorkspaceEntitlements } from "../../lib/billing/entitlements";
import type { companyMemberUsage, workspaceUsage } from "../../lib/billing/usage";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";
import { usePlatformBasePath, usePlatformWorkspaceId } from "./PlatformRouteContext";
import { WorkspaceTitle } from "./WorkspaceTitle";

type BillingData = {
  workspace: { name: string; type: string; role: string };
  entitlements: WorkspaceEntitlements;
  usage: Awaited<ReturnType<typeof workspaceUsage>>;
  members: Awaited<ReturnType<typeof companyMemberUsage>>;
  professional: { status: string } | null;
  templateCounts: Record<string, Record<PlatformLocale, number>>;
  payments: { id: string; amountMinor: number; status: string; createdAt: string }[];
};

const icons = { free: Sparkles, starter: FileCheck2, advanced: Layers3, company: Building2, lawyer: BriefcaseBusiness };

export function BillingClient({ locale }: { locale: PlatformLocale; accountType: AccountType; workspaceId?: string }) {
  const workspaceId = usePlatformWorkspaceId();
  const base = usePlatformBasePath();
  const [result, setResult] = useState<{ workspaceId: string; data: BillingData | null }>();
  const [attempt, setAttempt] = useState(0);
  const text = (ru: string, uz: string, en: string) => ({ ru, uz, en })[locale];
  const number = new Intl.NumberFormat(({ ru: "ru-UZ", uz: "uz-UZ", en: "en-US" })[locale]);
  const date = new Intl.DateTimeFormat(number.resolvedOptions().locale, { dateStyle: "medium", timeZone: "Asia/Tashkent" });
  const money = (minor: number) => number.format(minor / 100) + " " + text("сум", "so‘m", "UZS");
  const load = result?.workspaceId === workspaceId ? result : undefined;
  const data = load?.data;
  const terms = data?.entitlements;
  const active = subscriptionPlans.find(plan => plan.code === terms?.planCode);
  const planName = active?.name[locale] ?? text("Действующий тариф", "Amaldagi tarif", "Existing plan");
  const answers = text("Ответы ИИ", "AI javoblari", "AI answers");
  const drafts = text("Подготовка документов", "Hujjat tayyorlash", "AI document drafts");
  const pages = text("Страницы анализа", "Tahlil sahifalari", "Analysis pages");
  const cases = text("Активные дела", "Faol ishlar", "Active cases");
  const storage = text("Хранилище", "Xotira", "Storage");
  const byteLabel = (value: number) => value >= 1_000_000_000
    ? number.format(value / 1_000_000_000) + " GB"
    : number.format(Math.round(value / 100_000) / 10) + " MB";

  useEffect(() => {
    const request = new AbortController();
    void fetch("/api/platform/billing", {
      cache: "no-store", headers: { "x-juro-workspace-id": workspaceId }, signal: request.signal,
    }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json() as BillingData;
      if (!request.signal.aborted) setResult({ workspaceId, data });
    }).catch(() => {
      if (!request.signal.aborted) setResult({ workspaceId, data: null });
    });
    return () => request.abort();
  }, [workspaceId, attempt]);

  const usage = data && terms ? [
    [answers, data.usage.answers, terms.limits.answers],
    [drafts, data.usage.drafts, terms.limits.drafts],
    [pages, data.usage.pages, terms.limits.pages],
    [cases, data.usage.cases, terms.limits.activeCases],
    [storage, data.usage.bytes, terms.limits.storageBytes],
  ] as const : [];

  return <div className="workspace-page subscription-page">
    <WorkspaceTitle icon={<WalletCards />} title={text("Тариф и оплата", "Tarif va to‘lov", "Plan and billing")} />
    {!load && <p role="status">{text("Загружаем данные пространства…", "Makon ma’lumotlari yuklanmoqda…", "Loading workspace usage…")}</p>}
    {load && !data && <div role="alert" className="subscription-notice">
      {text("Не удалось загрузить использование.", "Foydalanish ma’lumotlari yuklanmadi.", "We could not load workspace usage.")}
      <button type="button" onClick={() => { setResult(undefined); setAttempt(value => value + 1); }}>{text("Повторить", "Qayta urinish", "Retry")}</button>
    </div>}
    {data && terms && <section className="subscription-summary" aria-labelledby="active-plan">
      <div className="subscription-summary-heading">
        <div><p>{data.workspace.name}</p><h2 id="active-plan">{planName}</h2></div>
        <div>
          {terms.readOnly
            ? text("Срок тарифа истёк · чтение и экспорт", "Tarif tugadi · o‘qish va eksport", "Term expired · read and export")
            : text("Лимиты обновятся ", "Limitlar yangilanadi ", "Allowances reset ") + date.format(new Date(terms.periodEnd))}
          {data.workspace.type === "business" && <Link href={base + "/team"}>{text("Команда", "Jamoa", "Team")}</Link>}
        </div>
      </div>
      <dl className="subscription-meters">{usage.map(([label, used, limit], index) => {
        const format = index === 4 ? byteLabel : (value: number) => number.format(value);
        const showLimit = terms.version !== null || index === 0;
        return <div key={label}>
          <dt>{label}</dt><dd><b>{format(used)}</b>{showLimit && <> / {format(limit)}</>}</dd>
          {showLimit && <progress aria-label={label} max={limit} value={Math.min(used, limit)} />}
        </div>;
      })}</dl>
      {data.professional && <p>{data.professional.status === "public_approved"
        ? text("Профиль опубликован", "Profil e’lon qilingan", "Professional profile published")
        : text("Профиль ещё не опубликован", "Profil hali e’lon qilinmagan", "Professional profile awaiting publication")}</p>}
    </section>}
    <p className="subscription-notice">{text("Оформление и продление пока недоступны. Действующие тарифы и бесплатный доступ продолжают работать.", "Tarif sotib olish va uzaytirish hozircha mavjud emas. Amaldagi tariflar va bepul kirish ishlashda davom etadi.", "Plan purchases and renewals are currently unavailable. Existing plans and Free access remain active.")}</p>
    <section aria-labelledby="plan-catalogue" className="subscription-catalogue">
      <h2 id="plan-catalogue">{text("Сравнить тарифы", "Tariflarni solishtirish", "Compare plans")}</h2>
      <div className="subscription-grid">
        {subscriptionPlans.map(plan => {
          const Icon = icons[plan.code];
          const selected = active?.code === plan.code;
          const labels = [answers, drafts, pages, text("Страниц за запуск", "Bir tahlilda sahifalar", "Pages per run"), cases, storage, text("Размер файла", "Fayl hajmi", "Per file")];
          const quantities = [plan.limits.answers, plan.limits.drafts, plan.limits.pages, plan.limits.pagesPerRun,
            plan.limits.activeCases, byteLabel(plan.limits.storageBytes), byteLabel(plan.limits.fileBytes)];
          return <article key={plan.code} className={selected ? "subscription-card selected" : "subscription-card"} data-plan={plan.code}>
            <header><Icon aria-hidden="true" />{selected && <span>{text("Ваш тариф", "Joriy tarif", "Your plan")}</span>}</header>
            <h3>{plan.name[locale]}</h3><p>{plan.audience[locale]}</p>
            <strong>{money(plan.priceMinor)}</strong><small>{text("в месяц", "oyiga", "per month")}</small>
            <p>{plan.benefit[locale]}</p>
            <dl>{labels.map((label, index) => <div key={label}><dt>{label}</dt><dd>{quantities[index]}</dd></div>)}
              {data && <div><dt>{text("Шаблоны на русском", "O‘zbekcha andozalar", "English templates")}</dt>
                <dd>{data.templateCounts[plan.code][locale]}</dd></div>}
            </dl>
          </article>;
        })}
      </div>
    </section>
    <section className="subscription-extras" aria-labelledby="extras-title">
      <h2 id="extras-title">{text("Дополнительные услуги", "Qo‘shimcha xizmatlar", "Optional services")}</h2>
      <dl>{([
        [answers + " · +100", subscriptionExtras.answers.priceMinor],
        [drafts + " · +5", subscriptionExtras.drafts.priceMinor],
        [pages + " · +50", subscriptionExtras.pages.priceMinor],
        [text("Передача дела юристу", "Ishni yuristga topshirish", "Case handoff to a lawyer"), subscriptionExtras.handoff.priceMinor],
      ] as const).map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{money(amount)}</dd></div>)}</dl>
    </section>
    {!!data?.members.length && <details className="subscription-details">
      <summary>{text("Использование по участникам", "A’zolar bo‘yicha foydalanish", "Usage by member")}</summary>
      <table><thead><tr><th scope="col">{text("Участник", "A’zo", "Member")}</th><th scope="col">{answers}</th><th scope="col">{drafts}</th><th scope="col">{pages}</th></tr></thead>
        <tbody>{data.members.map(member => <tr key={member.userId}><th scope="row">{member.name}</th><td>{member.answers}</td><td>{member.drafts}</td><td>{member.pages}</td></tr>)}</tbody>
      </table>
    </details>}
    {!!data?.payments.length && <details className="subscription-details">
      <summary>{text("История платежей", "To‘lovlar tarixi", "Financial history")}</summary>
      <ul>{data.payments.map(payment => <li key={payment.id}>{date.format(new Date(payment.createdAt))} · {money(payment.amountMinor)} · {
        ({ paid: text("Оплачен", "To‘langan", "Paid"), settled: text("Завершён", "Yakunlangan", "Settled"), refunded: text("Возвращён", "Qaytarilgan", "Refunded") } as Record<string, string>)[payment.status] ?? payment.status
      }</li>)}</ul>
    </details>}
  </div>;
}
