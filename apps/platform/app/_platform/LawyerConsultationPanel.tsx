"use client";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- consultation state is loaded from the authenticated API */

import { CalendarClock, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { lawyerIntlLocale, lawyerText } from "../../lib/platform/lawyer-localization";
import type { PlatformLocale } from "../../lib/platform/routing";

type Consultation = {
  id: string;
  requestId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  format: "video" | "phone" | "office";
  status: "proposed" | "confirmed" | "in_progress" | "completed" | "cancelled";
  internalNote?: string | null;
  resultNote?: string | null;
};

export function LawyerConsultationPanel({
  locale,
  requestId,
  role,
}: {
  locale: PlatformLocale;
  requestId: string;
  role: "client" | "lawyer";
}) {
  const text = useCallback(
    (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english),
    [locale],
  );
  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [format, setFormat] = useState<Consultation["format"]>("video");
  const [internalNote, setInternalNote] = useState("");
  const [resultNote, setResultNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/platform/lawyer-consultations?requestId=${encodeURIComponent(requestId)}`,
      { cache: "no-store" },
    );
    const body = (await response.json()) as {
      consultations?: Consultation[];
    };
    if (!response.ok) throw new Error(text("Не удалось загрузить консультацию.", "Konsultatsiyani yuklab bo‘lmadi.", "We could not load the consultation."));
    const next = body.consultations?.[0] || null;
    setConsultation(next);
    if (next && role === "lawyer") {
      setStartsAt(toLocalInput(next.startsAt));
      setEndsAt(toLocalInput(next.endsAt));
      setFormat(next.format);
      setInternalNote(next.internalNote || "");
      setResultNote(next.resultNote || "");
    }
  }, [requestId, role, text]);

  useEffect(() => {
    void load()
      .catch((value) =>
        setError(value instanceof Error ? value.message : String(value)),
      )
      .finally(() => setLoading(false));
  }, [load]);

  async function mutate(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/platform/lawyer-consultations", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ requestId, locale, ...payload }),
      });
      if (!response.ok) throw new Error(text("Не удалось обновить консультацию.", "Konsultatsiyani yangilab bo‘lmadi.", "We could not update the consultation."));
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startsAt || !endsAt) return;
    await mutate({
      action: "propose",
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      format,
      internalNote: internalNote.trim() || undefined,
    });
  }

  if (loading)
    return (
      <div className="lawyer-consultation-panel is-loading">
        <LoaderCircle
          className="spin"
          aria-label={
            text("Загрузка консультации", "Konsultatsiya yuklanmoqda", "Loading consultation")
          }
        />
      </div>
    );

  return (
    <section
      className="lawyer-consultation-panel"
      aria-label={text("Консультация", "Konsultatsiya", "Consultation")}
    >
      <header>
        <CalendarClock aria-hidden="true" />
        <div>
          <strong>{text("Консультация", "Konsultatsiya", "Consultation")}</strong>
          <small>{text("Время Asia/Tashkent", "Asia/Tashkent vaqti", "Times shown in Asia/Tashkent")}</small>
        </div>
        {consultation && (
          <span data-status={consultation.status}>
            {statusLabel(consultation.status, locale)}
          </span>
        )}
      </header>
      {error && (
        <p className="plan-error" role="alert">
          {error}
        </p>
      )}
      {consultation && consultation.status !== "cancelled" && (
        <div className="lawyer-consultation-summary">
          <time dateTime={consultation.startsAt}>
            {formatDate(consultation.startsAt, locale)}
          </time>
          <span>
            {formatLabel(consultation.format, locale)} ·{" "}
            {formatTime(consultation.startsAt, locale)}–
            {formatTime(consultation.endsAt, locale)}
          </span>
        </div>
      )}
      {consultation?.status === "completed" && consultation.resultNote && (
        <div className="lawyer-consultation-result">
          <strong>{text("Итог консультации", "Konsultatsiya yakuni", "Consultation outcome")}</strong>
          <p>{consultation.resultNote}</p>
        </div>
      )}
      {role === "client" ? (
        <>
          {!consultation && (
            <p>
              {text("Юрист ещё не предложил время.", "Yurist hali vaqt taklif qilmagan.", "The lawyer has not proposed a time yet.")}
            </p>
          )}
          {consultation?.status === "proposed" && (
            <div className="lawyer-consultation-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void mutate({ action: "confirm" })}
              >
                {busy && <LoaderCircle className="spin" />}
                {text("Подтвердить время", "Vaqtni tasdiqlash", "Confirm time")}
              </button>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => void mutate({ action: "cancel" })}
              >
                {text("Отклонить", "Rad etish", "Decline")}
              </button>
            </div>
          )}
          {consultation?.status === "confirmed" && (
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => void mutate({ action: "cancel" })}
            >
              {text("Отменить консультацию", "Konsultatsiyani bekor qilish", "Cancel consultation")}
            </button>
          )}
        </>
      ) : (
        <>
          {consultation?.status === "confirmed" && (
            <div className="lawyer-consultation-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void mutate({ action: "start" })}
              >
                {busy && <LoaderCircle className="spin" />}
                {text("Начать консультацию", "Konsultatsiyani boshlash", "Start consultation")}
              </button>
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => void mutate({ action: "cancel" })}
              >
                {text("Отменить", "Bekor qilish", "Cancel")}
              </button>
            </div>
          )}
          {consultation?.status === "in_progress" && (
            <div className="lawyer-consultation-completion">
              <label>
                {text("Итоговый комментарий клиенту", "Mijoz uchun yakuniy izoh", "Outcome note for the client")}
                <textarea
                  required
                  maxLength={4_000}
                  value={resultNote}
                  onChange={(event) => setResultNote(event.target.value)}
                />
              </label>
              <div className="lawyer-consultation-actions">
                <button
                  type="button"
                  disabled={busy || !resultNote.trim()}
                  onClick={() => void mutate({ action: "complete", resultNote: resultNote.trim() })}
                >
                  {text("Завершить консультацию", "Konsultatsiyani yakunlash", "Complete consultation")}
                </button>
              </div>
            </div>
          )}
          {(!consultation ||
            consultation.status === "proposed" ||
            consultation.status === "cancelled") && (
            <form onSubmit={(event) => void propose(event)}>
              <div>
                <label>
                  {text("Начало", "Boshlanishi", "Starts")}
                  <input
                    type="datetime-local"
                    required
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </label>
                <label>
                  {text("Окончание", "Tugashi", "Ends")}
                  <input
                    type="datetime-local"
                    required
                    value={endsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                  />
                </label>
              </div>
              <label>
                {text("Формат", "Format", "Format")}
                <Select
                  value={format}
                  onChange={(event) =>
                    setFormat(event.target.value as Consultation["format"])
                  }
                >
                  <option value="video">{text("Видеосвязь", "Video", "Video call")}</option>
                  <option value="phone">{text("Телефон", "Telefon", "Phone")}</option>
                  <option value="office">{text("В офисе", "Ofisda", "In person")}</option>
                </Select>
              </label>
              <label>
                {text("Внутренняя заметка", "Ichki izoh", "Internal note")}
                <textarea
                  maxLength={1_000}
                  value={internalNote}
                  onChange={(event) => setInternalNote(event.target.value)}
                />
              </label>
              <button type="submit" disabled={busy || !startsAt || !endsAt}>
                {busy && <LoaderCircle className="spin" />}
                {consultation?.status === "proposed"
                  ? text("Изменить предложение", "Taklifni o‘zgartirish", "Update proposed time")
                  : text("Предложить время", "Vaqt taklif qilish", "Propose time")}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function toLocalInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
function formatDate(value: string, locale: PlatformLocale) {
  return new Intl.DateTimeFormat(lawyerIntlLocale(locale), {
    dateStyle: "medium",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
}
function formatTime(value: string, locale: PlatformLocale) {
  return new Intl.DateTimeFormat(lawyerIntlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
}
function statusLabel(status: Consultation["status"], locale: PlatformLocale) {
  const labels: Record<Consultation["status"], [string, string, string]> = {
    proposed: ["Ожидает подтверждения", "Tasdiq kutilmoqda", "Awaiting confirmation"],
    confirmed: ["Подтверждена", "Tasdiqlangan", "Confirmed"],
    in_progress: ["Идёт", "Davom etmoqda", "In progress"],
    completed: ["Завершена", "Yakunlangan", "Completed"],
    cancelled: ["Отменена", "Bekor qilingan", "Cancelled"],
  };
  return lawyerText(locale, labels[status][0], labels[status][1], labels[status][2]);
}
function formatLabel(format: Consultation["format"], locale: PlatformLocale) {
  const labels: Record<Consultation["format"], [string, string, string]> = {
    video: ["Видеосвязь", "Video", "Video call"],
    phone: ["Телефон", "Telefon", "Phone"],
    office: ["В офисе", "Ofisda", "In person"],
  };
  return lawyerText(locale, labels[format][0], labels[format][1], labels[format][2]);
}
