"use client";

import { Select } from "../_components/Select";

import { Check, MessageSquareReply, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { lawyerIntlLocale } from "../../lib/platform/lawyer-localization";
import type { PlatformLocale } from "../../lib/platform/routing";

type Status = "pending" | "approved" | "rejected";
type Reply = {
  id: string; reviewId: string; version: number; body: string; status: Status;
  createdAt: string; lawyerName: string; overallRating: number; reviewBody: string | null;
};

const copy = {
  ru: {
    title: "Ответы юристов на отзывы", description: "Публичным становится только отдельно одобренный ответ без контактов и иных персональных данных.",
    back: "Отзывы", refresh: "Обновить", status: "Статус", pending: "Ожидают", approved: "Одобрены", rejected: "Отклонены",
    none: "Ответов с выбранным статусом нет.", review: "Отзыв клиента", reply: "Ответ юриста", moderate: "Проверить", decision: "Решение",
    approve: "Одобрить", reject: "Отклонить", edited: "Текст после удаления персональных данных (необязательно)",
    reason: "Основание решения", hint: "Проверьте контакты, PINFL, номера документов и сведения третьих лиц.", save: "Сохранить решение",
    cancel: "Отмена", success: "Решение сохранено. Публичная проекция обновляется только для одобренного ответа.", error: "Не удалось выполнить запрос.", protected: "Защищённый контур · свежая 2FA", skip: "К очереди", language: "Язык интерфейса",
  },
  uz: {
    title: "Yuristlarning fikrlarga javoblari", description: "Faqat kontaktlar va boshqa shaxsiy ma’lumotlarsiz alohida tasdiqlangan javob ommaviy bo‘ladi.",
    back: "Fikrlar", refresh: "Yangilash", status: "Holat", pending: "Kutilmoqda", approved: "Tasdiqlangan", rejected: "Rad etilgan",
    none: "Tanlangan holat bo‘yicha javoblar yo‘q.", review: "Mijoz fikri", reply: "Yurist javobi", moderate: "Tekshirish", decision: "Qaror",
    approve: "Tasdiqlash", reject: "Rad etish", edited: "Shaxsiy ma’lumotlar olib tashlangan matn (ixtiyoriy)",
    reason: "Qaror asosi", hint: "Kontaktlar, JShShIR, hujjat raqamlari va uchinchi shaxs ma’lumotlarini tekshiring.", save: "Qarorni saqlash",
    cancel: "Bekor qilish", success: "Qaror saqlandi. Ommaviy ko‘rinish faqat tasdiqlangan javob uchun yangilanadi.", error: "So‘rov bajarilmadi.", protected: "Himoyalangan kontur · yangi 2FA", skip: "Navbatga o‘tish", language: "Interfeys tili",
  },
  en: {
    title: "Lawyer replies to reviews", description: "Only a separately approved reply without contact details or other personal data becomes public.",
    back: "Reviews", refresh: "Refresh", status: "Status", pending: "Pending", approved: "Approved", rejected: "Rejected",
    none: "There are no replies with the selected status.", review: "Client review", reply: "Lawyer reply", moderate: "Review", decision: "Decision",
    approve: "Approve", reject: "Reject", edited: "Redacted text after removing personal data (optional)",
    reason: "Decision rationale", hint: "Check for contact details, PINFL, document numbers, and third-party personal data.", save: "Save decision",
    cancel: "Cancel", success: "The decision was saved. The public view updates only for an approved reply.", error: "We could not complete the request.", protected: "Protected workspace · recent 2FA", skip: "Skip to moderation queue", language: "Interface language",
  },
} as const;

async function json<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json() as T;
  if (!response.ok) throw new Error(fallback);
  return payload;
}

export function LawyerReviewReplyModerationInbox({ locale, reviewerName }: { locale: PlatformLocale; reviewerName: string }) {
  const t = copy[locale];
  const [status, setStatus] = useState<Status>("pending");
  const [replies, setReplies] = useState<Reply[]>([]);
  const [selected, setSelected] = useState<Reply | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [moderatedBody, setModeratedBody] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const payload = await json<{ replies: Reply[] }>(await fetch(`/api/platform/admin/lawyer-review-replies?status=${encodeURIComponent(status)}`, { cache: "no-store" }), t.error);
      setReplies(payload.replies); setSelected(null);
    } catch (value) { setError(value instanceof Error ? value.message : t.error); }
    finally { setBusy(false); }
  }, [status, t.error]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const choose = (reply: Reply) => { setSelected(reply); setDecision("approved"); setModeratedBody(""); setReason(""); setError(""); setAnnouncement(""); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !reason.trim()) return;
    setBusy(true); setError(""); setAnnouncement("");
    try {
      await json(await fetch(`/api/platform/admin/lawyer-review-replies/${encodeURIComponent(selected.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ decision, moderatedBody: moderatedBody.trim() || undefined, reason: reason.trim(), locale }),
      }), t.error);
      setAnnouncement(t.success); await load();
    } catch (value) { setError(value instanceof Error ? value.message : t.error); }
    finally { setBusy(false); }
  }
  const formatDate = (value: string) => new Intl.DateTimeFormat(lawyerIntlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(value));

  return <div className="staff-console">
    <a className="staff-skip" href="#staff-main">{t.skip}</a>
    <header className="staff-topbar"><div className="staff-brand"><ShieldCheck aria-hidden="true" /><span><b>JURO</b><small>LEGAL OPERATIONS</small></span></div><div className="staff-session"><span>{t.protected}</span><b>{reviewerName}</b></div><nav className="staff-locale-links" aria-label={t.language}>{(["ru", "uz", "en"] as const).map((value) => <a key={value} href={`/${value}/admin/lawyer-review-replies`} hrefLang={value} aria-current={value === locale ? "page" : undefined}>{value.toUpperCase()}</a>)}</nav></header>
    <main id="staff-main" className="staff-main">
      <section className="staff-heading"><div><span>JURO · REPLY SAFETY</span><h1>{t.title}</h1><p>{t.description}</p></div><div className="staff-review-toolbar"><a href={`/${locale}/admin/lawyer-reviews`}>{t.back}</a><button type="button" onClick={() => void load()} disabled={busy}><RefreshCw aria-hidden="true" />{t.refresh}</button></div></section>
      <div className="staff-filters"><label>{t.status}<Select value={status} onChange={(event) => setStatus(event.target.value as Status)}><option value="pending">{t.pending}</option><option value="approved">{t.approved}</option><option value="rejected">{t.rejected}</option></Select></label></div>
      {error && <p className="staff-error" role="alert">{error}<button type="button" onClick={() => void load()}>{t.refresh}</button></p>}
      {announcement && <p role="status" className="staff-verified"><Check aria-hidden="true" />{announcement}</p>}
      {!busy && replies.length === 0 && <section className="staff-empty"><MessageSquareReply aria-hidden="true" /><h2>{t.none}</h2></section>}
      <section className="staff-queue" aria-busy={busy}>{replies.map((reply) => <article className="staff-table-row staff-reply-row" key={reply.id}><div className="staff-source"><span>{reply.overallRating}/5 · v{reply.version}</span><b>{reply.lawyerName}</b><small>{formatDate(reply.createdAt)}</small></div><div><b>{t.review}</b><p>{reply.reviewBody || "—"}</p></div><div><b>{t.reply}</b><p>{reply.body}</p></div><div className={`staff-status status-${reply.status}`}>{t[reply.status]}</div><div className="staff-row-actions"><button type="button" onClick={() => choose(reply)} disabled={busy || reply.status !== "pending"}>{t.moderate}</button></div></article>)}</section>
      {selected && <form className="staff-decision" onSubmit={(event) => void submit(event)}><h2>{t.decision}: {selected.lawyerName}</h2><blockquote>{selected.body}</blockquote><label>{t.decision}<Select value={decision} onChange={(event) => setDecision(event.target.value as "approved" | "rejected")}><option value="approved">{t.approve}</option><option value="rejected">{t.reject}</option></Select></label><label>{t.edited}<textarea value={moderatedBody} maxLength={2000} onChange={(event) => setModeratedBody(event.target.value)} /></label><label>{t.reason}<textarea required minLength={1} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><small>{t.hint}</small><div><button type="button" onClick={() => setSelected(null)} disabled={busy}><X aria-hidden="true" />{t.cancel}</button><button type="submit" className={decision === "approved" ? "staff-approve" : "staff-reject"} disabled={busy || !reason.trim()}><Check aria-hidden="true" />{t.save}</button></div></form>}
    </main>
  </div>;
}
