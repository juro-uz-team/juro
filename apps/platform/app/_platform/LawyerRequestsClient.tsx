"use client";

import { WorkspaceTitle } from "./WorkspaceTitle";
import { WorkspacePagination, useWorkspacePagination } from "./WorkspacePagination";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated assigned requests are loaded after the first browser render */

import {
  LoaderCircle,
  ShieldCheck,
  ShieldX,
  UserRoundCheck,
} from "lucide-react";
import { LawyerRequestMessages } from "./LawyerRequestMessages";
import { LawyerPhoneContact } from "./LawyerPhoneContact";
import { LawyerReviewReplyForm } from "./LawyerReviewReplyForm";
import { LawyerServiceProposalForm } from "./MarketplaceServiceProposalFlow";
import { LawyerConsultationPanel } from "./LawyerConsultationPanel";
import { LawyerDocumentRequests } from "./LawyerDocumentRequests";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { lawyerIntlLocale, lawyerText } from "../../lib/platform/lawyer-localization";
import { lawyerOfferError } from "../../lib/platform/lawyer-offer";
import { localizedHandoffError } from "../../lib/platform/lawyer-request";
import type { PlatformLocale } from "../../lib/platform/routing";
import {
  formatLawyerRequestDate as formatRequestDate,
  lawyerRequestFormatLabel as formatLabel,
  lawyerRequestServiceLabel as serviceLabel,
} from "../../lib/platform/lawyer-request-presentation";

type AssignedRequest = {
  id: string;
  status: string;
  anonymizedSummary: string;
  createdAt: string;
  conflictStatus?: string | null;
  accessGrantId?: string | null;
  paidTransfer?: string | null;
  accessGrantedAt?: string | null;
  caseId?: string | null;
  caseTitle?: string | null;
  caseDescription?: string | null;
  legalArea?: string | null;
  caseStatus?: string | null;
  offerId?: string | null;
  offerStatus?: string | null;
  offerScopeDescription?: string | null;
  offerPriceDescription?: string | null;
  offerDurationDescription?: string | null;
  reviewId?: string | null;
  reviewOverallRating?: number | null;
  reviewBody?: string | null;
  reviewReplyId?: string | null;
  reviewReplyStatus?: "pending" | "approved" | "rejected" | null;
  reviewReplyBody?: string | null;
  reviewReplyVersion?: number | null;
  serviceCode?: string | null;
  preferredFormat?: string | null;
  proposedStartsAt?: string | null;
};

export function LawyerRequestsClient({ locale }: { locale: PlatformLocale }) {
  const text = useCallback(
    (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english),
    [locale],
  );
  const [requests, setRequests] = useState<AssignedRequest[]>([]);
  const [linkedRequest, setLinkedRequest] = useState("");
  useEffect(() => {
    const readLink = () => setLinkedRequest(location.hash.slice(1));
    readLink();
    addEventListener("hashchange", readLink);
    return () => removeEventListener("hashchange", readLink);
  }, []);
  const linkedIndex = Math.max(0, requests.findIndex(item => `request-${item.id}` === linkedRequest));
  const pagination = useWorkspacePagination(requests.length, 1, linkedRequest, linkedIndex);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [offerDrafts, setOfferDrafts] = useState<
    Record<
      string,
      {
        scopeDescription: string;
        priceDescription: string;
        durationDescription: string;
      }
    >
  >({});

  const load = useCallback(async () => {
    const response = await fetch("/api/platform/lawyer-requests/assigned", {
      cache: "no-store",
    });
    const body = (await response.json()) as {
      requests?: AssignedRequest[];
    };
    if (!response.ok) throw new Error(text("Не удалось загрузить заявки.", "So‘rovlarni yuklab bo‘lmadi.", "We could not load your requests."));
    setRequests(body.requests || []);
  }, [text]);

  useEffect(() => {
    void load()
      .catch((value) =>
        setError(value instanceof Error ? value.message : String(value)),
      )
      .finally(() => setLoading(false));
  }, [load]);

  async function decide(item: AssignedRequest, decision: "clear" | "conflict") {
    setActionId(item.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/platform/lawyer-requests/${encodeURIComponent(item.id)}/conflict-check`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-juro-csrf": "1" },
          body: JSON.stringify({ decision, locale }),
        },
      );
      const body = (await response.json()) as { code?: string };
      if (!response.ok) throw new Error(localizedHandoffError(locale, body.code || "INVALID_INPUT"));
      setMessage(
        decision === "clear"
          ? text("Проверка завершена: теперь владелец дела сам решает, предоставлять ли доступ.", "Tekshiruv tugallandi: endi ish egasi ruxsat berishni mustaqil hal qiladi.", "Conflict check complete. The case owner will now decide whether to grant access.")
          : text("Конфликт отмечен. Материалы дела не будут раскрыты.", "Manfaatlar to‘qnashuvi belgilandi. Ish materiallari oshkor qilinmaydi.", "Conflict recorded. The case materials will not be disclosed."),
      );
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setActionId("");
    }
  }

  async function complete(item: AssignedRequest) {
    setActionId(item.id);
    setError("");
    try {
      const response = await fetch(
        `/api/platform/lawyer-requests/${encodeURIComponent(item.id)}/completion`,
        { method: "POST", headers: { "x-juro-csrf": "1" } },
      );
      const body = (await response.json()) as { code?: string };
      if (!response.ok) throw new Error(localizedHandoffError(locale, body.code || "REQUEST_UNAVAILABLE"));
      setMessage(
        text("Работа отмечена завершённой.", "Ish yakunlandi deb belgilandi.", "The work has been marked as complete."),
      );
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setActionId("");
    }
  }

  async function submitOffer(
    event: FormEvent<HTMLFormElement>,
    item: AssignedRequest,
  ) {
    event.preventDefault();
    const draft = offerDrafts[item.id];
    if (!draft) return;
    setActionId(item.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/platform/lawyer-requests/${encodeURIComponent(item.id)}/offer`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-juro-csrf": "1" },
          body: JSON.stringify({ ...draft, locale }),
        },
      );
      const body = (await response.json()) as { code?: string };
      if (!response.ok) throw new Error(lawyerOfferError(locale, body.code || "INVALID_INPUT"));
      setMessage(
        text("Предложение сохранено и ожидает решения владельца дела.", "Taklif saqlandi va ish egasining qarorini kutmoqda.", "The offer has been saved and is awaiting the case owner’s decision."),
      );
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setActionId("");
    }
  }

  return (
    <section
      className="lawyer-requests workspace-page"
      aria-labelledby="lawyer-requests-heading"
    >
      <WorkspaceTitle icon={<UserRoundCheck />} title={text("Заявки по вашим делам", "Sizga yuborilgan so‘rovlar", "Client requests")} id="lawyer-requests-heading" description={text("До вашего положительного conflict check видна только анонимизированная информация. Полные материалы открываются лишь после отдельного согласия владельца дела.", "Sizning ijobiy manfaatlar to‘qnashuvi tekshiruvingizgacha faqat anonimlashtirilgan ma’lumot ko‘rinadi. To‘liq materiallar faqat ish egasining alohida roziligidan keyin ochiladi.", "Only anonymised information is visible until you clear the conflict-of-interest check. Full case materials become available only after the case owner gives separate consent.")} />
      {error && (
        <p className="plan-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="lawyer-handoff-success" role="status">
          <ShieldCheck aria-hidden="true" />
          {message}
        </p>
      )}
      {loading ? (
        <LoaderCircle className="spin" />
      ) : requests.length ? (
        <div className="lawyer-request-list">
          <WorkspacePagination locale={locale} {...pagination} />
          {requests.slice(pagination.from, pagination.to).map((item) => (
            <article id={`request-${item.id}`} key={item.id}>
              <div className="lawyer-request-summary">
                <strong>{lawyerRequestStatus(item.status, locale)}</strong>
                <time dateTime={item.createdAt}>
                  {new Intl.DateTimeFormat(lawyerIntlLocale(locale), {
                    dateStyle: "medium",
                    timeZone: "Asia/Tashkent",
                  }).format(new Date(item.createdAt))}
                </time>
                <p>{item.anonymizedSummary}</p>
                <div className="lawyer-request-intake">
                  <span>{serviceLabel(item.serviceCode, locale)}</span>
                  <span>{formatLabel(item.preferredFormat, locale)}</span>
                  {item.proposedStartsAt && <time dateTime={item.proposedStartsAt}>{formatRequestDate(item.proposedStartsAt, locale)}</time>}
                </div>
              </div>
              {item.status === "conflict_check_pending" && (
                <div className="lawyer-conflict-actions">
                  <p>
                    {text("Нажимая «Конфликта нет», я соглашаюсь после отдельного разрешения владельца взаимно раскрыть наши номера телефона для обычного звонка. JURO звонок не записывает.", "«To‘qnashuv yo‘q» tugmasini bosib, egasining alohida ruxsatidan keyin oddiy qo‘ng‘iroq uchun telefon raqamlarimizni o‘zaro ko‘rsatishga rozilik beraman. JURO qo‘ng‘iroqni yozmaydi.", "By selecting “No conflict”, I agree that our phone numbers may be disclosed to each other for a standard call after the case owner gives separate permission. JURO does not record the call.")}
                  </p>
                  <button
                    type="button"
                    disabled={actionId === item.id}
                    onClick={() => void decide(item, "clear")}
                  >
                    {actionId === item.id ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <ShieldCheck aria-hidden="true" />
                    )}
                    {text("Конфликта нет · согласен на контакт", "To‘qnashuv yo‘q · aloqaga roziman", "No conflict · agree to contact")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={actionId === item.id}
                    onClick={() => void decide(item, "conflict")}
                  >
                    {actionId === item.id ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <ShieldX aria-hidden="true" />
                    )}
                    {text("Есть конфликт", "To‘qnashuv bor", "Conflict identified")}
                  </button>
                </div>
              )}
              {item.accessGrantId ? (
                <>
                  <div className="lawyer-case-access">
                    <strong>
                      {text("Доступ к делу предоставлен", "Ishga ruxsat berildi", "Case access granted")}
                    </strong>
                    <p>
                      {item.caseTitle || text("Дело", "Ish", "Case")}
                      {item.legalArea ? ` · ${item.legalArea}` : ""}
                    </p>
                    {item.caseDescription && <p>{item.caseDescription}</p>}
                  </div>
                  <LawyerConsultationPanel
                    requestId={item.id}
                    locale={locale}
                    role="lawyer"
                  />
                  <LawyerDocumentRequests requestId={item.id} locale={locale} role="lawyer" />
                  <LawyerPhoneContact requestId={item.id} locale={locale} />
                  {item.caseId && (
                    <LawyerServiceProposalForm
                      locale={locale}
                      requestId={item.id}
                      caseId={item.caseId}
                      onSubmitted={load}
                    />
                  )}
                  {item.offerId && (
                    <div className="lawyer-offer-card">
                      <strong>{offerStatus(item.offerStatus, locale)}</strong>
                      <p>{item.offerScopeDescription}</p>
                      <p>
                        {text("Стоимость: ", "Narx: ", "Fees: ")}
                        {item.offerPriceDescription}
                      </p>
                      <p>
                        {text("Срок: ", "Muddat: ", "Timeline: ")}
                        {item.offerDurationDescription}
                      </p>
                    </div>
                  )}
                  {(!item.offerId || item.offerStatus === "declined") && (
                    <form
                      className="lawyer-offer-form"
                      onSubmit={(event) => void submitOffer(event, item)}
                    >
                      <h2>
                        {text("Внешнее предложение без оплаты в JURO", "JURO orqali to‘lovsiz tashqi taklif", "External offer without payment through JURO")}
                      </h2>
                      <label>
                        {text("Объём работы", "Ish hajmi", "Scope of work")}
                        <textarea
                          required
                          minLength={20}
                          maxLength={2000}
                          value={offerDrafts[item.id]?.scopeDescription || ""}
                          onChange={(event) =>
                            setOfferDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                scopeDescription: event.target.value,
                                priceDescription:
                                  current[item.id]?.priceDescription || "",
                                durationDescription:
                                  current[item.id]?.durationDescription || "",
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        {text("Стоимость", "Narx", "Fees")}
                        <input
                          required
                          minLength={2}
                          maxLength={500}
                          value={offerDrafts[item.id]?.priceDescription || ""}
                          onChange={(event) =>
                            setOfferDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                scopeDescription:
                                  current[item.id]?.scopeDescription || "",
                                priceDescription: event.target.value,
                                durationDescription:
                                  current[item.id]?.durationDescription || "",
                              },
                            }))
                          }
                        />
                      </label>
                      <label>
                        {text("Срок", "Muddat", "Timeline")}
                        <input
                          required
                          minLength={2}
                          maxLength={500}
                          value={
                            offerDrafts[item.id]?.durationDescription || ""
                          }
                          onChange={(event) =>
                            setOfferDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                scopeDescription:
                                  current[item.id]?.scopeDescription || "",
                                priceDescription:
                                  current[item.id]?.priceDescription || "",
                                durationDescription: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <button type="submit" disabled={actionId === item.id}>
                        {actionId === item.id ? (
                          <LoaderCircle className="spin" />
                        ) : null}
                        {text("Отправить внешние условия", "Tashqi shartlarni yuborish", "Send external terms")}
                      </button>
                    </form>
                  )}
                </>
              ) : (
                <p className="lawyer-request-privacy">
                  {text("Материалы дела недоступны, пока владелец не предоставит доступ.", "Ish egasi ruxsat bermaguncha ish materiallari mavjud emas.", "Case materials remain unavailable until the case owner grants access.")}
                </p>
              )}
              {item.offerStatus === "accepted" &&
                item.status === "offer_accepted" && (
                  <button
                    type="button"
                    onClick={() => void complete(item)}
                    disabled={actionId === item.id}
                  >
                    {text("Отметить работу завершённой", "Ishni yakunlangan deb belgilash", "Mark work as complete")}
                  </button>
                )}
              {(item.accessGrantId || (item.paidTransfer === "required" && item.status === "awaiting_user_consent")) && (
                <LawyerRequestMessages requestId={item.id} locale={locale} />
              )}
              {item.reviewId && item.reviewOverallRating && (
                <LawyerReviewReplyForm
                  reviewId={item.reviewId}
                  reviewBody={item.reviewBody ?? null}
                  overallRating={item.reviewOverallRating}
                  replyBody={item.reviewReplyBody}
                  replyStatus={item.reviewReplyStatus}
                  replyVersion={item.reviewReplyVersion}
                  locale={locale}
                  onSubmitted={load}
                />
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="consult-empty">
          <UserRoundCheck aria-hidden="true" />
          <h2>
            {text("Назначенных заявок пока нет", "Hozircha tayinlangan so‘rovlar yo‘q", "No assigned requests yet")}
          </h2>
          <p>
            {text("JURO не создаёт демонстрационные заявки. Новая запись появится только после реального назначения.", "JURO namoyish so‘rovlarini yaratmaydi. Yangi yozuv faqat haqiqiy tayinlashdan keyin paydo bo‘ladi.", "JURO does not create demonstration requests. A new request appears only after a real assignment.")}
          </p>
        </div>
      )}
    </section>
  );
}

function offerStatus(status: string | null | undefined, locale: PlatformLocale) {
  const labels: Record<string, [string, string, string]> = {
    proposed: ["Предложение ожидает решения", "Taklif qarorni kutmoqda", "Offer awaiting decision"],
    accepted: ["Условия приняты", "Shartlar qabul qilindi", "Terms accepted"],
    declined: ["Условия отклонены", "Shartlar rad etildi", "Terms declined"],
  };
  const value = labels[status || ""];
  return value ? lawyerText(locale, value[0], value[1], value[2]) : status || "";
}

function lawyerRequestStatus(status: string, locale: PlatformLocale) {
  const labels: Record<string, [string, string, string]> = {
    conflict_check_pending: [
      "Требуется проверка конфликта",
      "Manfaatlar to‘qnashuvini tekshirish kerak",
      "Conflict check required",
    ],
    awaiting_user_consent: [
      "Ожидается решение владельца",
      "Ish egasining qarori kutilmoqda",
      "Awaiting case owner decision",
    ],
    access_granted: ["Доступ к делу предоставлен", "Ishga ruxsat berildi", "Case access granted"],
    access_revoked: ["Доступ отозван", "Ruxsat bekor qilindi", "Access revoked"],
    conflict_declined: ["Конфликт интересов", "Manfaatlar to‘qnashuvi", "Conflict of interest"],
  };
  const value = labels[status];
  return value ? lawyerText(locale, value[0], value[1], value[2]) : status;
}
