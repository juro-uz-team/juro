"use client";

import Link from "next/link";
import { CalendarClock, CalendarDays, CheckCircle2, ChevronRight, Clock3, ListChecks, LoaderCircle, ShieldCheck, UserRoundCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { platformApiError } from "../../content/platform-ui";
import type { WorkspaceEntitlements } from "../../lib/billing/entitlements";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";
import { usePlatformBasePath, usePlatformWorkspaceId } from "./PlatformRouteContext";
import { LawyerHandoffClient } from "./LawyerHandoffClient";
import { WorkspacePagination } from "./WorkspacePagination";
import { WorkspaceTitle } from "./WorkspaceTitle";
import "./consultations-workspace.css";

type Slot = { id: string; specialistType: string; startsAt: string; endsAt: string };
type Booking = Slot & { status: string };
type View = "times" | "requests" | "lawyer";

const copy = {
  ru: {
    title: "Консультации", times: "Свободное время", requests: "Мои записи", lawyer: "Заявка юристу",
    chooseDate: "Выберите дату", chooseTime: "Выберите время", timezone: "Ташкент · UTC+5",
    operator: "Оператор", specialist: "Юрист", empty: "Свободного времени пока нет",
    emptyHint: "Можно оставить заявку юристу и указать удобное время.", noRequests: "У вас пока нет записей",
    plan: "Запись доступна на платном тарифе", viewPlans: "Посмотреть тарифы", details: "Выбранное время",
    confirm: "Отправить заявку", close: "Закрыть",
    price: "Специалист подтвердит время и сообщит стоимость.", consent: "Разрешаю передать только выбранные материалы.",
    comparison: "Сравнение к заявке", loading: "Загружаем консультации…", sending: "Отправляем…",
    retry: "Повторить", failed: "Не удалось загрузить консультации.", requestError: "Не удалось отправить заявку.",
    unavailable: "Запись недоступна на текущем тарифе.", slotUnavailable: "Это время уже недоступно. Выберите другое.",
    contextUnavailable: "Выбранное сравнение недоступно.", success: "Заявка отправлена",
    beforeBooking: "Как проходит запись",
  },
  uz: {
    title: "Maslahatlar", times: "Bo‘sh vaqtlar", requests: "Yozuvlarim", lawyer: "Yuristga so‘rov",
    chooseDate: "Sanani tanlang", chooseTime: "Vaqtni tanlang", timezone: "Toshkent · UTC+5",
    operator: "Operator", specialist: "Yurist", empty: "Hozircha bo‘sh vaqt yo‘q",
    emptyHint: "Yuristga so‘rov yuborib, qulay vaqtni ko‘rsatishingiz mumkin.", noRequests: "Hozircha yozuvlaringiz yo‘q",
    plan: "Yozilish pullik tarifda mavjud", viewPlans: "Tariflarni ko‘rish", details: "Tanlangan vaqt",
    confirm: "So‘rovni yuborish", close: "Yopish",
    price: "Mutaxassis vaqtni tasdiqlaydi va narxni ma’lum qiladi.", consent: "Faqat tanlangan materiallarni ulashishga roziman.",
    comparison: "So‘rovga qo‘shilgan taqqoslash", loading: "Maslahatlar yuklanmoqda…", sending: "Yuborilmoqda…",
    retry: "Qayta urinish", failed: "Maslahatlar yuklanmadi.", requestError: "So‘rov yuborilmadi.",
    unavailable: "Joriy tarifda yozilish mavjud emas.", slotUnavailable: "Bu vaqt band. Boshqa vaqtni tanlang.",
    contextUnavailable: "Tanlangan taqqoslash mavjud emas.", success: "So‘rov yuborildi",
    beforeBooking: "Yozilish tartibi",
  },
  en: {
    title: "Consultations", times: "Available times", requests: "My bookings", lawyer: "Request a lawyer",
    chooseDate: "Choose a date", chooseTime: "Choose a time", timezone: "Tashkent · UTC+5",
    operator: "Operator", specialist: "Lawyer", empty: "No appointment times available",
    emptyHint: "Send a lawyer request and suggest a time that suits you.", noRequests: "You have no bookings yet",
    plan: "Bookings are available on a paid plan", viewPlans: "View plans", details: "Selected appointment",
    confirm: "Send booking request", close: "Close",
    price: "The specialist will confirm the time and share the price.", consent: "I agree to share only the selected materials.",
    comparison: "Comparison attached to this request", loading: "Loading consultations…", sending: "Sending…",
    retry: "Try again", failed: "We could not load consultations.", requestError: "We could not send the request.",
    unavailable: "Booking is unavailable on your current plan.", slotUnavailable: "This time is no longer available. Choose another.",
    contextUnavailable: "The selected comparison is unavailable.", success: "Request sent",
    beforeBooking: "How booking works",
  },
} as const;

const zone = "Asia/Tashkent";
const intlLocale = { ru: "ru-RU", uz: "uz-Latn-UZ", en: "en-GB" };
const dayKey = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: zone });

export function ConsultationsClient({ locale, accountType, workspaceId }: {
  locale: PlatformLocale;
  accountType: AccountType;
  workspaceId?: string;
}) {
  const t = copy[locale];
  const base = usePlatformBasePath();
  const activeWorkspaceId = usePlatformWorkspaceId();
  const params = useSearchParams();
  const comparisonId = params.get("comparisonId") || "";
  const initialView = params.has("lawyer") ? "lawyer" : "times";
  const [chosenView, setView] = useState<{ key: string; view: View }>();
  const view = chosenView?.key === params.toString() ? chosenView.view : initialView;
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [entitlements, setEntitlements] = useState<WorkspaceEntitlements | null>(null);
  const [day, setDay] = useState("");
  const [dayPage, setDayPage] = useState(0);
  const [slotPage, setSlotPage] = useState(0);
  const [requestPage, setRequestPage] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [confirmationError, setConfirmationError] = useState("");
  const [comparison, setComparison] = useState<{ id: string; label: string }>();
  const [notice, setNotice] = useState("");
  const [handoffOpened, setHandoffOpened] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const requestInFlight = useRef(false);
  const headers = useMemo(() => ({ "x-juro-workspace-id": activeWorkspaceId }), [activeWorkspaceId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/platform/consultations", { cache: "no-store", headers, signal });
      const data = await response.json() as { slots?: Slot[]; bookings?: Booking[]; entitlements?: WorkspaceEntitlements; error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, data.error, t.failed));
      if (signal?.aborted) return;
      setSlots(data.slots ?? []);
      setBookings([...(data.bookings ?? [])].sort((left, right) => right.startsAt.localeCompare(left.startsAt)));
      setEntitlements(data.entitlements ?? null);
      if (comparisonId) {
        const comparison = await fetch("/api/platform/document-comparisons/" + encodeURIComponent(comparisonId), { cache: "no-store", headers, signal });
        if (!comparison.ok) return setError(t.contextUnavailable);
        const result = await comparison.json() as { comparison?: { versionOneName: string; versionTwoName: string } };
        if (signal?.aborted) return;
        if (!result.comparison) return setError(t.contextUnavailable);
        setComparison({ id: comparisonId, label: result.comparison.versionOneName + " ↔ " + result.comparison.versionTwoName });
      }
    } catch (value) {
      if (!signal?.aborted) setError(value instanceof Error ? value.message : t.failed);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [comparisonId, headers, locale, t.contextUnavailable, t.failed]);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load tracks requests on mount and workspace changes
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function navigate(next: View) {
    if (next === "lawyer" || view === "lawyer") setHandoffOpened(true);
    setView({ key: params.toString(), view: next });
  }

  const groups = useMemo(() => {
    const byDate = new Map<string, Slot[]>();
    for (const slot of slots) {
      const key = dayKey.format(new Date(slot.startsAt));
      const group = byDate.get(key);
      if (group) group.push(slot);
      else byDate.set(key, [slot]);
    }
    return byDate;
  }, [slots]);
  const days = [...groups.keys()];
  const visibleDayPage = Math.min(dayPage, Math.max(0, Math.ceil(days.length / 4) - 1));
  const visibleDays = days.slice(visibleDayPage * 4, visibleDayPage * 4 + 4);
  const activeDay = visibleDays.includes(day) ? day : visibleDays[0];
  const daySlots = groups.get(activeDay) ?? [];
  const selected = slots.find(slot => slot.id === selectedId);
  const specialist = (slot: Slot) => slot.specialistType === "operator" ? t.operator : t.specialist;
  const comparisonLabel = comparison?.id === comparisonId ? comparison.label : "";
  const planBlocked = entitlements?.lawyerHandoff === false;
  const visibleSlotPage = Math.min(slotPage, Math.max(0, Math.ceil(daySlots.length / 6) - 1));
  const visibleRequestPage = Math.min(requestPage, Math.max(0, Math.ceil(bookings.length / 5) - 1));
  const eligible = Boolean(entitlements?.lawyerHandoff) && (!comparisonId || Boolean(comparisonLabel));
  const dayLabel = (value: string, weekday: "long" | "short" = "short") =>
    new Intl.DateTimeFormat(intlLocale[locale], { weekday, day: "numeric", month: "short", timeZone: zone }).format(new Date(value));
  const dateNumber = new Intl.DateTimeFormat(intlLocale[locale], { day: "numeric", timeZone: zone });
  const weekdayMonth = new Intl.DateTimeFormat(intlLocale[locale], { weekday: "short", month: "short", timeZone: zone });
  const timeLabel = (value: string) => new Intl.DateTimeFormat(intlLocale[locale], { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(new Date(value));
  const dateTime = (slot: Slot) => dayLabel(slot.startsAt, "long") + " · " + timeLabel(slot.startsAt) + "–" + timeLabel(slot.endsAt);

  function selectSlot(slot: Slot) {
    setSelectedId(slot.id);
    setConsent(false);
    setConfirmationError("");
  }
  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [selected]);

  async function book() {
    if (!selected || !eligible || !consent || requestInFlight.current) return;
    requestInFlight.current = true;
    setSending(true);
    setConfirmationError("");
    try {
      const response = await fetch("/api/platform/consultations", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ slotId: selected.id, consent: true, comparisonId: comparisonId || undefined, locale }),
      });
      const data = await response.json() as { error?: string; code?: string };
      if (!response.ok) {
        const fallback = data.code === "PLAN_LIMIT" ? t.unavailable : data.code === "SLOT_UNAVAILABLE"
          ? t.slotUnavailable : data.code === "CONTEXT_UNAVAILABLE" ? t.contextUnavailable : t.requestError;
        if (data.code === "SLOT_UNAVAILABLE") {
          dialog.current?.close();
          await load();
          setDay("");
          setDayPage(0);
          setSlotPage(0);
          setError(fallback);
        } else setConfirmationError(platformApiError(locale, data.error, fallback));
        return;
      }
      dialog.current?.close();
      setNotice(t.success);
      setRequestPage(0);
      navigate("requests");
      await load();
    } catch {
      setConfirmationError(t.requestError);
    } finally {
      requestInFlight.current = false;
      setSending(false);
    }
  }

  return <section className="workspace-page consultation-workspace">
    <WorkspaceTitle icon={<CalendarClock />} title={t.title} />
    <nav className="consultation-nav" aria-label={t.title}>
      <button type="button" aria-pressed={view === "times"} onClick={() => navigate("times")}><CalendarDays aria-hidden="true" />{t.times}</button>
      <button type="button" aria-pressed={view === "requests"} onClick={() => navigate("requests")}><ListChecks aria-hidden="true" />{t.requests}{bookings.length > 0 && <span>{bookings.length}</span>}</button>
      <button type="button" aria-pressed={view === "lawyer"} onClick={() => navigate("lawyer")}><UserRoundCheck aria-hidden="true" />{t.lawyer}</button>
    </nav>
    {notice && <p className="consultation-feedback" role="status"><CheckCircle2 aria-hidden="true" />{notice}</p>}
    {error && view !== "lawyer" && <div className="consultation-feedback error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>{t.retry}</button></div>}
    {view !== "lawyer" && loading && <p className="consultation-feedback" role="status"><LoaderCircle className="spin" aria-hidden="true" />{t.loading}</p>}
    {view === "times" && !loading && <div className="consultation-layout">
      <section className="consultation-panel">
        {!days.length ? <div className="consultation-empty"><CalendarDays aria-hidden="true" /><h2>{t.empty}</h2><p>{t.emptyHint}</p><button type="button" onClick={() => navigate("lawyer")}>{t.lawyer}</button></div>
        : <>
          <header><h2>{t.chooseDate}</h2><span>{t.timezone}</span></header>
          <div className="consultation-days" role="group" aria-label={t.chooseDate}>
            {visibleDays.map(value => {
              const date = new Date(groups.get(value)![0].startsAt);
              return <button key={value} type="button" aria-label={dayLabel(date.toISOString(), "long")}
                aria-pressed={value === activeDay} onClick={() => { setDay(value); setSlotPage(0); }}>
                <strong>{dateNumber.format(date)}</strong><small>{weekdayMonth.format(date)}</small>
              </button>;
            })}
          </div>
          {days.length > 4 && <WorkspacePagination locale={locale} page={visibleDayPage} label={t.chooseDate}
            setPage={next => { setDayPage(next); setDay(days[next * 4]); setSlotPage(0); }} pages={Math.ceil(days.length / 4)} />}
          <h3>{t.chooseTime}</h3>
          <div className="consultation-times" role="group" aria-label={t.chooseTime}>
            {daySlots.slice(visibleSlotPage * 6, visibleSlotPage * 6 + 6).map(slot => <button type="button" key={slot.id} disabled={!eligible} onClick={() => selectSlot(slot)}>
              <Clock3 aria-hidden="true" /><span><strong>{timeLabel(slot.startsAt)}–{timeLabel(slot.endsAt)}</strong><small>{specialist(slot)}</small></span><ChevronRight aria-hidden="true" />
            </button>)}
          </div>
          {daySlots.length > 6 && <WorkspacePagination locale={locale} page={visibleSlotPage} label={t.chooseTime} setPage={setSlotPage} pages={Math.ceil(daySlots.length / 6)} />}
        </>}
      </section>
      <aside className="consultation-guide">
        <span className="consultation-guide-icon"><ShieldCheck aria-hidden="true" /></span>
        <h2>{planBlocked ? t.plan : t.beforeBooking}</h2>
        <p>{t.price}</p>
        {comparisonLabel && <div className="consultation-context"><strong>{t.comparison}</strong><span>{comparisonLabel}</span></div>}
        {planBlocked && <Link href={base + "/billing"}>{t.viewPlans}<ChevronRight aria-hidden="true" /></Link>}
      </aside>
    </div>}
    {view === "requests" && !loading && <section className="consultation-panel consultation-requests" aria-label={t.requests}>
      {bookings.length ? <>
        {bookings.slice(visibleRequestPage * 5, visibleRequestPage * 5 + 5).map(item => <article key={item.id}>
          <span className="consultation-guide-icon"><CalendarClock aria-hidden="true" /></span>
          <div><strong>{specialist(item)}</strong><time dateTime={item.startsAt}>{dateTime(item)}</time></div>
          <span className="consultation-status" data-status={item.status}>{bookingStatusLabel(item.status, locale)}</span>
        </article>)}
        {bookings.length > 5 && <WorkspacePagination locale={locale} page={visibleRequestPage} setPage={setRequestPage} pages={Math.ceil(bookings.length / 5)} />}
      </> : <div className="consultation-empty"><ListChecks aria-hidden="true" /><h2>{t.noRequests}</h2><button type="button" onClick={() => navigate("times")}>{t.times}</button></div>}
    </section>}
    {(view === "lawyer" || handoffOpened) && <div hidden={view !== "lawyer"}>
      <LawyerHandoffClient locale={locale} accountType={accountType} workspaceId={workspaceId} />
    </div>}
    <dialog className="consultation-dialog" ref={dialog} aria-labelledby="consultation-confirm-heading" onClose={() => setSelectedId("")}
      onCancel={event => { if (requestInFlight.current) event.preventDefault(); }}>
      {selected && <form onSubmit={event => { event.preventDefault(); void book(); }}>
        <header><h2 id="consultation-confirm-heading">{t.details}</h2><button type="button" disabled={sending} onClick={() => dialog.current?.close()}>{t.close}</button></header>
        <div className="consultation-confirm-time"><CalendarClock aria-hidden="true" /><div><strong>{dateTime(selected)}</strong><span>{specialist(selected)} · {t.timezone}</span></div></div>
        <p>{t.price}</p>
        {comparisonLabel && <div className="consultation-context"><strong>{t.comparison}</strong><span>{comparisonLabel}</span></div>}
        <label className="consult-consent"><input type="checkbox" checked={consent} disabled={sending} onChange={event => setConsent(event.target.checked)} /><span>{t.consent}</span></label>
        {confirmationError && <p className="consultation-feedback error" role="alert">{confirmationError}</p>}
        <button className="consultation-primary" type="submit" disabled={!consent || sending}>{sending && <LoaderCircle className="spin" aria-hidden="true" />}{sending ? t.sending : t.confirm}</button>
      </form>}
    </dialog>
  </section>;
}

function bookingStatusLabel(status: string, locale: PlatformLocale) {
  const labels: Record<string, Record<PlatformLocale, string>> = {
    request_created: { ru: "Заявка создана", uz: "So‘rov yaratildi", en: "Request created" },
    conflict_check: { ru: "Проверка конфликта", uz: "Manfaatlar to‘qnashuvi tekshirilmoqda", en: "Conflict check" },
    awaiting_user_consent: { ru: "Нужно подтверждение", uz: "Tasdiqlash kerak", en: "Confirmation required" },
    confirmed: { ru: "Подтверждено", uz: "Tasdiqlandi", en: "Confirmed" },
    cancelled: { ru: "Отменено", uz: "Bekor qilindi", en: "Cancelled" },
    completed: { ru: "Завершено", uz: "Yakunlandi", en: "Completed" },
  };
  const label = labels[status];
  return label ? label[locale] : status;
}
