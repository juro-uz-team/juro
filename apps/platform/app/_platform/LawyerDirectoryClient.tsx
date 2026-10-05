"use client";

import { Select } from "../_components/Select";

import Link from "next/link";
import Image from "next/image";
import { CircleAlert, Crown, LoaderCircle, Scale, ShieldCheck, Star, UserRound, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { lawyerText } from "../../lib/platform/lawyer-localization";
import { platformBasePath, type AccountType, type PlatformLocale } from "../../lib/platform/routing";

type Lawyer = {
  id: string;
  displayName: string;
  specialties: string[];
  languages: string[];
  experienceYears: number | null;
  priceDescription: string | null;
  consultationDurationMinutes: number;
  additionalServices: string[];
  availabilityStatus: "unknown" | "available" | "limited" | "unavailable";
  nextAvailableAt: string | null;
  advocateStatus: "not_declared" | "declared" | "verified";
  firmName: string | null;
  bio: string | null;
  marketplaceStatus: "pending_review" | "public_approved";
  canReceiveRequests: boolean;
  city: string | null;
  region: string | null;
  education: string | null;
  consultationFormats: string[];
  profilePhotoUrl: string | null;
  juroApproved: boolean;
  topLawyer: boolean;
  topLawyerCriteria: string | null;
  rating: { reviewCount: number; overallAverage: number | null };
};

const availability: Record<Lawyer["availabilityStatus"], [string, string, string]> = {
  available: ["Доступен", "Mavjud", "Available"],
  limited: ["Ограниченная доступность", "Cheklangan mavjudlik", "Limited availability"],
  unavailable: ["Недоступен", "Mavjud emas", "Unavailable"],
  unknown: ["Доступность не указана", "Mavjudlik ko‘rsatilmagan", "Availability not specified"],
};

export function LawyerDirectoryClient({ locale, accountType, workspaceId }: { locale: PlatformLocale; accountType: AccountType; workspaceId?: string }) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);
  const localized = <T,>(values: [T, T, T]) => lawyerText(locale, values[0], values[1], values[2]);
  const base = platformBasePath(locale, accountType, workspaceId);
  const [lawyers, setLawyers] = useState<Lawyer[]>([]);
  const [query, setQuery] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("");
  const [minimumRating, setMinimumRating] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/platform/lawyers", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { lawyers?: Lawyer[] };
        if (!response.ok) throw new Error(lawyerText(locale, "Не удалось загрузить каталог юристов.", "Yuristlar katalogini yuklab bo‘lmadi.", "We could not load the lawyer directory."));
        if (active) setLawyers(body.lawyers ?? []);
      })
      .catch((value) => active && setError(value instanceof Error ? value.message : String(value)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [locale]);

  const specialties = useMemo(() => [...new Set(lawyers.flatMap((lawyer) => lawyer.specialties))].sort((a, b) => a.localeCompare(b)), [lawyers]);
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return lawyers.filter((lawyer) => {
      const searchable = [lawyer.displayName, lawyer.firmName, lawyer.bio, ...lawyer.specialties, ...lawyer.languages]
        .filter(Boolean).join(" ").toLocaleLowerCase();
      return (!normalized || searchable.includes(normalized))
        && (!specialty || lawyer.specialties.includes(specialty))
        && (!availabilityFilter || lawyer.availabilityStatus === availabilityFilter)
        && (!minimumRating || (lawyer.rating.overallAverage ?? 0) >= Number(minimumRating));
    });
  }, [availabilityFilter, lawyers, minimumRating, query, specialty]);
  const approved = results.filter((lawyer) => lawyer.canReceiveRequests);
  const pendingReview = results.filter((lawyer) => !lawyer.canReceiveRequests);

  function card(lawyer: Lawyer) {
    const underReview = !lawyer.canReceiveRequests;
    return <article key={lawyer.id} className={`lawyer-directory-card${lawyer.juroApproved ? " is-juro-approved" : ""}${lawyer.topLawyer ? " is-top-lawyer" : ""}`}>
      <div className="lawyer-directory-card-head"><div className="lawyer-directory-identity">{lawyer.profilePhotoUrl ? <Image src={lawyer.profilePhotoUrl} alt={text(`Фото: ${lawyer.displayName}`, `Rasm: ${lawyer.displayName}`, `Photo: ${lawyer.displayName}`)} width={48} height={48} unoptimized /> : <span className="lawyer-avatar-fallback" aria-label={text("Фото не добавлено", "Rasm qo‘shilmagan", "No profile photo")}><UserRound aria-hidden="true" /></span>}<div><h2>{lawyer.displayName}</h2><p>{lawyer.firmName || text("Независимый специалист", "Mustaqil mutaxassis", "Independent legal professional")}</p></div></div></div>
      <div className="lawyer-trust-badges">
        {lawyer.juroApproved && <span className="lawyer-juro-approved"><ShieldCheck aria-hidden="true" />{text("Одобрен JURO", "JURO tomonidan ma’qullangan", "Approved by JURO")}</span>}
        {lawyer.topLawyer && <span className="lawyer-top"><Crown aria-hidden="true" />{text("Top Lawyer", "Top yurist", "Top Lawyer")}</span>}
        {lawyer.advocateStatus === "verified" && <span className="lawyer-verified"><ShieldCheck aria-hidden="true" />{text("Статус адвоката подтверждён", "Advokat maqomi tasdiqlangan", "Advocate status verified")}</span>}
      </div>
      {underReview && <p className="lawyer-pending-review" role="status">{text("Профиль на проверке JURO · запись пока недоступна", "Profil JURO tekshiruvida · hozircha so‘rov yuborib bo‘lmaydi", "Profile under JURO review · requests are not yet available")}</p>}
      <p className="lawyer-directory-specialties">{lawyer.specialties.join(" · ") || text("Специализация уточняется", "Mutaxassislik aniqlashtirilmoqda", "Practice areas to be confirmed")}</p>
      <dl><div><dt>{text("Языки", "Tillar", "Languages")}</dt><dd>{lawyer.languages.join(", ") || "—"}</dd></div>{lawyer.city && <div><dt>{text("Город", "Shahar", "Location")}</dt><dd>{[lawyer.city, lawyer.region].filter(Boolean).join(", ")}</dd></div>}<div><dt>{text("Доступность", "Mavjudlik", "Availability")}</dt><dd>{localized(availability[lawyer.availabilityStatus])}</dd></div>{lawyer.experienceYears !== null && <div><dt>{text("Опыт", "Tajriba", "Experience")}</dt><dd>{text(`${lawyer.experienceYears} лет`, `${lawyer.experienceYears} yil`, `${lawyer.experienceYears} years`)}</dd></div>}{lawyer.priceDescription && <div><dt>{text("Цена", "Narx", "Fees")}</dt><dd>{lawyer.priceDescription}</dd></div>}<div><dt>{text("Длительность", "Davomiyligi", "Duration")}</dt><dd>{lawyer.consultationDurationMinutes} {text("мин.", "daq.", "min")}</dd></div></dl>
      <p className="lawyer-rating"><Star aria-hidden="true" />{lawyer.rating.reviewCount && lawyer.rating.overallAverage !== null ? `${lawyer.rating.overallAverage.toFixed(1)}/5 · ${lawyer.rating.reviewCount}` : text("Нет одобренных отзывов", "Tasdiqlangan fikrlar yo‘q", "No approved reviews")}</p>
      {lawyer.topLawyer && lawyer.topLawyerCriteria && <p className="lawyer-top-criteria">{lawyer.topLawyerCriteria}</p>}
      <div className="lawyer-directory-actions"><Link href={`${base}/lawyers/${encodeURIComponent(lawyer.id)}`}>{text("Профиль", "Profil", "View profile")}</Link>{underReview ? <span aria-disabled="true">{text("Запись после проверки", "Tekshiruvdan keyin", "Available after review")}</span> : <Link className="primary" href={`${base}/consultations?lawyer=${encodeURIComponent(lawyer.id)}`}>{text("Выбрать для заявки", "So‘rov uchun tanlash", "Select for request")}</Link>}</div>
    </article>;
  }

  return <section className="lawyer-directory" aria-labelledby="lawyer-directory-heading">
    <header className="lawyer-directory-hero">
      <Scale aria-hidden="true" />
      <div><span>JURO · MARKETPLACE</span><h1 id="lawyer-directory-heading">{text("Юристы и адвокаты", "Yuristlar va advokatlar", "Lawyers and advocates")}</h1><p>{text("Одобренные профили доступны для заявки. Полные профили на проверке показаны отдельно и не принимают записи. Передача материалов дела всегда требует вашего подтверждения.", "Tasdiqlangan profillarga so‘rov yuborish mumkin. To‘liq tekshiruvdagi profillar alohida ko‘rsatiladi va so‘rov qabul qilmaydi. Ish materiallarini topshirish doimo sizning tasdig‘ingizni talab qiladi.", "Approved professionals can receive requests. Complete profiles still under review are shown separately and cannot accept bookings. Sharing case materials always requires your explicit approval.")}</p></div>
    </header>

    <form className="lawyer-directory-controls" onSubmit={(event) => event.preventDefault()} aria-label={text("Фильтры каталога", "Katalog filtrlari", "Directory filters")}>
      <label><span>{text("Поиск", "Qidiruv", "Search")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={160} placeholder={text("Имя, специализация, фирма", "Ism, mutaxassislik, firma", "Name, practice area, or firm")} /></label>
      <label><span>{text("Специализация", "Mutaxassislik", "Practice area")}</span><Select value={specialty} onChange={(event) => setSpecialty(event.target.value)}><option value="">{text("Все направления", "Barcha yo‘nalishlar", "All practice areas")}</option>{specialties.map((value) => <option key={value} value={value}>{value}</option>)}</Select></label>
      <label><span>{text("Доступность", "Mavjudlik", "Availability")}</span><Select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}><option value="">{text("Любая", "Istalgan", "Any")}</option><option value="available">{localized(availability.available)}</option><option value="limited">{localized(availability.limited)}</option></Select></label>
      <label><span>{text("Рейтинг", "Reyting", "Rating")}</span><Select value={minimumRating} onChange={(event) => setMinimumRating(event.target.value)}><option value="">{text("Любой", "Istalgan", "Any")}</option><option value="4">4.0+</option><option value="4.5">4.5+</option></Select></label>
    </form>

    {loading && <p className="lawyer-directory-state" aria-busy="true"><LoaderCircle className="spin" aria-hidden="true" />{text("Загружаем одобренные профили…", "Tasdiqlangan profillar yuklanmoqda…", "Loading approved profiles…")}</p>}
    {error && <p className="lawyer-directory-state error" role="alert"><CircleAlert aria-hidden="true" />{text("Каталог временно недоступен. Попробуйте обновить страницу.", "Katalog vaqtincha mavjud emas. Sahifani yangilang.", "The directory is temporarily unavailable. Please refresh the page.")}</p>}
    {!loading && !error && <p className="lawyer-directory-count" role="status">{text(`Найдено специалистов: ${results.length}`, `Topilgan mutaxassislar: ${results.length}`, `Professionals found: ${results.length}`)}</p>}
    {!loading && !error && results.length === 0 && <section className="lawyer-directory-empty"><UserRoundCheck aria-hidden="true" /><h2>{text("Пока нет подходящих профилей", "Hozircha mos profillar yo‘q", "No matching profiles yet")}</h2><p>{text("Измените фильтры или создайте заявку — JURO сможет подобрать специалиста после проверки конфликта интересов.", "Filtrlarni o‘zgartiring yoki so‘rov yarating — JURO manfaatlar to‘qnashuvini tekshirgandan keyin mutaxassis tanlay oladi.", "Adjust the filters or create a request. JURO can match you with a professional after a conflict-of-interest check.")}</p><Link href={`${base}/consultations`} className="lawyer-directory-link">{text("Создать заявку", "So‘rov yaratish", "Create request")}</Link></section>}
    <div className="lawyer-directory-grid">{approved.map(card)}</div>
    {pendingReview.length > 0 && <section className="lawyer-directory-pending" aria-labelledby="lawyer-directory-pending-heading"><h2 id="lawyer-directory-pending-heading">{text("Профили на проверке JURO", "JURO tekshiruvidagi profillar", "Profiles under JURO review")}</h2><p>{text("Эти специалисты завершили профиль, но ещё не одобрены для приёма заявок.", "Bu mutaxassislar profilini to‘ldirgan, biroq so‘rov qabul qilish uchun hali tasdiqlanmagan.", "These professionals have completed their profiles but are not yet approved to receive requests.")}</p><div className="lawyer-directory-grid">{pendingReview.map(card)}</div></section>}
  </section>;
}
