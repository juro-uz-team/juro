"use client";

import Link from "next/link";
import Image from "next/image";
import { CalendarClock, Crown, ShieldCheck, Star, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { lawyerIntlLocale, lawyerText } from "../../lib/platform/lawyer-localization";
import type { PlatformLocale } from "../../lib/platform/routing";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { WorkspacePagination, useWorkspacePagination } from "./WorkspacePagination";
import { usePlatformBasePath } from "./PlatformRouteContext";
import { lawyerAvailability as availability, lawyerDuration, lawyerExperience, lawyerRequestLabel, type LawyerDirectoryProfile } from "./lawyer-directory-entry";

export function LawyerProfileClient({ locale, lawyerId }: { locale: PlatformLocale; lawyerId: string }) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);
  const [lawyer, setLawyer] = useState<LawyerDirectoryProfile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(`/api/platform/lawyers/${encodeURIComponent(lawyerId)}`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<{ lawyer: LawyerDirectoryProfile }>; })
      .then((value) => setLawyer(value.lawyer)).catch(() => setFailed(true));
  }, [lawyerId]);
  if (failed) return <section className="platform-module"><h1>{text("Юрист недоступен", "Yurist mavjud emas", "Lawyer unavailable")}</h1></section>;
  if (!lawyer) return <section className="platform-module" aria-busy="true"><p>{text("Загрузка…", "Yuklanmoqda…", "Loading…")}</p></section>;
  return <LawyerProfileView locale={locale} lawyerId={lawyerId} lawyer={lawyer} />;
}

export function LawyerProfileView({ locale, lawyerId, lawyer }: { locale: PlatformLocale; lawyerId: string; lawyer: LawyerDirectoryProfile }) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);
  const localized = <T,>(values: [T, T, T]) => lawyerText(locale, values[0], values[1], values[2]);
  const base = usePlatformBasePath();
  const reviews = useWorkspacePagination(lawyer.reviews.length, 4, lawyerId);
  const pending = !lawyer.readOnly && !lawyer.canReceiveRequests;
  const date = (value: string) => new Intl.DateTimeFormat(lawyerIntlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(value));
  return <section className={`platform-module lawyer-public-profile workspace-page${lawyer.juroApproved ? " is-juro-approved" : ""}${lawyer.topLawyer ? " is-top-lawyer" : ""}`}>
    <WorkspaceTitle icon={<UserRound />} title={lawyer.displayName}
      description={lawyer.firmName || text("Независимый специалист", "Mustaqil mutaxassis", "Independent legal professional")} />
    <div className="lawyer-public-profile-hero">
      <div className="lawyer-public-photo">{lawyer.profilePhotoUrl ? <Image src={lawyer.profilePhotoUrl} alt={text(`Фото: ${lawyer.displayName}`, `Rasm: ${lawyer.displayName}`, `Photo: ${lawyer.displayName}`)} width={144} height={144} unoptimized /> : <UserRound aria-hidden="true" />}</div>
      <div className="lawyer-public-identity">
        <div className="lawyer-trust-badges">{lawyer.juroApproved && <span className="lawyer-juro-approved"><ShieldCheck aria-hidden="true" />{text("Одобрен JURO", "JURO tomonidan ma’qullangan", "Approved by JURO")}</span>}{lawyer.topLawyer && <span className="lawyer-top"><Crown aria-hidden="true" />{text("Top Lawyer", "Top yurist", "Top Lawyer")}</span>}{lawyer.advocateStatus === "verified" && <span className="lawyer-verified"><ShieldCheck aria-hidden="true" />{text("Статус адвоката подтверждён", "Advokat maqomi tasdiqlangan", "Advocate status verified")}</span>}</div>
        {lawyer.role && <p>{lawyer.role}</p>}
        {pending && <p className="lawyer-pending-review" role="status">{text("Профиль на проверке JURO · запись пока недоступна", "Profil JURO tekshiruvida · hozircha so‘rov yuborib bo‘lmaydi", "Profile under JURO review · requests are not yet available")}</p>}
      </div>
      <aside className="lawyer-public-booking">
        <strong>{lawyer.priceDescription || (lawyer.readOnly
          ? text("Стоимость не указана", "Narx ko‘rsatilmagan", "Fees not listed")
          : text("Стоимость уточняется", "Narx aniqlashtirilmoqda", "Pricing on request"))}</strong>
        {!lawyer.readOnly && <span>{localized(availability[lawyer.availabilityStatus] ?? availability.unknown)}</span>}
        {lawyer.readOnly ? <button type="button" className="lawyer-directory-request" disabled><CalendarClock aria-hidden="true" />{lawyerRequestLabel[locale]}</button>
          : pending ? <span aria-disabled="true">{text("Запись после проверки", "Tekshiruvdan keyin", "Available after review")}</span>
          : <Link className="primary" href={`${base}/consultations?lawyer=${encodeURIComponent(lawyerId)}`}><CalendarClock aria-hidden="true" />{lawyerRequestLabel[locale]}</Link>}
      </aside>
    </div>
    <div className="lawyer-public-profile-grid">
      <section><h2>{text("О специалисте", "Mutaxassis haqida", "About the professional")}</h2>{lawyer.bio ? <p>{lawyer.bio}</p> : <p>{text("Описание пока не добавлено.", "Tavsif hali qo‘shilmagan.", "No description has been added yet.")}</p>}{lawyer.additionalServices.length > 0 && <><h3>{text("Дополнительные услуги", "Qo‘shimcha xizmatlar", "Additional services")}</h3><p>{lawyer.additionalServices.join(" · ")}</p></>}{lawyer.topLawyer && <p className="lawyer-top-criteria"><strong>{text("Критерии Top Lawyer: ", "Top yurist mezonlari: ", "Top Lawyer criteria: ")}</strong>{lawyer.topLawyerCriteria || text("статус присваивается отдельным решением JURO по опубликованным проверенным критериям.", "maqom JUROning alohida qarori bilan e’lon qilingan tekshirilgan mezonlar asosida beriladi.", "the status is awarded by a separate JURO decision under published, verified criteria.")}</p>}</section>
      <section>
        <h2>{text("Профиль", "Profil", "Profile")}</h2>
        <dl>
          <div><dt>{text("Специализации", "Mutaxassisliklar", "Practice areas")}</dt><dd>{lawyer.specialties.join(", ") || "—"}</dd></div>
          <div><dt>{text("Языки", "Tillar", "Languages")}</dt><dd>{lawyer.languages.join(" · ") || "—"}</dd></div>
          {(lawyer.readOnly || lawyer.experienceYears !== null) && <div><dt>{text("Опыт", "Tajriba", "Experience")}</dt><dd>{lawyerExperience(locale, lawyer)}</dd></div>}
          {lawyer.city && <div><dt>{text("Город", "Shahar", "Location")}</dt><dd>{[lawyer.city, lawyer.region].filter(Boolean).join(", ")}</dd></div>}
          {lawyer.education && <div><dt>{text("Образование", "Ta’lim", "Education")}</dt><dd>{lawyer.education}</dd></div>}
          {lawyer.consultationFormats.length > 0 && <div><dt>{text("Формат", "Format", "Consultation formats")}</dt><dd>{lawyer.consultationFormats.join(", ")}</dd></div>}
          <div><dt>{text("Длительность", "Davomiyligi", "Duration")}</dt><dd>{lawyerDuration(locale, lawyer.consultationDurationMinutes)}</dd></div>
          {lawyer.nextAvailableAt && <div><dt>{text("Ближайший слот", "Eng yaqin vaqt", "Next available slot")}</dt><dd><time dateTime={lawyer.nextAvailableAt}>{date(lawyer.nextAvailableAt)}</time></dd></div>}
        </dl>
      </section>
    </div>
    <section className="lawyer-public-reviews"><h2><Star aria-hidden="true" />{text("Отзывы", "Fikrlar", "Reviews")}</h2><p>{lawyer.rating.reviewCount ? `${lawyer.rating.overallAverage?.toFixed(1)}/5 · ${lawyer.rating.reviewCount}` : text("Пока нет одобренных отзывов", "Hozircha tasdiqlangan fikrlar yo‘q", "No approved reviews yet")}</p>{lawyer.reviews.slice(reviews.from, reviews.to).map((review) => <article key={review.id}><strong>{review.overallRating}/5</strong>{review.body && <p>{review.body}</p>}<time dateTime={review.createdAt}>{date(review.createdAt)}</time>{review.reply && <aside className="lawyer-review-reply" aria-label={text("Ответ юриста", "Yurist javobi", "Lawyer reply")}><strong>{text("Ответ юриста", "Yurist javobi", "Lawyer reply")}</strong><p>{review.reply.body}</p>{review.reply.createdAt && <time dateTime={review.reply.createdAt}>{date(review.reply.createdAt)}</time>}</aside>}</article>)}<WorkspacePagination locale={locale} {...reviews} /></section>
  </section>;
}
