"use client";

import { Select } from "../_components/Select";

import { Check, Send, Save } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { lawyerIntlLocale, lawyerText } from "../../lib/platform/lawyer-localization";
import type { PlatformLocale } from "../../lib/platform/routing";
import { usePlatformBasePath } from "./PlatformRouteContext";

type Profile = {
  id: string;
  displayName: string;
  specialties: string[];
  languages: string[];
  status: string;
  marketplaceStatus:
    | "profile_incomplete"
    | "pending_review"
    | "changes_requested"
    | "public_approved"
    | "rejected"
    | "suspended"
    | "blocked"
    | "archived";
  publicApprovedAt: string | null;
  experienceYears: number | null;
  priceDescription: string | null;
  consultationDurationMinutes: number;
  additionalServices: string[];
  availabilityStatus: "unknown" | "available" | "limited" | "unavailable";
  nextAvailableAt: string | null;
  advocateStatus: "not_declared" | "declared" | "verified";
  firmName: string | null;
  bio: string | null;
  city: string | null;
  region: string | null;
  education: string | null;
  consultationFormats: string[];
  hasPhone: boolean;
  profilePhotoUrl: string | null;
  missingRequiredFields: string[];
  moderationReason: string | null;
  updatedAt: string;
  moderationHistory: Array<{
    profileRevision: number;
    decision: "approved" | "changes_requested" | "rejected";
    reason: string | null;
    createdAt: string;
  }>;
};

type Form = {
  displayName: string;
  specialties: string;
  languages: string;
  experienceYears: string;
  priceDescription: string;
  consultationDurationMinutes: string;
  additionalServices: string;
  availabilityStatus: Profile["availabilityStatus"];
  nextAvailableAt: string;
  advocateStatus: "not_declared" | "declared";
  firmName: string;
  bio: string;
  city: string;
  region: string;
  education: string;
  consultationFormats: string;
};

const blank: Form = {
  displayName: "",
  specialties: "",
  languages: "",
  experienceYears: "",
  priceDescription: "",
  consultationDurationMinutes: "60",
  additionalServices: "",
  availabilityStatus: "unknown",
  nextAvailableAt: "",
  advocateStatus: "not_declared",
  firmName: "",
  bio: "",
  city: "",
  region: "",
  education: "",
  consultationFormats: "",
};

const toForm = (profile: Profile): Form => ({
  displayName: profile.displayName,
  specialties: profile.specialties.join(", "),
  languages: profile.languages.join(", "),
  experienceYears:
    profile.experienceYears === null ? "" : String(profile.experienceYears),
  priceDescription: profile.priceDescription ?? "",
  consultationDurationMinutes: String(profile.consultationDurationMinutes),
  additionalServices: profile.additionalServices.join(", "),
  availabilityStatus: profile.availabilityStatus,
  nextAvailableAt: profile.nextAvailableAt
    ? profile.nextAvailableAt.slice(0, 16)
    : "",
  advocateStatus:
    profile.advocateStatus === "verified" ? "declared" : profile.advocateStatus,
  firmName: profile.firmName ?? "",
  bio: profile.bio ?? "",
  city: profile.city ?? "",
  region: profile.region ?? "",
  education: profile.education ?? "",
  consultationFormats: profile.consultationFormats.join(", "),
});

const list = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

export function LawyerProfessionalProfile({
  locale,
}: {
  locale: PlatformLocale;
}) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);
  const base = usePlatformBasePath();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [scheduleConfigured, setScheduleConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editingLocked = profile
    ? ["pending_review", "suspended", "blocked", "archived"].includes(
        profile.marketplaceStatus,
      )
    : false;

  useEffect(() => {
    fetch("/api/platform/lawyer-profile", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          profile?: Profile | null;
        };
        if (response.status === 404) {
          setUnavailable(true);
          return null;
        }
        if (!response.ok) throw new Error(lawyerText(locale, "Не удалось загрузить профессиональный профиль.", "Professional profilni yuklab bo‘lmadi.", "We could not load the professional profile."));
        return body.profile ?? null;
      })
      .then((value) => {
        setProfile(value);
        if (value) setForm(toForm(value));
      })
      .catch((value) =>
        setError(value instanceof Error ? value.message : String(value)),
      )
      .finally(() => setLoading(false));
  }, [locale]);

  useEffect(() => {
    fetch("/api/platform/lawyer-schedule", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          rules?: unknown[];
          unavailability?: unknown[];
        };
      })
      .then((value) =>
        setScheduleConfigured(
          Boolean(value?.rules?.length || value?.unavailability?.length),
        ),
      )
      .catch(() => setScheduleConfigured(false));
  }, []);

  const personalStepDone = Boolean(
    form.displayName.trim() &&
      form.city.trim() &&
      form.region.trim() &&
      profile?.profilePhotoUrl,
  );
  const professionalStepDone = Boolean(
    form.specialties.trim() &&
      form.languages.trim() &&
      form.experienceYears &&
      form.education.trim() &&
      form.firmName.trim(),
  );
  const servicesStepDone = Boolean(
    form.consultationFormats.trim() &&
      form.priceDescription.trim() &&
      form.consultationDurationMinutes &&
      form.availabilityStatus !== "unknown",
  );
  const submittedStepDone = Boolean(
    profile &&
      profile.marketplaceStatus !== "profile_incomplete" &&
      profile.marketplaceStatus !== "changes_requested",
  );
  const applicationSteps = [
    { label: text("Личные данные", "Shaxsiy ma’lumotlar", "Personal details"), done: personalStepDone },
    { label: text("Профессия", "Kasbiy ma’lumot", "Professional details"), done: professionalStepDone },
    { label: text("Услуги", "Xizmatlar", "Services"), done: servicesStepDone },
    { label: text("Расписание", "Jadval", "Schedule"), done: scheduleConfigured },
    { label: text("Предпросмотр", "Ko‘rib chiqish", "Preview"), done: true },
    { label: text("Отправка", "Yuborish", "Submission"), done: submittedStepDone },
  ];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent =
      ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)
        ?.value === "submit"
        ? "submit"
        : "draft";
    setSaving(true);
    setError("");
    setNotice("");
    const payload = {
      displayName: form.displayName,
      specialties: list(form.specialties),
      languages: list(form.languages),
      experienceYears: form.experienceYears
        ? Number(form.experienceYears)
        : null,
      priceDescription: form.priceDescription || null,
      consultationDurationMinutes: Number(form.consultationDurationMinutes),
      additionalServices: list(form.additionalServices),
      availabilityStatus: form.availabilityStatus,
      nextAvailableAt: form.nextAvailableAt
        ? new Date(form.nextAvailableAt).toISOString()
        : null,
      advocateStatus: form.advocateStatus,
      firmName: form.firmName || null,
      bio: form.bio || null,
      city: form.city || null,
      region: form.region || null,
      education: form.education || null,
      consultationFormats: list(form.consultationFormats),
      locale,
    };
    try {
      const result = await fetch("/api/platform/lawyer-profile", {
        method: profile ? "PATCH" : "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify(payload),
      });
      const body = (await result.json()) as {
        profile?: Profile;
      };
      if (!result.ok || !body.profile) throw new Error(text("Не удалось сохранить профиль.", "Profilni saqlab bo‘lmadi.", "We could not save the profile."));
      setProfile({
        ...body.profile,
        moderationHistory:
          body.profile.moderationHistory ?? profile?.moderationHistory ?? [],
      });
      setForm(toForm(body.profile));
      if (intent === "submit") {
        const submission = await fetch("/api/platform/lawyer-profile/submit", {
          method: "POST",
          headers: { "content-type": "application/json", "x-juro-csrf": "1" },
          body: JSON.stringify({ locale }),
        });
        const submissionBody = (await submission.json()) as {
          marketplaceStatus?: Profile["marketplaceStatus"];
          missingRequiredFields?: string[];
          updatedAt?: string;
        };
        if (!submission.ok) {
          if (submissionBody.missingRequiredFields?.length) {
            setProfile((current) =>
              current
                ? {
                    ...current,
                    missingRequiredFields:
                      submissionBody.missingRequiredFields ?? [],
                  }
                : current,
            );
          }
          throw new Error(text("Не удалось отправить профиль на проверку.", "Profilni tekshiruvga yuborib bo‘lmadi.", "We could not submit the profile for review."));
        }
        setProfile((current) =>
          current
            ? {
                ...current,
                marketplaceStatus:
                  submissionBody.marketplaceStatus ?? "pending_review",
                missingRequiredFields: [],
                updatedAt: submissionBody.updatedAt ?? current.updatedAt,
              }
            : current,
        );
        setNotice(
          text("Заявка отправлена на проверку JURO.", "Ariza JURO tekshiruviga yuborildi.", "Your application has been submitted for JURO review."),
        );
      } else {
        setNotice(
          text("Черновик сохранён. Отправка на проверку не выполнена.", "Qoralama saqlandi. Tekshiruvga yuborilmadi.", "Draft saved. It has not been submitted for review."),
        );
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !profile) return;
    setUploadingPhoto(true);
    setError("");
    setNotice("");
    try {
      const result = await fetch("/api/platform/lawyer-profile/photo", {
        method: "POST",
        headers: { "content-type": file.type, "x-juro-csrf": "1" },
        body: file,
      });
      const body = (await result.json()) as {
        profilePhotoUrl?: string;
        marketplaceStatus?: Profile["marketplaceStatus"];
        missingRequiredFields?: string[];
      };
      if (!result.ok || !body.profilePhotoUrl || !body.marketplaceStatus) {
        throw new Error(text("Не удалось загрузить фото.", "Rasmni yuklab bo‘lmadi.", "We could not upload the photo."));
      }
      setProfile((current) =>
        current
          ? {
              ...current,
              profilePhotoUrl: body.profilePhotoUrl ?? current.profilePhotoUrl,
              marketplaceStatus:
                body.marketplaceStatus ?? current.marketplaceStatus,
              missingRequiredFields:
                body.missingRequiredFields ?? current.missingRequiredFields,
            }
          : current,
      );
      setNotice(
        text("Фото сохранено в приватном хранилище. Теперь сохраните профиль для проверки обязательных полей.", "Rasm xususiy saqlash joyiga saqlandi. Majburiy maydonlarni tekshirish uchun profilni saqlang.", "Photo saved to private storage. Save the profile next so JURO can validate the required fields."),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setUploadingPhoto(false);
      event.target.value = "";
    }
  }

  if (loading)
    return (
      <section className="profile-panels" aria-busy="true">
        <section>
          <p>
            {text("Загрузка профессионального профиля…", "Professional profil yuklanmoqda…", "Loading professional profile…")}
          </p>
        </section>
      </section>
    );
  if (unavailable) return null;

  return (
    <section className="profile-panels lawyer-professional-profile">
      <section>
        <div
          className="lawyer-application-steps"
          aria-label={text("Этапы заявки", "Ariza bosqichlari", "Application steps")}
        >
          {applicationSteps.map((step, index) => (
            <span
              key={step.label}
              className={step.done ? "done" : ""}
            >
              {step.done ? <Check aria-hidden="true" /> : index + 1}
              <b>{step.label}</b>
            </span>
          ))}
        </div>
        <h2>{text("Заявка юриста", "Yurist arizasi", "Lawyer application")}</h2>
        <p>
          {text("Телефон хранится в защищённом профиле и не публикуется в каталоге. Запись открывается только после отдельного одобрения JURO.", "Telefon himoyalangan profilda saqlanadi va katalogda ko‘rsatilmaydi. So‘rov faqat JURO alohida tasdiqlagandan keyin ochiladi.", "Your phone number is stored in your protected account and is never published in the directory. Client requests become available only after separate JURO approval.")}
        </p>
        <p>
          {text("Статус адвоката «подтверждён» нельзя установить самостоятельно: его присваивает только JURO после проверки.", "«Tasdiqlangan» advokat maqomini mustaqil belgilab bo‘lmaydi: uni faqat JURO tekshiruvdan keyin beradi.", "You cannot mark your own advocate status as verified. Only JURO can verify it after review.")}
        </p>
        {profile && (
          <div className="lawyer-application-status" role="status">
            <strong>{statusLabel(profile.marketplaceStatus, locale)}</strong>
            <span>{statusDescription(profile.marketplaceStatus, locale)}</span>
            <time dateTime={profile.updatedAt}>
              {text("Обновлено ", "Yangilandi ", "Updated ")}
              {formatProfileDate(profile.updatedAt, locale)}
            </time>
          </div>
        )}
        {profile?.moderationHistory?.length ? (
          <section className="lawyer-moderation-history" aria-labelledby="lawyer-moderation-history-title">
            <h3 id="lawyer-moderation-history-title">
              {text("История модерации", "Moderatsiya tarixi", "Moderation history")}
            </h3>
            <ol>
              {profile.moderationHistory.map((item) => (
                <li key={`${item.profileRevision}:${item.createdAt}`}>
                  <div>
                    <strong>{moderationDecisionLabel(item.decision, locale)}</strong>
                    <span>{text(`Версия ${item.profileRevision}`, `${item.profileRevision}-versiya`, `Version ${item.profileRevision}`)}</span>
                  </div>
                  {item.reason && <p>{item.reason}</p>}
                  <time dateTime={item.createdAt}>{formatProfileDate(item.createdAt, locale)}</time>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {profile?.marketplaceStatus === "changes_requested" && (
          <section className="profile-message warning" role="status">
            <strong>
              {text("Нужно исправить профиль перед повторной проверкой.", "Qayta tekshiruvdan oldin profilni tuzatish kerak.", "Update your profile before submitting it for review again.")}
            </strong>
            <p>
              {profile.moderationReason ||
                text("Откройте поля профиля, исправьте замечания и сохраните изменения.", "Profil maydonlarini tekshiring, izohlarni tuzating va o‘zgarishlarni saqlang.", "Review the profile fields, address the moderator’s notes, and save your changes.")}
            </p>
          </section>
        )}
        {error && (
          <p className="profile-message error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="profile-message success" role="status">
            {notice}
          </p>
        )}
        <form className="profile-form" onSubmit={(event) => void save(event)}>
          <fieldset disabled={editingLocked}>
            <section className="lawyer-profile-photo">
              <label>
                {text("Фото профиля (JPEG, PNG или WebP до 2 МБ)", "Profil rasmi (2 MB gacha JPEG, PNG yoki WebP)", "Profile photo (JPEG, PNG, or WebP up to 2 MB)")}
                {profile?.profilePhotoUrl && (
                  <Image
                    src={profile.profilePhotoUrl}
                    alt=""
                    width={72}
                    height={72}
                    unoptimized
                  />
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => void uploadPhoto(event)}
                  disabled={!profile || uploadingPhoto}
                />
                {uploadingPhoto && (
                  <span>{text("Загружаем фото…", "Rasm yuklanmoqda…", "Uploading photo…")}</span>
                )}
              </label>
              <label>
                {text("Отображаемое имя", "Ko‘rsatiladigan ism", "Display name")}
                <input
                  required
                  maxLength={160}
                  value={form.displayName}
                  onChange={(event) =>
                    setForm({ ...form, displayName: event.target.value })
                  }
                />
              </label>
              <label>
                {text("Город", "Shahar", "City")}
                <input
                  required
                  maxLength={100}
                  value={form.city}
                  onChange={(event) =>
                    setForm({ ...form, city: event.target.value })
                  }
                />
              </label>
              <label>
                {text("Регион", "Hudud", "Region")}
                <input
                  required
                  maxLength={100}
                  value={form.region}
                  onChange={(event) =>
                    setForm({ ...form, region: event.target.value })
                  }
                />
              </label>
              <label>
                {text("Специализации через запятую", "Mutaxassisliklar, vergul bilan", "Practice areas, separated by commas")}
                <input
                  required
                  value={form.specialties}
                  onChange={(event) =>
                    setForm({ ...form, specialties: event.target.value })
                  }
                />
              </label>
              <label>
                {text("Языки через запятую", "Tillar, vergul bilan", "Languages, separated by commas")}
                <input
                  required
                  value={form.languages}
                  onChange={(event) =>
                    setForm({ ...form, languages: event.target.value })
                  }
                />
              </label>
              <label>
                {text("Стаж, лет", "Tajriba, yil", "Years of experience")}
                <input
                  required
                  type="number"
                  min="0"
                  max="99"
                  value={form.experienceYears}
                  onChange={(event) =>
                    setForm({ ...form, experienceYears: event.target.value })
                  }
                />
              </label>
            </section>
            <section>
              <label>
                {text("Образование", "Ta’lim", "Education")}
                <input
                  required
                  maxLength={500}
                  value={form.education}
                  onChange={(event) =>
                    setForm({ ...form, education: event.target.value })
                  }
                />
              </label>
              <label>
                {text("Фирма или место работы", "Firma yoki ish joyi", "Firm or place of work")}
                <input
                  required
                  maxLength={180}
                  value={form.firmName}
                  onChange={(event) =>
                    setForm({ ...form, firmName: event.target.value })
                  }
                />
              </label>
              <label>
                {text("Форматы консультаций через запятую", "Maslahat formatlari, vergul bilan", "Consultation formats, separated by commas")}
                <input
                  required
                  value={form.consultationFormats}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      consultationFormats: event.target.value,
                    })
                  }
                  placeholder={
                    text("Чат, телефон, очно", "Chat, telefon, oflayn", "Chat, phone, in person")
                  }
                />
              </label>
              <label>
                {text("Доступность", "Mavjudlik", "Availability")}
                <Select
                  required
                  value={form.availabilityStatus}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      availabilityStatus: event.target
                        .value as Form["availabilityStatus"],
                    })
                  }
                >
                  <option value="unknown">
                    {text("Выберите доступность", "Mavjudlikni tanlang", "Select availability")}
                  </option>
                  <option value="available">
                    {text("Доступен", "Mavjud", "Available")}
                  </option>
                  <option value="limited">
                    {text("Ограниченная", "Cheklangan", "Limited")}
                  </option>
                  <option value="unavailable">
                    {text("Недоступен", "Mavjud emas", "Unavailable")}
                  </option>
                </Select>
              </label>
              <label>
                {text("Ближайшая доступность", "Eng yaqin mavjudlik", "Next availability")}
                <input
                  type="datetime-local"
                  value={form.nextAvailableAt}
                  onChange={(event) =>
                    setForm({ ...form, nextAvailableAt: event.target.value })
                  }
                />
              </label>
              <label>
                {text("Статус адвоката", "Advokat maqomi", "Advocate status")}
                <Select
                  value={form.advocateStatus}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      advocateStatus: event.target
                        .value as Form["advocateStatus"],
                    })
                  }
                >
                  <option value="not_declared">
                    {text("Не заявлен", "Bildirilmagan", "Not declared")}
                  </option>
                  <option value="declared">
                    {text("Заявлен, не подтверждён JURO", "Bildirilgan, JURO tasdiqlamagan", "Declared, not verified by JURO")}
                  </option>
                </Select>
              </label>
              <label>
                {text("Описание цены", "Narx tavsifi", "Fee description")}
                <input
                  required
                  maxLength={280}
                  value={form.priceDescription}
                  onChange={(event) =>
                    setForm({ ...form, priceDescription: event.target.value })
                  }
                />
              </label>
              <label>
                {text("Стандартная длительность консультации, минут", "Maslahatning standart davomiyligi, daqiqa", "Standard consultation duration, minutes")}
                <input
                  required
                  type="number"
                  min="15"
                  max="480"
                  step="15"
                  value={form.consultationDurationMinutes}
                  onChange={(event) =>
                    setForm({ ...form, consultationDurationMinutes: event.target.value })
                  }
                />
              </label>
              <label>
                {text("Дополнительные услуги через запятую", "Qo‘shimcha xizmatlar, vergul bilan", "Additional services, separated by commas")}
                <input
                  value={form.additionalServices}
                  onChange={(event) =>
                    setForm({ ...form, additionalServices: event.target.value })
                  }
                  placeholder={text("Письменное заключение, проверка договора", "Yozma xulosa, shartnomani tekshirish", "Written opinion, contract review")}
                />
              </label>
              <label>
                {text("О себе", "O‘zingiz haqingizda", "About you")}
                <textarea
                  maxLength={2000}
                  value={form.bio}
                  onChange={(event) =>
                    setForm({ ...form, bio: event.target.value })
                  }
                />
              </label>
            </section>
            <section className="lawyer-profile-preview">
              <div>
                <strong>{text("Шаг 4 · Расписание", "4-bosqich · Jadval", "Step 4 · Schedule")}</strong>
                <p>{text("Рабочие дни, свободное время, перерывы и временная недоступность настраиваются в календаре. Часовой пояс: Asia/Tashkent.", "Ish kunlari, bo‘sh vaqt, tanaffuslar va vaqtincha bandlik kalendarda sozlanadi. Vaqt mintaqasi: Asia/Tashkent.", "Set working days, available times, breaks, and temporary unavailability in the calendar. Time zone: Asia/Tashkent.")}</p>
              </div>
              <Link className="btn btn-primary" href={`${base}/calendar`}>{text("Настроить расписание", "Jadvalni sozlash", "Set schedule")}</Link>
            </section>
          </fieldset>
          <section
            className="lawyer-profile-preview"
            aria-labelledby="lawyer-profile-preview-title"
          >
            <header>
              <div>
                <small>{text("Предпросмотр", "Ko‘rib chiqish", "Preview")}</small>
                <h3 id="lawyer-profile-preview-title">
                  {text("Предпросмотр публичного профиля", "Ommaviy profilni ko‘rib chiqish", "Public profile preview")}
                </h3>
              </div>
              <span>{text("Виден только вам", "Faqat sizga ko‘rinadi", "Visible only to you")}</span>
            </header>
            <div className="lawyer-profile-preview-card">
              {profile?.profilePhotoUrl ? (
                <Image
                  src={profile.profilePhotoUrl}
                  alt=""
                  width={88}
                  height={88}
                  unoptimized
                />
              ) : (
                <div className="lawyer-profile-preview-photo" aria-hidden="true">
                  {form.displayName.trim().slice(0, 1).toUpperCase() || "J"}
                </div>
              )}
              <div>
                <h4>{form.displayName.trim() || text("Имя юриста", "Yurist ismi", "Lawyer name")}</h4>
                <p>{[form.city, form.region].filter(Boolean).join(" · ") || "—"}</p>
                <div className="lawyer-profile-preview-tags">
                  {list(form.specialties).map((value) => <span key={value}>{value}</span>)}
                  {list(form.languages).map((value) => <span key={value}>{value}</span>)}
                </div>
              </div>
              <dl>
                <div><dt>{text("Стаж", "Tajriba", "Experience")}</dt><dd>{form.experienceYears ? text(`${form.experienceYears} лет`, `${form.experienceYears} yil`, `${form.experienceYears} years`) : "—"}</dd></div>
                <div><dt>{text("Образование", "Ta’lim", "Education")}</dt><dd>{form.education || "—"}</dd></div>
                <div><dt>{text("Место работы", "Ish joyi", "Place of work")}</dt><dd>{form.firmName || "—"}</dd></div>
                <div><dt>{text("Форматы", "Formatlar", "Formats")}</dt><dd>{list(form.consultationFormats).join(", ") || "—"}</dd></div>
                <div><dt>{text("Стоимость", "Narx", "Fees")}</dt><dd>{form.priceDescription || "—"}</dd></div>
                <div><dt>{text("Длительность", "Davomiyligi", "Duration")}</dt><dd>{form.consultationDurationMinutes ? text(`${form.consultationDurationMinutes} мин.`, `${form.consultationDurationMinutes} daq.`, `${form.consultationDurationMinutes} min`) : "—"}</dd></div>
                <div><dt>{text("Доступность", "Mavjudlik", "Availability")}</dt><dd>{availabilityLabel(form.availabilityStatus, locale)}</dd></div>
              </dl>
              {list(form.additionalServices).length > 0 && <p className="lawyer-profile-preview-bio"><strong>{text("Дополнительные услуги: ", "Qo‘shimcha xizmatlar: ", "Additional services: ")}</strong>{list(form.additionalServices).join(" · ")}</p>}
              {form.bio && <p className="lawyer-profile-preview-bio">{form.bio}</p>}
            </div>
          </section>
          {profile?.missingRequiredFields.length ? (
            <p className="lawyer-required-fields" role="status">
              {text("До отправки заполните: ", "Yuborishdan oldin to‘ldiring: ", "Complete before submitting: ")}
              {profile.missingRequiredFields
                .map((field) => requiredFieldLabel(field, locale))
                .join(", ")}
            </p>
          ) : null}
          <div className="lawyer-application-actions">
            <button
              type="submit"
              name="intent"
              value="draft"
              formNoValidate
              disabled={saving || uploadingPhoto}
            >
              {!saving && <Save aria-hidden="true" />}
              {text("Сохранить черновик", "Qoralamani saqlash", "Save draft")}
            </button>
            <button
              type="submit"
              name="intent"
              value="submit"
              disabled={
                saving ||
                uploadingPhoto ||
                profile?.marketplaceStatus === "pending_review" ||
                profile?.marketplaceStatus === "public_approved"
              }
            >
              {!saving && <Send aria-hidden="true" />}
              {text("Отправить профиль на проверку", "Profilni tekshiruvga yuborish", "Submit profile for review")}
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}

function statusLabel(status: Profile["marketplaceStatus"], locale: PlatformLocale) {
  const labels: Record<Profile["marketplaceStatus"], [string, string, string]> = {
    profile_incomplete: ["Черновик", "Qoralama", "Draft"],
    pending_review: ["На проверке JURO", "JURO tekshiruvida", "Under JURO review"],
    changes_requested: ["Нужны изменения", "O‘zgartirish kerak", "Changes requested"],
    public_approved: ["Профиль опубликован", "Profil nashr etilgan", "Profile published"],
    rejected: ["Заявка отклонена", "Ariza rad etilgan", "Application rejected"],
    suspended: ["Профиль приостановлен", "Profil to‘xtatilgan", "Profile suspended"],
    blocked: ["Профиль заблокирован", "Profil bloklangan", "Profile blocked"],
    archived: ["Профиль в архиве", "Profil arxivda", "Profile archived"],
  };
  return lawyerText(locale, labels[status][0], labels[status][1], labels[status][2]);
}

function statusDescription(status: Profile["marketplaceStatus"], locale: PlatformLocale) {
  const descriptions: Record<Profile["marketplaceStatus"], [string, string, string]> = {
    profile_incomplete: [
      "Данные сохраняются как черновик и не видны в каталоге.",
      "Ma’lumotlar qoralama sifatida saqlanadi va katalogda ko‘rinmaydi.",
      "Your information is saved as a draft and is not visible in the directory.",
    ],
    pending_review: [
      "Редактирование временно закрыто до решения модерации.",
      "Moderatsiya qarorigacha tahrirlash vaqtincha yopilgan.",
      "Editing is temporarily locked until moderation is complete.",
    ],
    changes_requested: [
      "Исправьте замечания и отправьте заявку повторно.",
      "Izohlarni tuzating va arizani qayta yuboring.",
      "Address the reviewer’s notes and submit the application again.",
    ],
    public_approved: [
      "Публичная карточка доступна клиентам.",
      "Ommaviy karta mijozlarga ochiq.",
      "Your public profile is available to clients.",
    ],
    rejected: [
      "Причина решения отображается ниже, если она доступна.",
      "Qaror sababi mavjud bo‘lsa, quyida ko‘rsatiladi.",
      "The reason for the decision appears below when available.",
    ],
    suspended: [
      "Публичная карточка и новые заявки временно недоступны.",
      "Ommaviy karta va yangi so‘rovlar vaqtincha mavjud emas.",
      "Your public profile and new client requests are temporarily unavailable.",
    ],
    blocked: [
      "Доступ к профессиональным действиям заблокирован решением JURO.",
      "Professional amallarga kirish JURO qarori bilan bloklangan.",
      "Access to professional actions has been blocked by a JURO decision.",
    ],
    archived: [
      "Профиль снят с публикации и помещён в архив.",
      "Profil nashrdan olib tashlangan va arxivga joylangan.",
      "The profile has been unpublished and moved to the archive.",
    ],
  };
  return lawyerText(locale, descriptions[status][0], descriptions[status][1], descriptions[status][2]);
}

function availabilityLabel(status: Form["availabilityStatus"], locale: PlatformLocale) {
  const labels: Record<Form["availabilityStatus"], [string, string, string]> = {
    unknown: ["Не указана", "Ko‘rsatilmagan", "Not specified"],
    available: ["Доступен", "Mavjud", "Available"],
    limited: ["Ограниченная", "Cheklangan", "Limited"],
    unavailable: ["Недоступен", "Mavjud emas", "Unavailable"],
  };
  return lawyerText(locale, labels[status][0], labels[status][1], labels[status][2]);
}

function moderationDecisionLabel(
  decision: Profile["moderationHistory"][number]["decision"],
  locale: PlatformLocale,
) {
  const labels = {
    approved: ["Одобрена и опубликована", "Tasdiqlandi va nashr qilindi", "Approved and published"],
    changes_requested: ["Запрошены изменения", "O‘zgartirishlar so‘raldi", "Changes requested"],
    rejected: ["Отклонена", "Rad etildi", "Rejected"],
  } satisfies Record<typeof decision, [string, string, string]>;
  return lawyerText(locale, labels[decision][0], labels[decision][1], labels[decision][2]);
}

function formatProfileDate(value: string, locale: PlatformLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(lawyerIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(date);
}

function requiredFieldLabel(field: string, locale: PlatformLocale) {
  const labels: Record<string, [string, string, string]> = {
    displayName: ["имя", "ism", "display name"],
    specialties: ["специализации", "mutaxassisliklar", "practice areas"],
    languages: ["языки", "tillar", "languages"],
    experienceYears: ["стаж", "tajriba", "experience"],
    education: ["образование", "ta’lim", "education"],
    firmName: ["место работы", "ish joyi", "place of work"],
    city: ["город", "shahar", "city"],
    region: ["регион", "hudud", "region"],
    priceDescription: ["стоимость", "narx", "fees"],
    consultationFormats: ["форматы консультаций", "konsultatsiya formatlari", "consultation formats"],
    profilePhoto: ["фото", "rasm", "profile photo"],
    phone: ["телефон в основном профиле", "asosiy profildagi telefon", "phone number in your account profile"],
    availabilityStatus: ["доступность", "mavjudlik", "availability"],
  };
  const value = labels[field];
  return value ? lawyerText(locale, value[0], value[1], value[2]) : field;
}
