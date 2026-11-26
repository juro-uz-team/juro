"use client";

import {
  ArrowUpRight, BriefcaseBusiness, Building2, CalendarDays, Check, CircleAlert, FileChartColumn,
  FileCheck2, Files, HardDrive, Layers3, LockKeyhole, MessagesSquare, PanelsTopLeft, Sparkles, WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { subscriptionExtras, subscriptionPlans } from "../../config/pricing";
import type { WorkspaceEntitlements } from "../../lib/billing/entitlements";
import type { companyMemberUsage, workspaceUsage } from "../../lib/billing/usage";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";
import { usePlatformBasePath, usePlatformWorkspaceId } from "./PlatformRouteContext";

type BillingData = {
  workspace: { name: string; type: string; role: string };
  entitlements: WorkspaceEntitlements;
  usage: Awaited<ReturnType<typeof workspaceUsage>>;
  answerLimit?: number;
  members: Awaited<ReturnType<typeof companyMemberUsage>>;
  professional: { status: string } | null;
  subscription: { planCode: string; planNameRu: string | null; planNameUz: string | null; planNameEn: string | null } | null;
  templateCounts: Record<string, { total: number }>;
  payments: { id: string; amountMinor: number; status: string; createdAt: string }[];
};

const icons = { free: Sparkles, starter: FileCheck2, advanced: Layers3, company: Building2, lawyer: BriefcaseBusiness };
const legacyPlanNames = {
  individual: { ru: "Индивидуальный", uz: "Individual tarif", en: "Individual" },
  business: { ru: "Бизнес", uz: "Biznes", en: "Business" },
  legal_team: { ru: "Юридическая команда", uz: "Yuridik jamoa", en: "Legal team" },
} as const;

export function BillingClient({ locale }: { locale: PlatformLocale; accountType: AccountType; workspaceId?: string }) {
  const workspaceId = usePlatformWorkspaceId();
  const base = usePlatformBasePath();
  const [result, setResult] = useState<{ workspaceId: string; data: BillingData | null }>();
  const [attempt, setAttempt] = useState(0);
  const text = (ru: string, uz: string, en: string) => ({ ru, uz, en })[locale];
  const number = new Intl.NumberFormat(({ ru: "ru-UZ", uz: "uz-UZ", en: "en-US" })[locale]);
  const percentage = new Intl.NumberFormat(number.resolvedOptions().locale, { style: "percent", maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(number.resolvedOptions().locale, { dateStyle: "medium", timeZone: "Asia/Tashkent" });
  const money = (minor: number) => number.format(minor / 100) + " " + text("сум", "so‘m", "UZS");
  const load = result?.workspaceId === workspaceId ? result : undefined;
  const data = load?.data;
  const terms = data?.entitlements;
  const active = terms?.readOnly ? undefined : subscriptionPlans.find(plan => plan.code === terms?.planCode);
  const displayedPlan = terms?.readOnly ? subscriptionPlans.find(plan => plan.code === "company") : active;
  const PlanIcon = displayedPlan ? icons[displayedPlan.code] : WalletCards;
  const legacyPlanName = terms && Object.hasOwn(legacyPlanNames, terms.planCode)
    ? legacyPlanNames[terms.planCode as keyof typeof legacyPlanNames][locale] : undefined;
  const savedPlan = data?.subscription?.planCode === terms?.planCode ? data?.subscription : null;
  const savedPlanName = (locale === "ru" ? savedPlan?.planNameRu : locale === "uz" ? savedPlan?.planNameUz : savedPlan?.planNameEn)?.trim();
  const planName = displayedPlan?.name[locale] ?? (savedPlanName || legacyPlanName);
  const answers = text("Ответы ИИ", "AI javoblari", "AI answers");
  const drafts = text("Подготовка документов", "Hujjat tayyorlash", "AI document drafts");
  const pages = text("Страницы анализа", "Tahlil sahifalari", "Analysis pages");
  const cases = text("Активные дела", "Faol ishlar", "Active cases");
  const storage = text("Хранилище", "Xotira", "Storage");
  const currentPlanLabel = text("Ваш тариф", "Joriy tarif", "Your plan");
  const monthlyLabel = text("В месяц", "Oyiga", "Per month");
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
    ["answers", MessagesSquare, answers, data.usage.answers, data.answerLimit ?? terms.limits.answers, number.format],
    ["drafts", FileCheck2, drafts, data.usage.drafts, terms.limits.drafts, number.format],
    ["pages", FileChartColumn, pages, data.usage.pages, terms.limits.pages, number.format],
    ["cases", BriefcaseBusiness, cases, data.usage.cases, terms.limits.activeCases, number.format],
    ["storage", HardDrive, storage, data.usage.bytes, terms.limits.storageBytes, byteLabel],
  ] as const : [];
  const extras = [
    ["answers", MessagesSquare, answers],
    ["drafts", FileCheck2, drafts],
    ["pages", FileChartColumn, pages],
    ["handoff", BriefcaseBusiness, text("Передача дела юристу", "Ishni yuristga topshirish", "Case handoff to a lawyer")],
  ] as const;

  return <div className="workspace-page subscription-page">
    {!data && <h1 className="sr-only">{text("Тариф и оплата", "Tarif va to‘lov", "Plan and billing")}</h1>}
    {!load && <p role="status" className="billing-loading">{text("Загружаем данные пространства…", "Makon ma’lumotlari yuklanmoqda…", "Loading workspace usage…")}</p>}
    {load && !data && <div role="alert" className="billing-error">
      <CircleAlert aria-hidden="true" />
      <span>{text("Не удалось загрузить использование.", "Foydalanish ma’lumotlari yuklanmadi.", "We could not load workspace usage.")}</span>
      <button type="button" onClick={() => { setResult(undefined); setAttempt(value => value + 1); }}>{text("Повторить", "Qayta urinish", "Retry")}</button>
    </div>}
    {data && terms && <section className="subscription-summary" aria-labelledby="active-plan">
      <div className="subscription-summary-heading">
        <div className="subscription-current">
          <span className="subscription-current-icon"><PlanIcon aria-hidden="true" /></span>
          <div>
            <p className="subscription-current-label">{terms.readOnly ? text("Истёкший тариф", "Muddati tugagan tarif", "Expired plan") : currentPlanLabel}</p>
            <h1 id="active-plan">{planName}</h1>
            <p className="subscription-workspace">{data.workspace.name}</p>
          </div>
        </div>
        <div className="subscription-summary-meta">
          {terms.readOnly ? <p className="subscription-cycle"><LockKeyhole aria-hidden="true" />{text("Доступны чтение и экспорт", "O‘qish va eksport qilish mumkin", "Read and export access")}</p>
            : <p className="subscription-cycle">
              <CalendarDays aria-hidden="true" />
              <span>{text("Лимиты обновятся", "Limitlar yangilanadi", "Allowances reset")}</span>
              <time dateTime={terms.periodEnd}>{date.format(new Date(terms.periodEnd))}</time>
            </p>}
          {data.workspace.type === "business" && <Link href={base + "/team"}>{text("Команда", "Jamoa", "Team")}<ArrowUpRight aria-hidden="true" /></Link>}
        </div>
      </div>
      <dl className="subscription-meters">{usage.map(([key, Icon, label, used, limit, format]) => {
        const showLimit = !terms.readOnly && (terms.version !== null || key === "answers") && limit > 0;
        const usedLabel = format(used);
        const limitLabel = format(limit);
        return <div key={key} data-tone={key} data-limit={showLimit && used >= limit ? "reached" : undefined}>
          <dt><Icon aria-hidden="true" />{label}</dt>
          <dd>
            <div className="subscription-meter-value"><strong>{usedLabel}</strong>{showLimit && <span> / {limitLabel}</span>}</div>
            {showLimit && <div className="subscription-meter-track">
              <progress aria-label={label} aria-valuetext={text(`${usedLabel} из ${limitLabel}`, `${usedLabel} / ${limitLabel}`, `${usedLabel} of ${limitLabel}`)} max={limit} value={Math.min(used, limit)} />
              <span aria-hidden="true">{percentage.format(used / limit)}</span>
            </div>}
          </dd>
        </div>;
      })}</dl>
      {data.professional && <p className="subscription-profile"><BriefcaseBusiness aria-hidden="true" />{data.professional.status === "public_approved"
        ? text("Профиль опубликован", "Profil e’lon qilingan", "Professional profile published")
        : text("Профиль ещё не опубликован", "Profil hali e’lon qilinmagan", "Professional profile awaiting publication")}</p>}
    </section>}
    <section aria-labelledby="plan-catalogue" className="subscription-catalogue">
      <div className="subscription-section-heading">
        <h2 id="plan-catalogue">{text("Сравнить тарифы", "Tariflarni solishtirish", "Compare plans")}</h2>
        <p className="subscription-notice"><LockKeyhole aria-hidden="true" />{text("Покупка и продление пока недоступны", "Sotib olish va uzaytirish hozircha mavjud emas", "Purchases and renewals are currently unavailable")}</p>
      </div>
      <div className="subscription-grid">
        {subscriptionPlans.map(plan => {
          const Icon = icons[plan.code];
          const selected = active?.code === plan.code;
          const templates = data?.templateCounts[plan.code];
          const labels = [answers, drafts, pages, text("Страниц за запуск", "Bir tahlilda sahifalar", "Pages per run"), cases, storage, text("Размер файла", "Fayl hajmi", "Per file")];
          const quantities = [plan.limits.answers, plan.limits.drafts, plan.limits.pages, plan.limits.pagesPerRun,
            plan.limits.activeCases, byteLabel(plan.limits.storageBytes), byteLabel(plan.limits.fileBytes)];
          return <article key={plan.code} className={selected ? "subscription-card selected" : "subscription-card"} data-plan={plan.code} data-tone={plan.code}>
            <header className="subscription-card-cover">
              <Icon className="subscription-card-watermark" aria-hidden="true" />
              <div className="subscription-card-mark">
                <span><Icon aria-hidden="true" /></span>
                {selected && <small><Check aria-hidden="true" />{currentPlanLabel}</small>}
              </div>
              <h3>{plan.name[locale]}</h3>
              <p>{plan.audience[locale]}</p>
              <div className="subscription-card-price"><strong>{money(plan.priceMinor)}</strong><small>{monthlyLabel}</small></div>
            </header>
            <div className="subscription-card-body">
              <p className="subscription-card-benefit"><Check aria-hidden="true" />{plan.benefit[locale]}</p>
              <dl className="subscription-card-limits">{labels.map((label, index) => <div key={label}><dt>{label}</dt><dd>{quantities[index]}</dd></div>)}</dl>
              {templates && <dl className="subscription-card-templates"><div>
                <dt><PanelsTopLeft aria-hidden="true" />{text("Шаблоны", "Andozalar", "Templates")}</dt>
                <dd>{number.format(templates.total)}</dd>
              </div></dl>}
            </div>
          </article>;
        })}
      </div>
    </section>
    <section className="subscription-extras" aria-labelledby="extras-title">
      <div className="subscription-section-heading">
        <h2 id="extras-title"><Files aria-hidden="true" />{text("Дополнительные услуги", "Qo‘shimcha xizmatlar", "Optional services")}</h2>
        <p className="subscription-notice"><LockKeyhole aria-hidden="true" />{text("Покупка пока недоступна", "Sotib olish hozircha mavjud emas", "Currently unavailable to purchase")}</p>
      </div>
      <dl className="subscription-extra-grid">{extras.map(([key, Icon, label]) => <div key={key} data-tone={key}>
        <dt><span className="subscription-extra-icon"><Icon aria-hidden="true" /></span><span>{label}</span></dt>
        <dd><strong>{money(subscriptionExtras[key].priceMinor)}</strong>{key !== "handoff" && <span>+{number.format(subscriptionExtras[key].units)}</span>}</dd>
      </div>)}</dl>
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
