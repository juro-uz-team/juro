"use client";

import { Select } from "../_components/Select";

import {
  ArchiveX,
  ArrowUpRight,
  Check,
  ChevronRight,
  FileCheck2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { platformIntlLocale } from "../../lib/platform/date-time";
import type { PlatformLocale } from "../../lib/platform/routing";

type Locale = PlatformLocale;
type SourceLocale = "ru" | "uz";
type ReviewStatus = "pending" | "in_review" | "approved" | "rejected" | "closed";
type ReviewItem = {
  reviewId: string;
  sourceId: string;
  versionId: string;
  reasonCode: string;
  confidence: "high" | "medium" | "low";
  status: ReviewStatus;
  assignedToMe: boolean;
  decision: "approve" | "reject" | null;
  decisionEvidenceSha256: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceKind: "lex";
  language: SourceLocale;
  officialUrl: string;
  title: string;
  actIdentifier: string | null;
  canonicalId: string | null;
  versionStatus: string;
  fetchedAt: string;
  parsedSnapshotReady: boolean;
  publicationId: string | null;
  publicationEvidenceSha256: string | null;
  isCurrentPublication: boolean;
};
type SourceBlock = {
  index: number;
  kind: "heading" | "paragraph" | "list_item" | "quote" | "definition" | "table_cell" | "preformatted";
  headingLevel?: number;
  text: string;
};
type ClaimedReview = {
  review: {
    reviewId: string;
    status: "in_review";
    changed: boolean;
  };
  source: {
    sourceId: string;
    versionId: string;
    sourceKind: "lex";
    locale: SourceLocale;
    canonicalId: string;
    canonicalUrl: string;
    rawContentSha256: string;
    parsedContentSha256: string;
    documentTitle: string;
    primarySelector: string;
    blocks: SourceBlock[];
  };
};
type ListResponse = { ok: true; items: ReviewItem[]; nextCursor: string | null };

const labels = {
  ru: {
    skip: "К очереди", filters: "Фильтры очереди", russian: "Русский", uzbek: "O‘zbekcha",
    title: "Проверка юридических источников",
    subtitle: "Только сохранённые снимки Lex.uz. Публикация требует подтверждённого решения.",
    protected: "Защищённый контур · свежая 2FA",
    status: "Состояние", scope: "Назначение", source: "Источник", language: "Язык",
    pending: "Ожидают", inReview: "На проверке", approved: "Одобрены", rejected: "Отклонены", closed: "Закрыты",
    workable: "Доступные мне", mine: "Назначенные мне", unassigned: "Без исполнителя", all: "Все",
    allSources: "Все источники", allLanguages: "Все языки",
    refreshed: "Очередь обновлена.", retry: "Повторить", refresh: "Обновить", loadMore: "Показать ещё",
    emptyTitle: "Заданий по этим фильтрам нет", emptyText: "Измените фильтры или обновите очередь позже.",
    sourceCol: "Источник", reasonCol: "Причина", stateCol: "Состояние", receivedCol: "Получен", actionCol: "Действие",
    claim: "Взять на проверку", resume: "Продолжить", publish: "Опубликовать", published: "Опубликован",
    openOriginal: "Открыть официальный источник", back: "Вернуться к очереди", evidence: "Контрольные суммы",
    normalized: "Нормализованный снимок", showMore: "Показать следующие фрагменты",
    notes: "Обоснование решения", notesHint: "Не менее 10 символов. Зафиксируйте, что именно было проверено.",
    effectiveDate: "Действует с", expiresDate: "Действует до — необязательно",
    applicabilityHint: "Даты подтверждаются ревьюером и определяют текущую или историческую редакцию.",
    approve: "Одобрить снимок", reject: "Отклонить снимок", reviewing: "Открывается проверенный снимок…",
    publishing: "Публикуется проверенный снимок…", deciding: "Решение сохраняется…",
    approvedDone: "Снимок одобрен. Он доступен в фильтре «Одобрены» для отдельной публикации.",
    rejectedDone: "Снимок отклонён и не опубликован.", publishedDone: "Проверенный снимок опубликован.",
    withdraw: "Отозвать", withdrawing: "Публикация отзывается…",
    withdrawalTitle: "Отозвать текущую публикацию",
    withdrawalHint: "Укажите юридически значимую причину. Опубликованный снимок и доказательства сохранятся в истории.",
    withdrawalNotes: "Причина отзыва", withdrawalCancel: "Отмена",
    withdrawalConfirm: "Подтвердить отзыв",
    withdrawalDone: "Публикация отозвана и исключена из текущих источников.",
    syncTitle: "Добавить официальный источник",
    syncHint: "Только точный URL документа Lex.uz. Снимок попадёт в очередь и не будет опубликован автоматически.",
    syncUrl: "URL официального документа",
    syncPlaceholder: "https://lex.uz/ru/docs/111189",
    syncSubmit: "Поставить в очередь",
    syncQueued: "Запрос поставлен в очередь. После загрузки снимок появится на ручной проверке.",
    selectPage: "Выбрать доступные на странице", selected: "Выбрано", bulkApprove: "Одобрить выбранные",
    bulkTitle: "Массовое одобрение", bulkHint: "Решение будет записано отдельно для каждого снимка. Публикация останется отдельным действием.",
    bulkConfirm: "Подтвердить одобрение", bulkCancel: "Отмена",
    bulkDone: "Массовая проверка завершена", bulkSkipped: "пропущено из-за изменения состояния",
    error: "Не удалось выполнить запрос.", count: "заданий",
  },
  uz: {
    skip: "Navbatga o‘tish", filters: "Navbat filtrlari", russian: "Русский", uzbek: "O‘zbekcha",
    title: "Huquqiy manbalarni tekshirish",
    subtitle: "Faqat Lex.uz saqlangan nusxalari. Nashr tasdiqlangan qarorni talab qiladi.",
    protected: "Himoyalangan kontur · yangi 2FA",
    status: "Holat", scope: "Tayinlash", source: "Manba", language: "Til",
    pending: "Kutilmoqda", inReview: "Tekshiruvda", approved: "Tasdiqlangan", rejected: "Rad etilgan", closed: "Yopilgan",
    workable: "Menga mavjud", mine: "Menga tayinlangan", unassigned: "Ijrochisiz", all: "Barchasi",
    allSources: "Barcha manbalar", allLanguages: "Barcha tillar",
    refreshed: "Navbat yangilandi.", retry: "Qayta urinish", refresh: "Yangilash", loadMore: "Yana ko‘rsatish",
    emptyTitle: "Bu filtrlar bo‘yicha topshiriq yo‘q", emptyText: "Filtrlarni o‘zgartiring yoki navbatni keyinroq yangilang.",
    sourceCol: "Manba", reasonCol: "Sabab", stateCol: "Holat", receivedCol: "Olingan", actionCol: "Amal",
    claim: "Tekshiruvga olish", resume: "Davom ettirish", publish: "Nashr qilish", published: "Nashr qilingan",
    openOriginal: "Rasmiy manbani ochish", back: "Navbatga qaytish", evidence: "Nazorat yig‘indilari",
    normalized: "Normallashtirilgan nusxa", showMore: "Keyingi qismlarni ko‘rsatish",
    notes: "Qaror asosi", notesHint: "Kamida 10 belgi. Aynan nima tekshirilganini qayd eting.",
    effectiveDate: "Amal qilish boshlanishi", expiresDate: "Amal qilish tugashi — ixtiyoriy",
    applicabilityHint: "Sanalar tekshiruvchi tomonidan tasdiqlanadi va joriy yoki tarixiy tahrirni belgilaydi.",
    approve: "Nusxani tasdiqlash", reject: "Nusxani rad etish", reviewing: "Tekshirilgan nusxa ochilmoqda…",
    publishing: "Tekshirilgan nusxa nashr qilinmoqda…", deciding: "Qaror saqlanmoqda…",
    approvedDone: "Nusxa tasdiqlandi. Alohida nashr uchun «Tasdiqlangan» filtrida mavjud.",
    rejectedDone: "Nusxa rad etildi va nashr qilinmadi.", publishedDone: "Tekshirilgan nusxa nashr qilindi.",
    withdraw: "Qaytarib olish", withdrawing: "Nashr qaytarib olinmoqda…",
    withdrawalTitle: "Joriy nashrni qaytarib olish",
    withdrawalHint: "Yuridik ahamiyatga ega sababni kiriting. Nashr nusxasi va dalillari tarixda saqlanadi.",
    withdrawalNotes: "Qaytarib olish sababi", withdrawalCancel: "Bekor qilish",
    withdrawalConfirm: "Qaytarib olishni tasdiqlash",
    withdrawalDone: "Nashr qaytarib olindi va joriy manbalardan chiqarildi.",
    syncTitle: "Rasmiy manbani qo‘shish",
    syncHint: "Faqat Lex.uz hujjatining aniq URL manzili. Nusxa navbatga tushadi va avtomatik nashr qilinmaydi.",
    syncUrl: "Rasmiy hujjat URL manzili",
    syncPlaceholder: "https://lex.uz/uz/docs/111189",
    syncSubmit: "Navbatga qo‘yish",
    syncQueued: "So‘rov navbatga qo‘yildi. Yuklangach, nusxa qo‘lda tekshirish uchun paydo bo‘ladi.",
    selectPage: "Sahifadagi mavjudlarini tanlash", selected: "Tanlandi", bulkApprove: "Tanlanganlarni tasdiqlash",
    bulkTitle: "Ommaviy tasdiqlash", bulkHint: "Qaror har bir nusxa uchun alohida qayd etiladi. Nashr qilish alohida amal bo‘lib qoladi.",
    bulkConfirm: "Tasdiqlash", bulkCancel: "Bekor qilish",
    bulkDone: "Ommaviy tekshiruv yakunlandi", bulkSkipped: "holat o‘zgargani uchun o‘tkazib yuborildi",
    error: "So‘rovni bajarib bo‘lmadi.", count: "topshiriq",
  },
  en: {
    skip: "Skip to review queue", filters: "Queue filters", russian: "Russian", uzbek: "Uzbek",
    title: "Legal source review",
    subtitle: "Saved Lex.uz snapshots only. Publication requires a confirmed human decision.",
    protected: "Secure environment · recent 2FA",
    status: "Status", scope: "Assignment", source: "Source", language: "Language",
    pending: "Pending", inReview: "In review", approved: "Approved", rejected: "Rejected", closed: "Closed",
    workable: "Available to me", mine: "Assigned to me", unassigned: "Unassigned", all: "All",
    allSources: "All sources", allLanguages: "All languages",
    refreshed: "Queue refreshed.", retry: "Try again", refresh: "Refresh", loadMore: "Show more",
    emptyTitle: "No tasks match these filters", emptyText: "Change the filters or refresh the queue later.",
    sourceCol: "Source", reasonCol: "Reason", stateCol: "Status", receivedCol: "Received", actionCol: "Action",
    claim: "Claim for review", resume: "Continue", publish: "Publish", published: "Published",
    openOriginal: "Open official source", back: "Return to queue", evidence: "Checksums",
    normalized: "Normalised snapshot", showMore: "Show more excerpts",
    notes: "Decision rationale", notesHint: "At least 10 characters. Record exactly what was reviewed.",
    effectiveDate: "Effective from", expiresDate: "Effective until — optional",
    applicabilityHint: "Dates are confirmed by the reviewer and determine whether the edition is current or historical.",
    approve: "Approve snapshot", reject: "Reject snapshot", reviewing: "Opening verified snapshot…",
    publishing: "Publishing verified snapshot…", deciding: "Saving decision…",
    approvedDone: "Snapshot approved. It is available under “Approved” for a separate publication action.",
    rejectedDone: "Snapshot rejected and not published.", publishedDone: "Verified snapshot published.",
    withdraw: "Withdraw", withdrawing: "Withdrawing publication…",
    withdrawalTitle: "Withdraw current publication",
    withdrawalHint: "Provide a legally relevant reason. The published snapshot and its evidence remain in the audit history.",
    withdrawalNotes: "Reason for withdrawal", withdrawalCancel: "Cancel",
    withdrawalConfirm: "Confirm withdrawal",
    withdrawalDone: "Publication withdrawn and removed from current sources.",
    syncTitle: "Add official source",
    syncHint: "Enter an exact Lex.uz document URL. The snapshot will enter the queue and will not be published automatically.",
    syncUrl: "Official document URL",
    syncPlaceholder: "https://lex.uz/docs/111189",
    syncSubmit: "Add to queue",
    syncQueued: "Request queued. Once retrieved, the snapshot will appear for manual review.",
    selectPage: "Select eligible items on this page", selected: "Selected", bulkApprove: "Approve selected",
    bulkTitle: "Bulk approval", bulkHint: "A separate decision is recorded for every snapshot. Publication remains a separate action.",
    bulkConfirm: "Confirm approval", bulkCancel: "Cancel",
    bulkDone: "Bulk review completed", bulkSkipped: "skipped because the status changed",
    error: "The request could not be completed.", count: "tasks",
  },
} as const;

function statusLabel(status: ReviewStatus, locale: Locale): string {
  const l = labels[locale];
  return status === "pending" ? l.pending : status === "in_review" ? l.inReview : status === "approved" ? l.approved : status === "rejected" ? l.rejected : l.closed;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

export function LegalSourceReviewInbox({ locale, reviewerName }: { locale: Locale; reviewerName: string }) {
  const l = labels[locale];
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [scope, setScope] = useState("workable");
  const [sourceKind, setSourceKind] = useState("all");
  const [language, setLanguage] = useState("all");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [claimed, setClaimed] = useState<ClaimedReview | null>(null);
  const [visibleBlocks, setVisibleBlocks] = useState(80);
  const [notes, setNotes] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expiresDate, setExpiresDate] = useState("");
  const [busy, setBusy] = useState("");
  const [syncConfirmation, setSyncConfirmation] = useState("");
  const [withdrawing, setWithdrawing] = useState<ReviewItem | null>(null);
  const [withdrawalNotes, setWithdrawalNotes] = useState("");
  const [syncUrl, setSyncUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkEffectiveDate, setBulkEffectiveDate] = useState("");
  const [bulkExpiresDate, setBulkExpiresDate] = useState("");
  const requestSequence = useRef(0);
  const bulkDialogRef = useRef<HTMLDialogElement>(null);

  const query = useMemo(() => new URLSearchParams({
    lang: locale, status, scope, sourceKind, language, limit: "25",
  }), [language, locale, scope, sourceKind, status]);

  const load = useCallback(async (cursor?: string) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams(query);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/platform/legal-sources/reviews?${params}`, {
        headers: { "x-juro-csrf": "1" }, cache: "no-store",
      });
      const body = await responseJson<ListResponse>(response);
      if (requestId !== requestSequence.current) return;
      setItems((current) => cursor ? [...current, ...body.items] : body.items);
      setNextCursor(body.nextCursor);
      setAnnouncement(l.refreshed);
    } catch (value) {
      if (requestId !== requestSequence.current) return;
      setError(value instanceof Error ? value.message : l.error);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [l.error, l.refreshed, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const dialog = bulkDialogRef.current;
    if (!dialog) return;
    if (bulkOpen && !dialog.open) dialog.showModal();
    if (!bulkOpen && dialog.open) dialog.close();
  }, [bulkOpen]);

  const eligibleItems = useMemo(
    () => items.filter((item) => item.status === "pending" && item.parsedSnapshotReady),
    [items],
  );
  const eligibleReviewIds = useMemo(
    () => new Set(eligibleItems.map((item) => item.reviewId)),
    [eligibleItems],
  );
  const selectedEligibleReviewIds = useMemo(
    () => new Set([...selectedReviewIds].filter((id) => eligibleReviewIds.has(id))),
    [eligibleReviewIds, selectedReviewIds],
  );
  const allEligibleSelected = eligibleItems.length > 0
    && eligibleItems.every((item) => selectedEligibleReviewIds.has(item.reviewId));

  const toggleSelection = (reviewId: string) => {
    setSelectedReviewIds((current) => {
      const next = new Set(current);
      if (next.has(reviewId)) next.delete(reviewId); else next.add(reviewId);
      return next;
    });
  };

  const togglePageSelection = () => {
    setSelectedReviewIds(allEligibleSelected
      ? new Set()
      : new Set(eligibleItems.map((item) => item.reviewId)));
  };

  const bulkApprove = async () => {
    if (selectedEligibleReviewIds.size === 0 || bulkNotes.trim().length < 10 || !bulkEffectiveDate) return;
    setBusy("bulk");
    setError("");
    try {
      const response = await fetch(`/api/platform/legal-sources/reviews/bulk-approval?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({
          items: [...selectedEligibleReviewIds].map((reviewId) => ({ reviewId })),
          notes: bulkNotes.trim(),
          effectiveDate: bulkEffectiveDate,
          expiresDate: bulkExpiresDate || undefined,
        }),
      });
      const body = await responseJson<{ ok: true; summary: { approved: number; skipped: number } }>(response);
      setAnnouncement(`${l.bulkDone}: ${body.summary.approved}; ${l.bulkSkipped}: ${body.summary.skipped}.`);
      setBulkOpen(false);
      setSelectedReviewIds(new Set());
      setBulkNotes("");
      setBulkEffectiveDate("");
      setBulkExpiresDate("");
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : l.error);
    } finally { setBusy(""); }
  };

  const claim = async (item: ReviewItem) => {
    setBusy(item.reviewId);
    setError("");
    try {
      const response = await fetch(`/api/platform/legal-sources/reviews/${encodeURIComponent(item.reviewId)}/claim?lang=${locale}`, {
        method: "POST", headers: { "x-juro-csrf": "1" },
      });
      const body = await responseJson<{ ok: true } & ClaimedReview>(response);
      setClaimed(body);
      setVisibleBlocks(80);
      setNotes("");
      setEffectiveDate("");
      setExpiresDate("");
      setAnnouncement(l.reviewing);
    } catch (value) {
      setError(value instanceof Error ? value.message : l.error);
    } finally { setBusy(""); }
  };

  const decide = async (decision: "approve" | "reject") => {
    if (!claimed || notes.trim().length < 10 || (decision === "approve" && !effectiveDate)) return;
    setBusy(decision);
    setError("");
    setAnnouncement(l.deciding);
    try {
      const response = await fetch(`/api/platform/legal-sources/reviews/${encodeURIComponent(claimed.review.reviewId)}/decision?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({
          decision, notes: notes.trim(),
          effectiveDate: decision === "approve" ? effectiveDate : undefined,
          expiresDate: decision === "approve" && expiresDate ? expiresDate : undefined,
          expectedRawContentSha256: claimed.source.rawContentSha256,
          expectedParsedContentSha256: claimed.source.parsedContentSha256,
        }),
      });
      await responseJson(response);
      setClaimed(null);
      setStatus(decision === "approve" ? "approved" : "rejected");
      setScope("mine");
      setAnnouncement(decision === "approve" ? l.approvedDone : l.rejectedDone);
    } catch (value) {
      setError(value instanceof Error ? value.message : l.error);
    } finally { setBusy(""); }
  };

  const publish = async (item: ReviewItem) => {
    if (!item.decisionEvidenceSha256) return;
    setBusy(item.reviewId);
    setError("");
    setAnnouncement(l.publishing);
    try {
      const response = await fetch(`/api/platform/legal-sources/reviews/${encodeURIComponent(item.reviewId)}/publication?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ expectedDecisionEvidenceSha256: item.decisionEvidenceSha256 }),
      });
      await responseJson(response);
      setAnnouncement(l.publishedDone);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : l.error);
    } finally { setBusy(""); }
  };

  const withdraw = async () => {
    if (
      !withdrawing?.publicationId
      || !withdrawing.publicationEvidenceSha256
      || withdrawalNotes.trim().length < 10
    ) return;
    setBusy(withdrawing.reviewId);
    setError("");
    setAnnouncement(l.withdrawing);
    try {
      const response = await fetch(`/api/platform/legal-sources/publications/${encodeURIComponent(withdrawing.publicationId)}/withdrawal?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({
          expectedPublicationEvidenceSha256:
            withdrawing.publicationEvidenceSha256,
          reasonNotes: withdrawalNotes.trim(),
        }),
      });
      await responseJson(response);
      setWithdrawing(null);
      setWithdrawalNotes("");
      setAnnouncement(l.withdrawalDone);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : l.error);
    } finally { setBusy(""); }
  };

  const enqueueSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = syncUrl.trim();
    if (!url || syncing) return;
    setSyncing(true);
    setSyncError("");
    setSyncConfirmation("");
    try {
      const response = await fetch(`/api/platform/legal-sources/sync?lang=${locale}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({
          url,
          idempotencyKey: `staff_ui_${crypto.randomUUID().replaceAll("-", "")}`,
        }),
      });
      await responseJson<{
        ok: true;
        request: {
          requestId: string;
          canonicalUrl: string;
          status: "queued";
        };
      }>(response);
      setSyncUrl("");
      setSyncConfirmation(l.syncQueued);
      setAnnouncement(l.syncQueued);
    } catch (value) {
      setSyncError(value instanceof Error ? value.message : l.error);
    } finally {
      setSyncing(false);
    }
  };

  const date = (value: string) => new Intl.DateTimeFormat(platformIntlLocale(locale), {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent",
  }).format(new Date(value));
  const nextLocale: Locale = locale === "ru" ? "uz" : locale === "uz" ? "en" : "ru";

  return <div className="staff-console">
    <a className="staff-skip" href="#staff-main">{l.skip}</a>
    <header className="staff-topbar">
      <div className="staff-brand"><ShieldCheck aria-hidden="true"/><span><b>JURO</b><small>LEGAL OPERATIONS</small></span></div>
      <div className="staff-session"><span>{l.protected}</span><b>{reviewerName}</b></div>
      <a href={`/${nextLocale}/admin/legal-sources/reviews`} hrefLang={nextLocale}>{nextLocale.toUpperCase()}</a>
    </header>
    <main id="staff-main" className="staff-main">
      {claimed ? <section className="staff-review-document" aria-labelledby="review-document-title">
        <div className="staff-review-toolbar">
          <button type="button" onClick={() => setClaimed(null)}>{l.back}</button>
          <a href={claimed.source.canonicalUrl} target="_blank" rel="noreferrer">{l.openOriginal}<ArrowUpRight aria-hidden="true"/></a>
        </div>
        <header>
          <span>{claimed.source.sourceKind.toUpperCase()} · {claimed.source.locale.toUpperCase()}</span>
          <h1 id="review-document-title">{claimed.source.documentTitle}</h1>
          <p>{claimed.source.canonicalId}</p>
        </header>
        <details className="staff-evidence"><summary>{l.evidence}</summary><dl>
          <div><dt>Raw SHA-256</dt><dd>{claimed.source.rawContentSha256}</dd></div>
          <div><dt>Parsed SHA-256</dt><dd>{claimed.source.parsedContentSha256}</dd></div>
          <div><dt>Selector</dt><dd>{claimed.source.primarySelector}</dd></div>
        </dl></details>
        <article className="staff-source-copy" aria-label={l.normalized}>
          {claimed.source.blocks.slice(0, visibleBlocks).map((block) => block.kind === "heading"
            ? <h2 key={block.index}>{block.text}</h2>
            : <p key={block.index} className={`source-${block.kind}`}>{block.text}</p>)}
          {visibleBlocks < claimed.source.blocks.length && <button type="button" className="staff-show-more" onClick={() => setVisibleBlocks((value) => value + 80)}>{l.showMore}<ChevronRight aria-hidden="true"/></button>}
        </article>
        <section className="staff-decision" aria-labelledby="decision-title">
          <h2 id="decision-title">{l.notes}</h2><p>{l.notesHint}</p>
          <div className="staff-applicability-dates">
            <label>{l.effectiveDate}<input type="date" required value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)}/></label>
            <label>{l.expiresDate}<input type="date" min={effectiveDate || undefined} value={expiresDate} onChange={(event) => setExpiresDate(event.target.value)}/></label>
          </div>
          <p>{l.applicabilityHint}</p>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={5} aria-describedby="decision-help"/>
          <small id="decision-help">{notes.trim().length}/2000</small>
          <div><button type="button" className="staff-reject" disabled={busy !== "" || notes.trim().length < 10} onClick={() => void decide("reject")}><X aria-hidden="true"/>{l.reject}</button><button type="button" className="staff-approve" disabled={busy !== "" || notes.trim().length < 10 || !effectiveDate || Boolean(expiresDate && expiresDate <= effectiveDate)} onClick={() => void decide("approve")}><Check aria-hidden="true"/>{l.approve}</button></div>
        </section>
      </section> : <>
        <section className="staff-heading"><div><span>JURO · LEGAL SOURCES</span><h1>{l.title}</h1><p>{l.subtitle}</p></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" className={loading ? "is-spinning" : ""}/>{l.refresh}</button></section>
        <form className="staff-sync" onSubmit={(event) => void enqueueSource(event)}>
          <div>
            <h2>{l.syncTitle}</h2>
            <p id="staff-sync-hint">{l.syncHint}</p>
          </div>
          <label htmlFor="staff-source-url">{l.syncUrl}</label>
          <div className="staff-sync-controls">
            <input id="staff-source-url" name="sourceUrl" type="url" inputMode="url" autoComplete="url" required maxLength={2048} aria-describedby="staff-sync-hint" placeholder={l.syncPlaceholder} value={syncUrl} onChange={(event) => setSyncUrl(event.target.value)}/>
            <button type="submit" disabled={syncing || syncUrl.trim() === ""}>
              {syncing ? <LoaderCircle className="is-spinning" aria-hidden="true"/> : <RefreshCw aria-hidden="true"/>}
              {l.syncSubmit}
            </button>
          </div>
          {syncError && <p className="staff-sync-error" role="alert">{syncError}</p>}
          {syncConfirmation && <p className="staff-sync-confirmation" role="status">{syncConfirmation}</p>}
        </form>
        <section className="staff-filters" aria-label={l.filters}>
          <label>{l.status}<Select value={status} onChange={(event) => setStatus(event.target.value as ReviewStatus)}><option value="pending">{l.pending}</option><option value="in_review">{l.inReview}</option><option value="approved">{l.approved}</option><option value="rejected">{l.rejected}</option><option value="closed">{l.closed}</option></Select></label>
          <label>{l.scope}<Select value={scope} onChange={(event) => setScope(event.target.value)}><option value="workable">{l.workable}</option><option value="mine">{l.mine}</option><option value="unassigned">{l.unassigned}</option><option value="all">{l.all}</option></Select></label>
          <label>{l.source}<Select value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}><option value="all">{l.allSources}</option><option value="lex">lex.uz</option></Select></label>
          <label>{l.language}<Select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">{l.allLanguages}</option><option value="ru">{l.russian}</option><option value="uz">{l.uzbek}</option></Select></label>
        </section>
        <div className="staff-count">{items.length} {l.count}</div>
        {status === "pending" && eligibleItems.length > 0 && <section className="staff-bulk-toolbar" aria-label={l.bulkTitle}>
          <label><input type="checkbox" checked={allEligibleSelected} onChange={togglePageSelection}/>{l.selectPage}</label>
          <span>{l.selected}: <b>{selectedEligibleReviewIds.size}</b></span>
          <button type="button" disabled={selectedEligibleReviewIds.size === 0 || busy !== ""} onClick={() => setBulkOpen(true)}><Check aria-hidden="true"/>{l.bulkApprove}</button>
        </section>}
        <dialog ref={bulkDialogRef} className="staff-bulk-confirm" aria-labelledby="bulk-title" onClose={() => setBulkOpen(false)}>
          <h2 id="bulk-title">{l.bulkTitle}: {selectedEligibleReviewIds.size}</h2>
          <p>{l.bulkHint}</p>
          <div className="staff-applicability-dates">
            <label>{l.effectiveDate}<input type="date" required value={bulkEffectiveDate} onChange={(event) => setBulkEffectiveDate(event.target.value)}/></label>
            <label>{l.expiresDate}<input type="date" min={bulkEffectiveDate || undefined} value={bulkExpiresDate} onChange={(event) => setBulkExpiresDate(event.target.value)}/></label>
          </div>
          <label>{l.notes}<textarea autoFocus value={bulkNotes} onChange={(event) => setBulkNotes(event.target.value)} maxLength={2000} rows={4}/></label>
          <div><button type="button" onClick={() => setBulkOpen(false)} disabled={busy !== ""}>{l.bulkCancel}</button><button type="button" className="staff-approve" disabled={busy !== "" || bulkNotes.trim().length < 10 || !bulkEffectiveDate || Boolean(bulkExpiresDate && bulkExpiresDate <= bulkEffectiveDate)} onClick={() => void bulkApprove()}>{busy === "bulk" ? <LoaderCircle className="is-spinning" aria-hidden="true"/> : <Check aria-hidden="true"/>}{l.bulkConfirm}: {selectedEligibleReviewIds.size}</button></div>
        </dialog>
        {withdrawing && <section className="staff-withdrawal" aria-labelledby="withdrawal-title">
          <div><ArchiveX aria-hidden="true"/><div><h2 id="withdrawal-title">{l.withdrawalTitle}</h2><p>{l.withdrawalHint}</p><b>{withdrawing.title}</b></div></div>
          <label>{l.withdrawalNotes}<textarea value={withdrawalNotes} onChange={(event) => setWithdrawalNotes(event.target.value)} minLength={10} maxLength={2000} rows={4}/></label>
          <div><button type="button" onClick={() => { setWithdrawing(null); setWithdrawalNotes(""); }} disabled={busy !== ""}>{l.withdrawalCancel}</button><button type="button" className="staff-withdraw-confirm" onClick={() => void withdraw()} disabled={busy !== "" || withdrawalNotes.trim().length < 10}>{busy === withdrawing.reviewId ? <LoaderCircle className="is-spinning" aria-hidden="true"/> : <ArchiveX aria-hidden="true"/>}{l.withdrawalConfirm}</button></div>
        </section>}
        {error && <div className="staff-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>{l.retry}</button></div>}
        <section className="staff-queue" aria-busy={loading} aria-labelledby="queue-caption">
          <h2 id="queue-caption" className="sr-only">{l.title}</h2>
          <div className="staff-table" role="table">
            <div className="staff-table-head" role="row"><span role="columnheader" aria-label={l.selected}/><span role="columnheader">{l.sourceCol}</span><span role="columnheader">{l.reasonCol}</span><span role="columnheader">{l.stateCol}</span><span role="columnheader">{l.receivedCol}</span><span role="columnheader">{l.actionCol}</span></div>
            {loading && items.length === 0 ? Array.from({ length: 5 }, (_, index) => <div className="staff-skeleton" role="row" key={index}><i/><i/><i/><i/><i/><i/></div>) : items.map((item) => <div className="staff-table-row" role="row" key={item.reviewId}>
              <div role="cell" className="staff-select-cell">{item.status === "pending" && item.parsedSnapshotReady && <input type="checkbox" aria-label={`${l.selected}: ${item.title}`} checked={selectedEligibleReviewIds.has(item.reviewId)} onChange={() => toggleSelection(item.reviewId)}/>}</div>
              <div role="cell" data-label={l.sourceCol} className="staff-source"><span>{item.sourceKind.toUpperCase()} · {item.language.toUpperCase()}</span><b>{item.title}</b><small>{item.actIdentifier || item.canonicalId || item.sourceId}</small></div>
              <div role="cell" data-label={l.reasonCol}><code>{item.reasonCode}</code><small className={`confidence-${item.confidence}`}>{item.confidence}</small></div>
              <div role="cell" data-label={l.stateCol}><span className={`staff-status status-${item.status}`}>{statusLabel(item.status, locale)}</span>{item.versionStatus === "verified" && <small className="staff-verified"><FileCheck2 aria-hidden="true"/>{l.published}</small>}</div>
              <time role="cell" data-label={l.receivedCol} dateTime={item.createdAt}>{date(item.createdAt)}</time>
              <div role="cell" data-label={l.actionCol} className="staff-row-actions">{(item.status === "pending" || (item.status === "in_review" && item.assignedToMe)) && <button type="button" disabled={busy !== "" || !item.parsedSnapshotReady} onClick={() => void claim(item)}>{busy === item.reviewId ? <LoaderCircle className="is-spinning" aria-hidden="true"/> : <ChevronRight aria-hidden="true"/>}{item.status === "pending" ? l.claim : l.resume}</button>}{item.status === "approved" && item.versionStatus !== "verified" && item.decisionEvidenceSha256 && <button type="button" disabled={busy !== ""} onClick={() => void publish(item)}>{busy === item.reviewId ? <LoaderCircle className="is-spinning" aria-hidden="true"/> : <FileCheck2 aria-hidden="true"/>}{l.publish}</button>}{item.isCurrentPublication && item.publicationId && item.publicationEvidenceSha256 && <button type="button" className="staff-withdraw" disabled={busy !== ""} onClick={() => { setWithdrawing(item); setWithdrawalNotes(""); }}>{l.withdraw}<ArchiveX aria-hidden="true"/></button>}<a href={item.officialUrl} target="_blank" rel="noreferrer" aria-label={`${l.openOriginal}: ${item.title}`}><ArrowUpRight aria-hidden="true"/></a></div>
            </div>)}
          </div>
          {!loading && items.length === 0 && !error && <div className="staff-empty"><FileCheck2 aria-hidden="true"/><h2>{l.emptyTitle}</h2><p>{l.emptyText}</p></div>}
          {nextCursor && <button className="staff-load-more" type="button" disabled={loading} onClick={() => void load(nextCursor)}>{l.loadMore}</button>}
        </section>
      </>}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    </main>
  </div>;
}
