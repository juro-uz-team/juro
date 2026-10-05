"use client";

import { Select } from "../_components/Select";

import Image from "next/image";
import { Check, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { lawyerIntlLocale, lawyerText } from "../../lib/platform/lawyer-localization";
import type { PlatformLocale } from "../../lib/platform/routing";

type ProfileStatus =
  | "profile_incomplete"
  | "pending_review"
  | "changes_requested"
  | "public_approved"
  | "rejected"
  | "suspended"
  | "blocked"
  | "archived";
type Profile = {
  id: string;
  displayName: string;
  specialtiesJson: string;
  languagesJson: string;
  status: string;
  marketplaceStatus: ProfileStatus;
  profileRevision: number;
  experienceYears: number | null;
  priceDescription: string | null;
  consultationDurationMinutes: number;
  additionalServicesJson: string;
  availabilityStatus: string;
  nextAvailableAt: string | null;
  advocateStatus: string;
  firmName: string | null;
  bio: string | null;
  city: string | null;
  region: string | null;
  education: string | null;
  consultationFormatsJson: string;
  hasProfilePhoto: number;
  profilePhotoUrl?: string | null;
  juroApprovalStatus: "approved" | "not_approved";
  topLawyerStatus: "featured" | "not_featured";
  topLawyerCriteria: string | null;
  publicApprovedAt?: string | null;
  accountName?: string;
  email?: string | null;
  phone?: string | null;
  updatedAt: string;
};
type HistoryItem = {
  profileRevision: number;
  decision: string;
  reason: string | null;
  createdAt: string;
};
type LifecycleItem = {
  action: string;
  reason: string;
  fromMarketplaceStatus: string;
  toMarketplaceStatus: string;
  createdAt: string;
};
type Schedule = {
  rules: Array<{ weekday: number; startsAt: string; endsAt: string; timezone: string; status: string }>;
  unavailability: Array<{ startsAt: string; endsAt: string; reason: string | null }>;
};

type Localized = [string, string, string];

const statusLabels: Record<ProfileStatus, Localized> = {
  profile_incomplete: ["Не завершён", "Tugallanmagan", "Incomplete"],
  pending_review: ["Ожидает проверки", "Tekshiruv kutilmoqda", "Pending review"],
  changes_requested: ["Нужны исправления", "Tuzatish kerak", "Changes requested"],
  public_approved: ["Опубликован", "Nashr etilgan", "Published"],
  rejected: ["Отклонён", "Rad etilgan", "Rejected"],
  suspended: ["Приостановлен", "To‘xtatilgan", "Suspended"],
  blocked: ["Заблокирован", "Bloklangan", "Blocked"],
  archived: ["В архиве", "Arxivda", "Archived"],
};
const weekdays: Record<number, Localized> = {
  1: ["Пн", "Du", "Mon"], 2: ["Вт", "Se", "Tue"], 3: ["Ср", "Ch", "Wed"], 4: ["Чт", "Pa", "Thu"],
  5: ["Пт", "Ju", "Fri"], 6: ["Сб", "Sh", "Sat"], 7: ["Вс", "Ya", "Sun"],
};
const availabilityLabels: Record<string, Localized> = {
  unknown: ["не указана", "ko‘rsatilmagan", "not specified"],
  available: ["доступна", "mavjud", "available"],
  limited: ["ограничена", "cheklangan", "limited"],
  unavailable: ["недоступна", "mavjud emas", "unavailable"],
};
const advocateLabels: Record<string, Localized> = {
  not_declared: ["не заявлен", "ko‘rsatilmagan", "not declared"],
  declared: ["заявлен", "ko‘rsatilgan", "declared"],
  verified: ["подтверждён", "tasdiqlangan", "verified"],
};
const moderationDecisionLabels: Record<string, Localized> = {
  approved: ["Одобрено", "Tasdiqlangan", "Approved"],
  changes_requested: ["Запрошены исправления", "Tuzatish so‘ralgan", "Changes requested"],
  rejected: ["Отклонено", "Rad etilgan", "Rejected"],
};
const lifecycleActionLabels: Record<string, Localized> = {
  suspend: ["Приостановление", "To‘xtatish", "Suspension"],
  block: ["Блокировка", "Bloklash", "Blocking"],
  archive: ["Архивация", "Arxivlash", "Archival"],
  restore: ["Восстановление", "Tiklash", "Restoration"],
};

function asList(value: string | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function json<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json() as T;
  if (!response.ok) throw new Error(fallback);
  return payload;
}

export function LawyerProfileModerationInbox({ locale, reviewerName }: { locale: PlatformLocale; reviewerName: string }) {
  const text = useCallback(
    (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english),
    [locale],
  );
  const localized = useCallback(
    (value: Localized | undefined, fallback = "—") => value ? lawyerText(locale, value[0], value[1], value[2]) : fallback,
    [locale],
  );
  const [status, setStatus] = useState<ProfileStatus>("pending_review");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [moderationHistory, setModerationHistory] = useState<HistoryItem[]>([]);
  const [lifecycleHistory, setLifecycleHistory] = useState<LifecycleItem[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({ rules: [], unavailability: [] });
  const [decision, setDecision] = useState<"approved" | "changes_requested" | "rejected">("approved");
  const [lifecycleAction, setLifecycleAction] = useState<"suspend" | "archive" | "restore">("suspend");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const payload = await json<{ profiles: Profile[] }>(
        await fetch(`/api/platform/admin/lawyer-profiles?status=${encodeURIComponent(status)}`, { cache: "no-store" }),
        text("Не удалось загрузить очередь профилей.", "Profil navbatini yuklab bo‘lmadi.", "We could not load the profile queue."),
      );
      setProfiles(payload.profiles); setSelected(null); setAnnouncement("");
    } catch (value) { setError(value instanceof Error ? value.message : text("Не удалось выполнить запрос.", "So‘rov bajarilmadi.", "We could not complete the request.")); }
    finally { setBusy(false); }
  }, [status, text]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function open(profile: Profile) {
    setBusy(true); setError(""); setAnnouncement(""); setReason("");
    try {
      const payload = await json<{ profile: Profile; moderationHistory: HistoryItem[]; lifecycleHistory: LifecycleItem[]; schedule: Schedule }>(
        await fetch(`/api/platform/admin/lawyer-profiles/${encodeURIComponent(profile.id)}`, { cache: "no-store" }),
        text("Не удалось открыть профиль.", "Profilni ochib bo‘lmadi.", "We could not open the profile."),
      );
      setSelected(payload.profile);
      setModerationHistory(payload.moderationHistory);
      setLifecycleHistory(payload.lifecycleHistory);
      setSchedule(payload.schedule);
      setDecision("approved");
      setLifecycleAction(payload.profile.marketplaceStatus === "public_approved" ? "suspend" : "restore");
    } catch (value) { setError(value instanceof Error ? value.message : text("Не удалось выполнить запрос.", "So‘rov bajarilmadi.", "We could not complete the request.")); }
    finally { setBusy(false); }
  }

  async function submitModeration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !reason.trim()) return;
    setBusy(true); setError("");
    try {
      await json(await fetch(`/api/platform/admin/lawyer-profiles/${encodeURIComponent(selected.id)}`, {
        method: "PATCH", headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ decision, reason: reason.trim(), locale }),
      }), text("Не удалось сохранить решение.", "Qarorni saqlab bo‘lmadi.", "We could not save the decision."));
      setAnnouncement(text("Решение сохранено в защищённом журнале.", "Qaror himoyalangan jurnalga saqlandi.", "The decision was saved to the protected audit record."));
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : text("Не удалось выполнить запрос.", "So‘rov bajarilmadi.", "We could not complete the request.")); }
    finally { setBusy(false); }
  }

  async function submitLifecycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !reason.trim()) return;
    setBusy(true); setError("");
    try {
      await json(await fetch(`/api/platform/admin/lawyer-profiles/${encodeURIComponent(selected.id)}/lifecycle`, {
        method: "POST", headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ action: lifecycleAction, reason: reason.trim(), locale }),
      }), text("Не удалось обновить жизненный цикл профиля.", "Profil hayotiy siklini yangilab bo‘lmadi.", "We could not update the profile lifecycle."));
      setAnnouncement(text("Жизненный цикл профиля обновлён и записан в журнал аудита.", "Profilning hayotiy sikli yangilandi va audit jurnaliga yozildi.", "The profile lifecycle was updated and recorded in the audit log."));
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : text("Не удалось выполнить запрос.", "So‘rov bajarilmadi.", "We could not complete the request.")); }
    finally { setBusy(false); }
  }

  const date = (value: string) => new Intl.DateTimeFormat(lawyerIntlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(value));
  const profileStatusLabel = (value: string) => localized(statusLabels[value as ProfileStatus], value);

  return <div className="staff-console">
    <a className="staff-skip" href="#staff-main">{text("К очереди", "Navbatga o‘tish", "Skip to profile queue")}</a>
    <header className="staff-topbar">
      <div className="staff-brand"><ShieldCheck aria-hidden="true"/><span><b>JURO</b><small>LEGAL OPERATIONS</small></span></div>
      <div className="staff-session"><span>{text("Защищённый контур · свежая 2FA", "Himoyalangan kontur · yangi 2FA", "Protected workspace · recent 2FA")}</span><b>{reviewerName}</b></div>
      <nav className="staff-locale-links" aria-label={text("Язык интерфейса", "Interfeys tili", "Interface language")}>{(["ru", "uz", "en"] as const).map((value) => <a key={value} href={`/${value}/admin/lawyer-profiles`} hrefLang={value} aria-current={value === locale ? "page" : undefined}>{value.toUpperCase()}</a>)}</nav>
    </header>
    <main id="staff-main" className="staff-main">
      <section className="staff-heading">
        <div><span>JURO · PROFILE SAFETY</span><h1>{text("Заявки юристов", "Yurist arizalari", "Lawyer applications")}</h1><p>{text("Полный профиль, предварительный просмотр, расписание и неизменяемая история решений до публикации.", "Nashrdan oldin to‘liq profil, ko‘rib chiqish, jadval va o‘zgarmas qarorlar tarixi.", "Review the full profile, public preview, schedule, and immutable decision history before publication.")}</p></div>
        <button type="button" onClick={() => void load()} disabled={busy}><RefreshCw aria-hidden="true"/>{text("Обновить", "Yangilash", "Refresh")}</button>
      </section>
      <div className="staff-filters"><label>{text("Статус", "Holat", "Status")}<Select value={status} onChange={(event) => setStatus(event.target.value as ProfileStatus)}>{(Object.keys(statusLabels) as ProfileStatus[]).map((value) => <option key={value} value={value}>{localized(statusLabels[value])}</option>)}</Select></label></div>
      {error && <p className="staff-error" role="alert">{error}<button type="button" onClick={() => void load()}>{text("Обновить", "Yangilash", "Retry")}</button></p>}
      {announcement && <p role="status" className="staff-verified"><Check aria-hidden="true"/>{announcement}</p>}
      {!busy && profiles.length === 0 && <section className="staff-empty"><ShieldCheck aria-hidden="true"/><h2>{text("Профилей с выбранным статусом нет", "Tanlangan holatdagi profil yo‘q", "There are no profiles with the selected status")}</h2></section>}
      <section className="staff-queue" aria-busy={busy}>
        {profiles.map((profile) => <article className="staff-table-row" key={profile.id}>
          <div className="staff-source"><span>{text("Профиль", "Profil", "Profile")} · v{profile.profileRevision}</span><b>{profile.displayName}</b><small>{date(profile.updatedAt)}</small></div>
          <div><b>{asList(profile.specialtiesJson).join(", ") || text("Специализация не указана", "Mutaxassislik ko‘rsatilmagan", "Practice area not specified")}</b><p>{asList(profile.languagesJson).join(", ") || text("Языки не указаны", "Tillar ko‘rsatilmagan", "Languages not specified")}</p><p>{profile.firmName || text("Фирма не указана", "Firma ko‘rsatilmagan", "Firm not specified")} · {profile.experienceYears === null ? text("Опыт не указан", "Tajriba ko‘rsatilmagan", "Experience not specified") : text(`${profile.experienceYears} лет`, `${profile.experienceYears} yil`, `${profile.experienceYears} years`)}</p><p>{text("Доступность", "Mavjudlik", "Availability")}: {localized(availabilityLabels[profile.availabilityStatus], profile.availabilityStatus)}; {text("адвокат", "advokat", "advocate")}: {localized(advocateLabels[profile.advocateStatus], profile.advocateStatus)}</p></div>
          <div className={`staff-status status-${profile.marketplaceStatus}`}>{localized(statusLabels[profile.marketplaceStatus])}</div>
          <div className="staff-row-actions"><button type="button" onClick={() => void open(profile)} disabled={busy}>{text("Открыть", "Ochish", "Open")}</button></div>
        </article>)}
      </section>

      {selected && <section className="staff-lawyer-review" aria-labelledby="staff-lawyer-review-title">
        <header><div><small>JURO · REVIEW VIEW</small><h2 id="staff-lawyer-review-title">{selected.displayName}</h2><p>{localized(statusLabels[selected.marketplaceStatus])} · v{selected.profileRevision} · {date(selected.updatedAt)}</p></div><button type="button" onClick={() => setSelected(null)}><X aria-hidden="true"/>{text("Закрыть", "Yopish", "Close")}</button></header>
        <div className="staff-lawyer-preview">
          {selected.profilePhotoUrl ? <Image src={selected.profilePhotoUrl} alt="" width={104} height={104} unoptimized /> : <div className="staff-lawyer-photo-placeholder" aria-label={text("Фото не предоставлено", "Rasm taqdim etilmagan", "No profile photo provided")}>{selected.displayName.slice(0, 1)}</div>}
          <div><h3>{selected.displayName}</h3><p>{[selected.city, selected.region].filter(Boolean).join(" · ")}</p><p>{selected.bio || "—"}</p></div>
          <dl>
            <div><dt>Email</dt><dd>{selected.email || "—"}</dd></div><div><dt>{text("Телефон", "Telefon", "Phone")}</dt><dd>{selected.phone || "—"}</dd></div>
            <div><dt>{text("Специализации", "Mutaxassislik", "Practice areas")}</dt><dd>{asList(selected.specialtiesJson).join(", ") || "—"}</dd></div><div><dt>{text("Языки", "Tillar", "Languages")}</dt><dd>{asList(selected.languagesJson).join(", ") || "—"}</dd></div>
            <div><dt>{text("Образование", "Ta’lim", "Education")}</dt><dd>{selected.education || "—"}</dd></div><div><dt>{text("Фирма", "Firma", "Firm")}</dt><dd>{selected.firmName || "—"}</dd></div>
            <div><dt>{text("Форматы", "Formatlar", "Formats")}</dt><dd>{asList(selected.consultationFormatsJson).join(", ") || "—"}</dd></div><div><dt>{text("Стоимость", "Narx", "Fees")}</dt><dd>{selected.priceDescription || "—"}</dd></div>
            <div><dt>{text("Длительность", "Davomiyligi", "Duration")}</dt><dd>{selected.consultationDurationMinutes} {text("мин.", "daq.", "min")}</dd></div><div><dt>{text("Дополнительные услуги", "Qo‘shimcha xizmatlar", "Additional services")}</dt><dd>{asList(selected.additionalServicesJson).join(", ") || "—"}</dd></div>
          </dl>
        </div>
        <section className="staff-lawyer-evidence"><h3>{text("Подтверждающие материалы", "Tasdiqlovchi materiallar", "Supporting evidence")}</h3><p>{selected.hasProfilePhoto ? text("Фото хранится в приватном R2 и прошло обязательную проверку на вредоносное ПО; предварительный просмотр доступен выше.", "Rasm xususiy R2 da saqlanadi va zararli dasturlar bo‘yicha majburiy tekshiruvdan o‘tgan; ko‘rib chiqish yuqorida mavjud.", "The photo is stored in private R2 and passed the required malware scan; the reviewer preview appears above.") : text("Фото не предоставлено. Другие подтверждающие документы текущими правилами профиля не требуются.", "Rasm taqdim etilmagan. Boshqa hujjatlar joriy profil qoidalarida talab etilmaydi.", "No profile photo was provided. The current profile rules do not require other supporting documents.")}</p></section>
        <section className="staff-lawyer-schedule"><h3>{text("Расписание", "Jadval", "Schedule")}</h3><p>{schedule.rules.length ? schedule.rules.map((rule) => `${localized(weekdays[rule.weekday])} ${rule.startsAt}–${rule.endsAt} (${rule.timezone})`).join(" · ") : text("Рабочие интервалы не настроены.", "Ish vaqti sozlanmagan.", "No working hours have been configured.")}</p>{schedule.unavailability.map((period) => <p key={`${period.startsAt}:${period.endsAt}`}>{date(period.startsAt)} — {date(period.endsAt)}{period.reason ? ` · ${period.reason}` : ""}</p>)}</section>
        <section className="staff-lawyer-history"><h3>{text("История модерации", "Moderatsiya tarixi", "Moderation history")}</h3>{moderationHistory.length ? <ol>{moderationHistory.map((item) => <li key={`${item.profileRevision}:${item.createdAt}`}><strong>{localized(moderationDecisionLabels[item.decision], item.decision)} · v{item.profileRevision}</strong><span>{item.reason || "—"}</span><time dateTime={item.createdAt}>{date(item.createdAt)}</time></li>)}</ol> : <p>{text("Решений ещё нет.", "Hali qaror yo‘q.", "No moderation decisions yet.")}</p>}<h3>{text("Жизненный цикл и публикация", "Hayotiy sikl va nashr", "Lifecycle and publication")}</h3>{lifecycleHistory.length ? <ol>{lifecycleHistory.map((item) => <li key={`${item.action}:${item.createdAt}`}><strong>{localized(lifecycleActionLabels[item.action], item.action)}: {profileStatusLabel(item.fromMarketplaceStatus)} → {profileStatusLabel(item.toMarketplaceStatus)}</strong><span>{item.reason}</span><time dateTime={item.createdAt}>{date(item.createdAt)}</time></li>)}</ol> : <p>{text("Переходов жизненного цикла ещё нет.", "Hayotiy sikl o‘tishlari yo‘q.", "No lifecycle transitions yet.")}</p>}</section>
        {selected.marketplaceStatus === "pending_review" ? <form className="staff-decision" onSubmit={(event) => void submitModeration(event)}><h2>{text("Решение", "Qaror", "Decision")}</h2><label>{text("Решение", "Qaror", "Decision")}<Select value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)}><option value="approved">{text("Одобрить и опубликовать", "Tasdiqlash va nashr", "Approve and publish")}</option><option value="changes_requested">{text("Запросить исправления", "Tuzatish so‘rash", "Request changes")}</option><option value="rejected">{text("Отклонить", "Rad etish", "Reject")}</option></Select></label><label>{text("Комментарий и основание", "Izoh va asos", "Comment and rationale")}<textarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)}/></label><button className={decision === "approved" ? "staff-approve" : decision === "rejected" ? "staff-reject" : undefined} disabled={busy || !reason.trim()}><Check aria-hidden="true"/>{text("Сохранить решение", "Qarorni saqlash", "Save decision")}</button></form> : ["public_approved", "suspended", "blocked", "archived"].includes(selected.marketplaceStatus) ? <form className="staff-decision" onSubmit={(event) => void submitLifecycle(event)}><h2>{text("Управление публикацией", "Nashrni boshqarish", "Publication controls")}</h2><label>{text("Действие", "Amal", "Action")}<Select value={lifecycleAction} onChange={(event) => setLifecycleAction(event.target.value as typeof lifecycleAction)}>{selected.marketplaceStatus === "public_approved" ? <><option value="suspend">{text("Приостановить", "To‘xtatish", "Suspend")}</option><option value="archive">{text("Архивировать", "Arxivlash", "Archive")}</option></> : <option value="restore">{text("Восстановить и вернуть на проверку", "Tiklash va tekshiruvga qaytarish", "Restore and return to review")}</option>}</Select></label><label>{text("Комментарий и основание", "Izoh va asos", "Comment and rationale")}<textarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)}/></label><button disabled={busy || !reason.trim()}><Check aria-hidden="true"/>{text("Применить", "Qo‘llash", "Apply")}</button></form> : null}
      </section>}
    </main>
  </div>;
}
