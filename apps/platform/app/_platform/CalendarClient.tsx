"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  addCalendarDays,
  monthStart,
  nextMonthStart,
  previousMonthStart,
  tashkentToday,
} from "../../lib/platform/calendar";
import {
  formatPlatformLongDate,
  formatPlatformMonth,
} from "../../lib/platform/date-time";
import { platformApiError } from "../../content/platform-ui";
import { usePlatformBasePath } from "./PlatformRouteContext";
import type { PlatformLocale } from "../../lib/platform/routing";

type View = "month" | "week" | "day" | "list" | "cases" | "overdue";
type CalendarItem = {
  planStepId: string;
  taskId: string | null;
  title: string;
  status: string;
  dueAt: string;
  safeDueAt: string | null;
  caseId: string;
  caseTitle: string;
  legalArea: string | null;
  source: "plan_step" | "task" | "consultation";
  startsAt?: string;
  endsAt?: string;
  format?: string;
};
type CalendarResponse = {
  from: string;
  to: string;
  serverToday: string;
  items: CalendarItem[];
};

const labels = {
  ru: {
    title: "Календарь",
    subtitle: "Сроки из планов, подтверждённые задачи и консультации.",
    month: "Месяц",
    week: "Неделя",
    day: "День",
    list: "Список",
    cases: "По делам",
    overdue: "Просрочено",
    previous: "Назад",
    next: "Вперёд",
    loading: "Загружаем сроки…",
    empty: "В этом периоде нет активных сроков.",
    overdueEmpty: "Просроченных сроков нет.",
    open: "Открыть событие",
    task: "Задача",
    step: "Шаг плана",
    consultation: "Консультация",
    phoneConsultation: "Телефонная консультация",
    officeConsultation: "Очная консультация",
    videoConsultation: "Видеоконсультация",
    more: "ещё",
    weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    unavailable: "Календарь временно недоступен.",
  },
  uz: {
    title: "Kalendar",
    subtitle: "Reja muddatlari, tasdiqlangan vazifalar va konsultatsiyalar.",
    month: "Oy",
    week: "Hafta",
    day: "Kun",
    list: "Ro‘yxat",
    cases: "Ishlar bo‘yicha",
    overdue: "Kechikkan",
    previous: "Orqaga",
    next: "Keyingi",
    loading: "Muddatlar yuklanmoqda…",
    empty: "Bu davrda faol muddatlar yo‘q.",
    overdueEmpty: "Kechikkan muddatlar yo‘q.",
    open: "Tadbirni ochish",
    task: "Vazifa",
    step: "Reja qadami",
    consultation: "Konsultatsiya",
    phoneConsultation: "Telefon orqali konsultatsiya",
    officeConsultation: "Ofisdagi konsultatsiya",
    videoConsultation: "Videokonsultatsiya",
    more: "yana",
    weekdays: ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"],
    unavailable: "Kalendar vaqtincha mavjud emas.",
  },
  en: {
    title: "Calendar",
    subtitle: "Deadlines from plans, confirmed tasks and consultations.",
    month: "Month",
    week: "Week",
    day: "Day",
    list: "List",
    cases: "By matter",
    overdue: "Overdue",
    previous: "Previous",
    next: "Next",
    loading: "Loading deadlines…",
    empty: "There are no active deadlines in this period.",
    overdueEmpty: "There are no overdue deadlines.",
    open: "Open event",
    task: "Task",
    step: "Plan step",
    consultation: "Consultation",
    phoneConsultation: "Phone consultation",
    officeConsultation: "In-person consultation",
    videoConsultation: "Video consultation",
    more: "more",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    unavailable: "The calendar is temporarily unavailable.",
  },
} as const;

function startOfWeek(value: string) {
  const weekday = new Date(`${value}T00:00:00.000Z`).getUTCDay() || 7;
  return addCalendarDays(value, 1 - weekday);
}
function displayDate(value: string, locale: PlatformLocale) {
  return formatPlatformLongDate(value, locale);
}
function monthLabel(value: string, locale: PlatformLocale) {
  return formatPlatformMonth(value, locale);
}

export function CalendarClient({ locale }: { locale: PlatformLocale }) {
  const t = labels[locale];
  const base = usePlatformBasePath();
  const caseId=useSearchParams().get("caseId");
  const [view, setView] = useState<View>(caseId ? "list" : "month");
  const [anchor, setAnchor] = useState(() => monthStart(tashkentToday()));
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState("");
  const range = useMemo(() => {
    if (view === "week") {
      const from = startOfWeek(anchor);
      return { from, to: addCalendarDays(from, 7) };
    }
    if (view === "day") return { from: anchor, to: addCalendarDays(anchor, 1) };
    if (view === "list" || view === "cases" || view === "overdue")
      return {
        from: addCalendarDays(monthStart(anchor), -31),
        to: addCalendarDays(nextMonthStart(anchor), 92),
      };
    return { from: monthStart(anchor), to: nextMonthStart(anchor) };
  }, [anchor, view]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/platform/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const body = (await response.json()) as CalendarResponse & {
          error?: string;
        };
        if (!response.ok) throw new Error(platformApiError(locale, body.error, t.unavailable));
        return body;
      })
      .then((body) => {
        setError("");
        setData(body);
      })
      .catch((cause: unknown) => {
        if ((cause as Error).name !== "AbortError")
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [locale, range.from, range.to, t.unavailable]);
  const currentData =
    data?.from === range.from && data.to === range.to ? data : null;
  const visibleItems =
    view === "overdue" && currentData
      ? currentData.items.filter(
          (item) =>
            item.source !== "consultation" &&
            item.dueAt < currentData.serverToday,
        )
      : (currentData?.items ?? []);
  const items=caseId ? visibleItems.filter(item=>item.caseId===caseId) : visibleItems;
  const shift = (direction: -1 | 1) =>
    setAnchor((current) => {
      if (view === "week") return addCalendarDays(current, direction * 7);
      if (view === "day") return addCalendarDays(current, direction);
      return direction === 1
        ? nextMonthStart(current)
        : previousMonthStart(current);
    });
  const byDate = new Map<string, CalendarItem[]>();
  items.forEach((item) =>
    byDate.set(item.dueAt, [...(byDate.get(item.dueAt) ?? []), item]),
  );
  const byCase = new Map<string, CalendarItem[]>();
  items.forEach((item) =>
    byCase.set(item.caseId, [...(byCase.get(item.caseId) ?? []), item]),
  );
  const firstWeekday =
    (new Date(`${monthStart(anchor)}T00:00:00.000Z`).getUTCDay() || 7) - 1;
  const daysInMonth = Math.round(
    (Date.parse(`${nextMonthStart(anchor)}T00:00:00.000Z`) -
      Date.parse(`${monthStart(anchor)}T00:00:00.000Z`)) /
      86_400_000,
  );
  const monthDays = Array.from({ length: daysInMonth }, (_, index) =>
    addCalendarDays(monthStart(anchor), index),
  );
  return (
    <section className="calendar-page" aria-labelledby="calendar-title">
      {caseId && <nav className="matter-breadcrumbs" aria-label={t.title}><Link href={`${base}/action-plan/${encodeURIComponent(caseId)}`}>{ {ru:"Вернуться к плану",uz:"Rejaga qaytish",en:"Back to plan"}[locale]}</Link><Link href={`${base}/calendar`}>{ {ru:"Все сроки",uz:"Barcha muddatlar",en:"All deadlines"}[locale]}</Link></nav>}
      <header className="calendar-header">
        <div>
          <p className="calendar-eyebrow">JURO · {t.title}</p>
          <h1 id="calendar-title">{t.title}</h1>
          <p>{caseId ? {ru:"Сроки выбранного дела. Нажмите на событие, чтобы открыть план.",uz:"Tanlangan ish muddatlari. Rejani ochish uchun hodisani bosing.",en:"Deadlines for this matter. Select an event to open the plan."}[locale] : t.subtitle}</p>
        </div>
        <div className="calendar-range">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label={t.previous}
          >
            <ChevronLeft />
          </button>
          <strong>
            {view === "week"
              ? `${displayDate(range.from, locale)} — ${displayDate(addCalendarDays(range.to, -1), locale)}`
              : view === "day"
                ? displayDate(anchor, locale)
                : monthLabel(anchor, locale)}
          </strong>
          <button type="button" onClick={() => shift(1)} aria-label={t.next}>
            <ChevronRight />
          </button>
        </div>
      </header>
      <div className="calendar-tabs" role="tablist" aria-label={t.title}>
        {(["month", "week", "day", "list", "cases", "overdue"] as View[]).map(
          (name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={view === name}
              onClick={() => setView(name)}
            >
              {t[name]}
            </button>
          ),
        )}
      </div>
      {error && !currentData ? (
        <p className="calendar-error" role="alert">
          <CircleAlert />
          {error}
        </p>
      ) : !currentData ? (
        <p className="calendar-loading" aria-live="polite">
          <LoaderCircle />
          {t.loading}
        </p>
      ) : items.length === 0 ? (
        <div className="calendar-empty">
          <CalendarDays />
          <h2>{view === "overdue" ? t.overdueEmpty : t.empty}</h2>
        </div>
      ) : view === "month" ? (
        <div
          className="calendar-month"
          role="grid"
          aria-label={monthLabel(anchor, locale)}
        >
          {t.weekdays.map((day) => (
            <span key={day} role="columnheader">
              {day}
            </span>
          ))}
          {Array.from({ length: firstWeekday }, (_, index) => (
            <span key={`blank-${index}`} aria-hidden="true" />
          ))}
          {monthDays.map((day) => {
            const dayItems = byDate.get(day) ?? [];
            return (
              <div
                key={day}
                role="gridcell"
                className={
                  day === currentData.serverToday ? "is-today" : undefined
                }
              >
                <time dateTime={day}>{Number(day.slice(-2))}</time>
                {dayItems.slice(0, 3).map((item) => (
                  <CalendarLink
                    key={item.planStepId}
                    item={item}
                    base={base}
                    label={t.open}
                    locale={locale}
                  />
                ))}
                {dayItems.length > 3 && (
                  <button
                    type="button"
                    className="calendar-more"
                    onClick={() => {
                      setAnchor(day);
                      setView("day");
                    }}
                  >{`+${dayItems.length - 3} ${t.more}`}</button>
                )}
              </div>
            );
          })}
        </div>
      ) : view === "cases" ? (
        <div className="calendar-case-list">
          {Array.from(byCase.values()).map((caseItems) => (
            <section key={caseItems[0].caseId}>
              <h2>{caseItems[0].caseTitle}</h2>
              {caseItems.map((item) => (
                <CalendarRow
                  key={item.planStepId}
                  item={item}
                  base={base}
                  label={t.open}
                  locale={locale}
                  task={t.task}
                  step={t.step}
                  consultation={t.consultation}
                />
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="calendar-list">
          {Array.from(byDate.entries()).map(([date, dateItems]) => (
            <section key={date}>
              <h2>
                <time dateTime={date}>{displayDate(date, locale)}</time>
              </h2>
              {dateItems.map((item) => (
                <CalendarRow
                  key={item.planStepId}
                  item={item}
                  base={base}
                  label={t.open}
                  locale={locale}
                  task={t.task}
                  step={t.step}
                  consultation={t.consultation}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function itemHref(item: CalendarItem, base: string) {
  return item.source === "consultation"
    ? `${base}/consultations`
    : `${base}/action-plan/${encodeURIComponent(item.caseId)}`;
}
function CalendarLink({
  item,
  base,
  label,
  locale,
}: {
  item: CalendarItem;
  base: string;
  label: string;
  locale: PlatformLocale;
}) {
  return (
    <Link href={itemHref(item, base)} aria-label={`${label}: ${calendarItemTitle(item, locale)}`}>
      <span>
        {calendarItemTitle(item, locale)}
        {item.source === "consultation" && item.startsAt
          ? ` · ${formatCalendarTime(item.startsAt, locale)}`
          : ""}
      </span>
    </Link>
  );
}
function CalendarRow({
  item,
  base,
  label,
  locale,
  task,
  step,
  consultation,
}: {
  item: CalendarItem;
  base: string;
  label: string;
  locale: PlatformLocale;
  task: string;
  step: string;
  consultation: string;
}) {
  return (
    <Link className="calendar-row" href={itemHref(item, base)}>
      <div>
        <strong>{calendarItemTitle(item, locale)}</strong>
        <span>
          {item.caseTitle} ·{" "}
          {item.source === "consultation"
            ? consultation
            : item.source === "task"
              ? task
              : step}
        </span>
      </div>
      <time dateTime={item.startsAt || item.dueAt}>
        {displayDate(item.dueAt, locale)}
        {item.startsAt ? ` · ${formatCalendarTime(item.startsAt, locale)}` : ""}
      </time>
      <span className={`calendar-status status-${item.status}`}>
        {calendarStatusLabel(item.status, locale)}
      </span>
      <span className="sr-only">{label}</span>
    </Link>
  );
}
function formatCalendarTime(value: string, locale: PlatformLocale) {
  return new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
}

function calendarItemTitle(item: CalendarItem, locale: PlatformLocale) {
  if (item.source !== "consultation") return item.title;
  const copy = labels[locale];
  if (item.format === "phone") return copy.phoneConsultation;
  if (item.format === "office") return copy.officeConsultation;
  return copy.videoConsultation;
}

function calendarStatusLabel(status: string, locale: PlatformLocale) {
  const statuses: Record<string, Record<PlatformLocale, string>> = {
    not_started: { ru: "Не начато", uz: "Boshlanmagan", en: "Not started" },
    planned: { ru: "Запланировано", uz: "Rejalashtirilgan", en: "Planned" },
    in_progress: { ru: "В работе", uz: "Jarayonda", en: "In progress" },
    waiting_user: { ru: "Ожидает пользователя", uz: "Foydalanuvchi kutilmoqda", en: "Awaiting user" },
    waiting_response: { ru: "Ожидает ответа", uz: "Javob kutilmoqda", en: "Awaiting response" },
    waiting_information: { ru: "Ожидает данных", uz: "Ma’lumot kutilmoqda", en: "Awaiting information" },
    waiting_counterparty: { ru: "Ожидает контрагента", uz: "Qarshi tomon kutilmoqda", en: "Awaiting counterparty" },
    overdue: { ru: "Просрочено", uz: "Muddati o‘tgan", en: "Overdue" },
    proposed: { ru: "Предложено", uz: "Taklif qilingan", en: "Proposed" },
    confirmed: { ru: "Подтверждено", uz: "Tasdiqlangan", en: "Confirmed" },
  };
  return statuses[status]?.[locale] ?? status.replaceAll("_", " ");
}
