"use client";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated handoff records are loaded after the first browser render */

import { LoaderCircle, ShieldCheck, UserRoundCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { LawyerRequestMessages } from "./LawyerRequestMessages";
import { LawyerPhoneContact } from "./LawyerPhoneContact";
import { LawyerReviewForm } from "./LawyerReviewForm";
import { ClientServiceProposals } from "./MarketplaceServiceProposalFlow";
import { LawyerConsultationPanel } from "./LawyerConsultationPanel";
import { LawyerDocumentRequests } from "./LawyerDocumentRequests";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { WorkspaceEntitlements } from "../../lib/billing/entitlements";
import { lawyerIntlLocale, lawyerText } from "../../lib/platform/lawyer-localization";
import { lawyerOfferError } from "../../lib/platform/lawyer-offer";
import { localizedHandoffError } from "../../lib/platform/lawyer-request";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";
import {
  formatLawyerRequestDate as formatRequestDate,
  lawyerRequestFormatLabel as formatLabel,
  lawyerRequestServiceLabel as serviceLabel,
} from "../../lib/platform/lawyer-request-presentation";

type CaseOption = { id: string; title: string };
type HandoffRequest = {
  id: string;
  caseId: string;
  status: string;
  createdAt: string;
  lawyerName?: string | null;
  conflictStatus?: string | null;
  activeGrantId?: string | null;
  offerId?: string | null;
  offerStatus?: string | null;
  offerScopeDescription?: string | null;
  offerPriceDescription?: string | null;
  offerDurationDescription?: string | null;
  serviceCode?: string | null;
  preferredFormat?: string | null;
  proposedStartsAt?: string | null;
};
type PublicLawyer = {
  id: string;
  displayName: string;
  specialties: string[];
  languages: string[];
  experienceYears: number | null;
  priceDescription: string | null;
  availabilityStatus: "unknown" | "available" | "limited" | "unavailable";
  nextAvailableAt: string | null;
  advocateStatus: "not_declared" | "declared" | "verified";
  firmName: string | null;
  bio: string | null;
  marketplaceStatus: "pending_review" | "public_approved";
  canReceiveRequests: boolean;
  rating: {
    reviewCount: number;
    overallAverage: number | null;
    speedAverage: number | null;
    qualityAverage: number | null;
    communicationAverage: number | null;
  };
  reviews: Array<{
    overallRating: number;
    body: string | null;
    createdAt: string;
  }>;
};

export function LawyerHandoffClient({
  locale,
  accountType,
  workspaceId,
}: {
  locale: PlatformLocale;
  accountType: AccountType;
  workspaceId?: string;
}) {
  const text = useCallback(
    (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english),
    [locale],
  );
  const selectedLawyerId = useSearchParams().get("lawyer") || "";
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [requests, setRequests] = useState<HandoffRequest[]>([]);
  const [lawyers, setLawyers] = useState<PublicLawyer[]>([]);
  const [lawyerProfileId, setLawyerProfileId] = useState("");
  const [specialtyFilter, setSpecialtyFilter] = useState("");
  const [languageFilter, setLanguageFilter] = useState("");
  const [minimumExperience, setMinimumExperience] = useState("");
  const [minimumRating, setMinimumRating] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("");
  const [advocateFilter, setAdvocateFilter] = useState("");
  const [firmFilter, setFirmFilter] = useState("");
  const [entitlements, setEntitlements] =
    useState<WorkspaceEntitlements | null>(null);
  const [caseId, setCaseId] = useState("");
  const [summary, setSummary] = useState("");
  const [serviceCode, setServiceCode] = useState("initial_consultation");
  const [preferredFormat, setPreferredFormat] = useState("video");
  const [proposedStartsAt, setProposedStartsAt] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accessActionId, setAccessActionId] = useState("");
  const [accessConsents, setAccessConsents] = useState<Record<string, boolean>>(
    {},
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [
      requestResponse,
      caseResponse,
      consultationResponse,
      lawyerResponse,
    ] = await Promise.all([
      fetch("/api/platform/lawyer-requests", { cache: "no-store" }),
      fetch("/api/platform/cases", { cache: "no-store" }),
      fetch("/api/platform/consultations", { cache: "no-store" }),
      fetch("/api/platform/lawyers", { cache: "no-store" }),
    ]);
    const requestBody = (await requestResponse.json()) as {
      requests?: HandoffRequest[];
    };
    const caseBody = (await caseResponse.json()) as {
      cases?: CaseOption[];
    };
    const consultationBody = (await consultationResponse.json()) as {
      entitlements?: WorkspaceEntitlements;
    };
    const lawyerBody = (await lawyerResponse.json()) as {
      lawyers?: PublicLawyer[];
    };
    if (
      !requestResponse.ok ||
      !caseResponse.ok ||
      !consultationResponse.ok ||
      !lawyerResponse.ok
    )
      throw new Error(
        text("Не удалось загрузить данные передачи дела.", "Ishni topshirish ma’lumotlarini yuklab bo‘lmadi.", "We could not load the lawyer handoff information."),
      );
    const nextCases = caseBody.cases || [];
    setCases(nextCases);
    setCaseId((current) => current || nextCases[0]?.id || "");
    setRequests(requestBody.requests || []);
    setEntitlements(consultationBody.entitlements || null);
    const directory = lawyerBody.lawyers || [];
    setLawyers(directory);
    if (
      selectedLawyerId &&
      directory.some((lawyer) => lawyer.id === selectedLawyerId)
    )
      setLawyerProfileId(selectedLawyerId);
  }, [selectedLawyerId, text]);

  useEffect(() => {
    void load().catch((value) =>
      setError(value instanceof Error ? value.message : String(value)),
    );
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entitlements?.lawyerHandoff || !caseId || !consent) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/platform/lawyer-requests", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({
          caseId,
          lawyerProfileId: lawyerProfileId || undefined,
          anonymizedSummary: summary,
          serviceCode,
          preferredFormat,
          proposedStartsAt: proposedStartsAt
            ? new Date(proposedStartsAt).toISOString()
            : undefined,
          consent: true,
          locale,
        }),
      });
      const body = (await response.json()) as { code?: string };
      if (!response.ok) throw new Error(localizedHandoffError(locale, body.code || "INVALID_INPUT"));
      setSummary("");
      setProposedStartsAt("");
      setConsent(false);
      setMessage(
        text("Заявка сохранена. До назначения юриста материалы дела не раскрываются.", "So‘rov saqlandi. Yurist tayinlanmaguncha ish materiallari oshkor qilinmaydi.", "Request saved. Case materials remain private until a lawyer is assigned."),
      );
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }

  async function respondToOffer(
    item: HandoffRequest,
    decision: "accepted" | "declined",
  ) {
    if (!item.offerId || item.offerStatus !== "proposed") return;
    setAccessActionId(item.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/platform/lawyer-requests/${encodeURIComponent(item.id)}/offer`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-juro-csrf": "1" },
          body: JSON.stringify({ decision, locale }),
        },
      );
      const body = (await response.json()) as { code?: string };
      if (!response.ok) throw new Error(lawyerOfferError(locale, body.code || "INVALID_INPUT"));
      setMessage(
        decision === "accepted"
          ? text("Условия юриста приняты. Оплата в платформе пока не выполняется.", "Yurist shartlari qabul qilindi. Platformada to‘lov hozircha amalga oshirilmaydi.", "The lawyer’s terms have been accepted. Payment is not processed through the platform yet.")
          : text("Условия отклонены. Юрист сможет направить обновлённое предложение.", "Shartlar rad etildi. Yurist yangilangan taklif yuborishi mumkin.", "The terms have been declined. The lawyer may send a revised offer."),
      );
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setAccessActionId("");
    }
  }
  async function updateCaseAccess(
    item: HandoffRequest,
    action: "grant" | "revoke",
  ) {
    if (action === "grant" && !accessConsents[item.id]) return;
    setAccessActionId(item.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/platform/lawyer-requests/${encodeURIComponent(item.id)}/access-grant`,
        {
          method: action === "grant" ? "POST" : "DELETE",
          headers: { "content-type": "application/json", "x-juro-csrf": "1" },
          ...(action === "grant"
            ? { body: JSON.stringify({ consent: true, locale }) }
            : {}),
        },
      );
      const body = (await response.json()) as { code?: string };
      if (!response.ok) throw new Error(localizedHandoffError(locale, body.code || "INVALID_INPUT"));
      setAccessConsents((current) => ({ ...current, [item.id]: false }));
      setMessage(
        action === "grant"
          ? text("Доступ юристу предоставлен. Это действие зафиксировано в журнале дела.", "Yuristga ruxsat berildi. Bu harakat ish jurnalida qayd etildi.", "The lawyer now has access. This action has been recorded in the case audit log.")
          : text("Доступ юриста к делу отозван. Это действие зафиксировано в журнале дела.", "Yuristning ishga ruxsati bekor qilindi. Bu harakat ish jurnalida qayd etildi.", "The lawyer’s access has been revoked. This action has been recorded in the case audit log."),
      );
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setAccessActionId("");
    }
  }

  const specialties = [
    ...new Set(lawyers.flatMap((lawyer) => lawyer.specialties)),
  ].sort();
  const languages = [
    ...new Set(lawyers.flatMap((lawyer) => lawyer.languages)),
  ].sort();
  const filteredLawyers = lawyers.filter(
    (lawyer) =>
      lawyer.canReceiveRequests &&
      (!specialtyFilter || lawyer.specialties.includes(specialtyFilter)) &&
      (!languageFilter || lawyer.languages.includes(languageFilter)) &&
      (!minimumExperience ||
        (lawyer.experienceYears ?? -1) >= Number(minimumExperience)) &&
      (!minimumRating ||
        (lawyer.rating.overallAverage ?? 0) >= Number(minimumRating)) &&
      (!availabilityFilter ||
        lawyer.availabilityStatus === availabilityFilter) &&
      (!advocateFilter || lawyer.advocateStatus === advocateFilter) &&
      (!firmFilter ||
        lawyer.firmName
          ?.toLocaleLowerCase()
          .includes(firmFilter.toLocaleLowerCase())),
  );

  return (
    <section
      className="lawyer-handoff"
      aria-labelledby="lawyer-handoff-heading"
    >
      <div className="lawyer-handoff-heading">
        <UserRoundCheck aria-hidden="true" />
        <div>
          <h2 id="lawyer-handoff-heading">
            {text("Передать дело юристу", "Ishni yuristga topshirish", "Share a case with a lawyer")}
          </h2>
          <p>
            {text("Сначала создаётся только анонимизированная заявка. Полный доступ к делу возможен лишь после conflict check и вашего отдельного подтверждения.", "Avval faqat anonimlashtirilgan so‘rov yaratiladi. Ishga to‘liq ruxsat faqat manfaatlar to‘qnashuvi tekshiruvi va sizning alohida tasdiqingizdan keyin beriladi.", "JURO first creates an anonymised request. Full case access is available only after a conflict-of-interest check and your separate confirmation.")}
          </p>
        </div>
      </div>
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
      <form onSubmit={(event) => void submit(event)}>
        <label>
          {text("Дело", "Ish", "Case")}
          <Select
            value={caseId}
            onChange={(event) => setCaseId(event.target.value)}
            disabled={!entitlements?.lawyerHandoff || busy}
          >
            {cases.length ? (
              cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))
            ) : (
              <option value="">
                {text("Нет доступных дел", "Mavjud ish yo‘q", "No cases available")}
              </option>
            )}
          </Select>
        </label>
        <fieldset className="lawyer-directory-filters">
          <legend>
            {text("Фильтры каталога юристов", "Yuristlar katalogi filtrlari", "Lawyer directory filters")}
          </legend>
          <label>
            {text("Специализация", "Mutaxassislik", "Practice area")}
            <Select
              value={specialtyFilter}
              onChange={(event) => setSpecialtyFilter(event.target.value)}
            >
              <option value="">{text("Все", "Barchasi", "All")}</option>
              {specialties.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </label>
          <label>
            {text("Язык", "Til", "Language")}
            <Select
              value={languageFilter}
              onChange={(event) => setLanguageFilter(event.target.value)}
            >
              <option value="">{text("Все", "Barchasi", "All")}</option>
              {languages.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </label>
          <label>
            {text("Стаж от", "Tajriba, kamida", "Minimum experience")}
            <Select
              value={minimumExperience}
              onChange={(event) => setMinimumExperience(event.target.value)}
            >
              <option value="">{text("Любой", "Istalgan", "Any")}</option>
              <option value="1">1</option>
              <option value="3">3</option>
              <option value="5">5</option>
              <option value="10">10</option>
            </Select>
          </label>
          <label>
            {text("Рейтинг от", "Reyting, kamida", "Minimum rating")}
            <Select
              value={minimumRating}
              onChange={(event) => setMinimumRating(event.target.value)}
            >
              <option value="">{text("Любой", "Istalgan", "Any")}</option>
              <option value="4">4/5</option>
              <option value="4.5">4.5/5</option>
            </Select>
          </label>
          <label>
            {text("Доступность", "Mavjudlik", "Availability")}
            <Select
              value={availabilityFilter}
              onChange={(event) => setAvailabilityFilter(event.target.value)}
            >
              <option value="">{text("Любая", "Istalgan", "Any")}</option>
              <option value="available">{text("Доступен", "Mavjud", "Available")}</option>
              <option value="limited">
                {text("Ограниченная", "Cheklangan", "Limited")}
              </option>
              <option value="unavailable">
                {text("Недоступен", "Mavjud emas", "Unavailable")}
              </option>
            </Select>
          </label>
          <label>
            {text("Статус адвоката", "Advokat maqomi", "Advocate status")}
            <Select
              value={advocateFilter}
              onChange={(event) => setAdvocateFilter(event.target.value)}
            >
              <option value="">{text("Любой", "Istalgan", "Any")}</option>
              <option value="verified">
                {text("Подтверждён JURO", "JURO tasdiqlagan", "Verified by JURO")}
              </option>
              <option value="declared">{text("Заявлен", "Bildirilgan", "Declared")}</option>
            </Select>
          </label>
          <label>
            {text("Фирма", "Firma", "Firm")}
            <input
              value={firmFilter}
              maxLength={180}
              onChange={(event) => setFirmFilter(event.target.value)}
            />
          </label>
        </fieldset>
        <label>
          {text("Юрист", "Yurist", "Lawyer")}
          <Select
            value={lawyerProfileId}
            onChange={(event) => setLawyerProfileId(event.target.value)}
            disabled={!entitlements?.lawyerHandoff || busy}
          >
            <option value="">
              {text("Назначить через JURO", "JURO orqali tayinlash", "Let JURO assign a lawyer")}
            </option>
            {filteredLawyers.map((lawyer) => (
              <option key={lawyer.id} value={lawyer.id}>
                {lawyer.displayName}
                {lawyer.specialties.length
                  ? ` — ${lawyer.specialties.join(", ")}`
                  : ""}
                {lawyer.rating.reviewCount
                  ? ` · ${lawyer.rating.overallAverage?.toFixed(1)}/5 (${lawyer.rating.reviewCount})`
                  : ""}
              </option>
            ))}
          </Select>
          <small>
            {text(`Найдено: ${filteredLawyers.length}`, `Topildi: ${filteredLawyers.length}`, `Found: ${filteredLawyers.length}`)}
          </small>
        </label>
        <label>
          {text("Услуга", "Xizmat", "Service")}
          <Select
            required
            value={serviceCode}
            onChange={(event) => setServiceCode(event.target.value)}
            disabled={!entitlements?.lawyerHandoff || busy}
          >
            <option value="initial_consultation">{text("Первичная консультация", "Dastlabki maslahat", "Initial consultation")}</option>
            <option value="document_review">{text("Проверка документа", "Hujjatni tekshirish", "Document review")}</option>
            <option value="case_strategy">{text("Стратегия по делу", "Ish strategiyasi", "Case strategy")}</option>
            <option value="representation">{text("Представительство", "Vakillik", "Representation")}</option>
            <option value="other">{text("Другая юридическая помощь", "Boshqa yuridik yordam", "Other legal assistance")}</option>
          </Select>
        </label>
        <label>
          {text("Предпочтительный формат", "Afzal format", "Preferred format")}
          <Select
            required
            value={preferredFormat}
            onChange={(event) => setPreferredFormat(event.target.value)}
            disabled={!entitlements?.lawyerHandoff || busy}
          >
            <option value="video">{text("Видеоконсультация", "Video maslahat", "Video consultation")}</option>
            <option value="phone">{text("Телефон", "Telefon", "Phone")}</option>
            <option value="office">{text("Очно", "Ofisda", "In person")}</option>
            <option value="chat">{text("Чат", "Chat", "Chat")}</option>
          </Select>
        </label>
        <label>
          {text("Предложить дату и время", "Sana va vaqtni taklif qilish", "Propose a date and time")}
          <input
            type="datetime-local"
            value={proposedStartsAt}
            onChange={(event) => setProposedStartsAt(event.target.value)}
            disabled={!entitlements?.lawyerHandoff || busy}
          />
        </label>
        <label>
          {text("Анонимизированное описание для conflict check", "Manfaatlar to‘qnashuvi tekshiruvi uchun anonimlashtirilgan tavsif", "Anonymised summary for the conflict check")}
          <textarea
            value={summary}
            minLength={20}
            maxLength={2000}
            required
            disabled={!entitlements?.lawyerHandoff || busy}
            onChange={(event) => setSummary(event.target.value)}
            placeholder={
              text("Без имён, реквизитов и содержания документов", "Ismlar, rekvizitlar va hujjat mazmunisiz", "Do not include names, identifiers, or document contents")
            }
          />
        </label>
        <label className="consult-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={!entitlements?.lawyerHandoff || busy}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            {text("Подтверждаю создание анонимизированной заявки; доступ к делу пока не предоставляется.", "Anonimlashtirilgan so‘rov yaratilishini tasdiqlayman; ishga ruxsat hozircha berilmaydi.", "I confirm the creation of an anonymised request. This does not grant access to the case.")}
          </span>
        </label>
        <button
          type="submit"
          disabled={
            !entitlements?.lawyerHandoff ||
            !cases.length ||
            summary.trim().length < 20 ||
            !consent ||
            busy
          }
        >
          {busy ? <LoaderCircle className="spin" /> : null}
          {text("Создать заявку", "So‘rov yaratish", "Create request")}
        </button>
      </form>
      {requests.length > 0 && (
        <div className="lawyer-handoff-list">
          <h3>
            {text("Мои заявки к юристу", "Yuristga yuborgan so‘rovlarim", "My lawyer requests")}
          </h3>
          {requests.map((item) => (
            <div key={item.id}>
              <strong>{handoffStatus(item.status, locale)}</strong>
              <span>
                {item.lawyerName ||
                  text("Ожидается назначение JURO", "JURO tayinlashi kutilmoqda", "Awaiting assignment by JURO")}
              </span>
              <time dateTime={item.createdAt}>
                {new Intl.DateTimeFormat(lawyerIntlLocale(locale), {
                  dateStyle: "medium",
                  timeZone: "Asia/Tashkent",
                }).format(new Date(item.createdAt))}
              </time>
              <div className="lawyer-request-intake">
                <span>{serviceLabel(item.serviceCode, locale)}</span>
                <span>{formatLabel(item.preferredFormat, locale)}</span>
                {item.proposedStartsAt && <time dateTime={item.proposedStartsAt}>{formatRequestDate(item.proposedStartsAt, locale)}</time>}
              </div>
              {item.status === "awaiting_user_consent" && (
                <div className="lawyer-access-action">
                  <label className="consult-consent">
                    <input
                      type="checkbox"
                      checked={Boolean(accessConsents[item.id])}
                      disabled={accessActionId === item.id}
                      onChange={(event) =>
                        setAccessConsents((current) => ({
                          ...current,
                          [item.id]: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      {text("Подтверждаю передачу выбранному юристу материалов этого дела и взаимное раскрытие наших номеров телефона для обычного звонка. Доступ можно отозвать в любой момент.", "Tanlangan yuristga ushbu ish materiallarini berish va oddiy qo‘ng‘iroq uchun telefon raqamlarimizni o‘zaro ko‘rsatishni tasdiqlayman. Ruxsatni istalgan paytda bekor qilish mumkin.", "I confirm sharing this case’s materials with the selected lawyer and the mutual disclosure of our phone numbers for a standard call. I can revoke access at any time.")}
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={
                      !accessConsents[item.id] || accessActionId === item.id
                    }
                    onClick={() => void updateCaseAccess(item, "grant")}
                  >
                    {accessActionId === item.id ? (
                      <LoaderCircle className="spin" />
                    ) : null}
                    {text("Предоставить доступ", "Ruxsat berish", "Grant access")}
                  </button>
                </div>
              )}
              {item.activeGrantId && (
                <div className="lawyer-access-action">
                  <p>
                    {text("У юриста есть доступ к материалам этого дела.", "Yurist ushbu ish materiallariga ruxsatga ega.", "The lawyer has access to this case’s materials.")}
                  </p>
                  <LawyerConsultationPanel
                    requestId={item.id}
                    locale={locale}
                    role="client"
                  />
                  <LawyerDocumentRequests requestId={item.id} locale={locale} role="client" />
                  <ClientServiceProposals
                    locale={locale}
                    accountType={accountType}
                    workspaceId={workspaceId}
                    caseId={item.caseId}
                  />
                  {item.offerId && (
                    <div className="lawyer-offer-card">
                      <strong>{offerLabel(item.offerStatus, locale)}</strong>
                      <p>{item.offerScopeDescription}</p>
                      <p>
                        {text("Стоимость: ", "Narx: ", "Fees: ")}
                        {item.offerPriceDescription}
                      </p>
                      <p>
                        {text("Срок: ", "Muddat: ", "Timeline: ")}
                        {item.offerDurationDescription}
                      </p>
                      {item.offerStatus === "proposed" && (
                        <div className="lawyer-offer-actions">
                          <button
                            type="button"
                            disabled={accessActionId === item.id}
                            onClick={() =>
                              void respondToOffer(item, "accepted")
                            }
                          >
                            {text("Принять внешние условия", "Tashqi shartlarni qabul qilish", "Accept external terms")}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={accessActionId === item.id}
                            onClick={() =>
                              void respondToOffer(item, "declined")
                            }
                          >
                            {text("Отклонить", "Rad etish", "Decline")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <LawyerPhoneContact requestId={item.id} locale={locale} />
                  <button
                    type="button"
                    className="secondary"
                    disabled={accessActionId === item.id}
                    onClick={() => void updateCaseAccess(item, "revoke")}
                  >
                    {accessActionId === item.id ? (
                      <LoaderCircle className="spin" />
                    ) : null}
                    {text("Отозвать доступ", "Ruxsatni bekor qilish", "Revoke access")}
                  </button>
                </div>
              )}
              {item.activeGrantId && (
                <LawyerRequestMessages requestId={item.id} locale={locale} />
              )}
              {item.status === "completed" && (
                <LawyerReviewForm requestId={item.id} locale={locale} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function offerLabel(status: string | null | undefined, locale: PlatformLocale) {
  const labels: Record<string, [string, string, string]> = {
    proposed: ["Предложение ожидает решения", "Taklif qarorni kutmoqda", "Offer awaiting decision"],
    accepted: ["Условия приняты", "Shartlar qabul qilindi", "Terms accepted"],
    declined: ["Условия отклонены", "Shartlar rad etildi", "Terms declined"],
  };
  const value = labels[status || ""];
  return value ? lawyerText(locale, value[0], value[1], value[2]) : status || "";
}

function handoffStatus(status: string, locale: PlatformLocale) {
  const labels: Record<string, [string, string, string]> = {
    unassigned: ["Ожидается назначение", "Tayinlash kutilmoqda", "Awaiting assignment"],
    conflict_check_pending: [
      "Проверка конфликта",
      "Manfaatlar to‘qnashuvi tekshirilmoqda",
      "Conflict check in progress",
    ],
    awaiting_user_consent: [
      "Нужно ваше подтверждение",
      "Sizning tasdig‘ingiz kerak",
      "Your confirmation is required",
    ],
    access_granted: ["Доступ предоставлен", "Ruxsat berildi", "Access granted"],
    access_revoked: ["Доступ отозван", "Ruxsat bekor qilindi", "Access revoked"],
    conflict_declined: ["Конфликт интересов", "Manfaatlar to‘qnashuvi", "Conflict of interest"],
  };
  const value = labels[status];
  return value ? lawyerText(locale, value[0], value[1], value[2]) : status;
}
