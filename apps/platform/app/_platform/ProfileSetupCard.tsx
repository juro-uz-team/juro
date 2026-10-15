import Link from "next/link";
import { ArrowRight, Building2, Check, Clock3, FileCheck2, ShieldCheck } from "lucide-react";
import type { PlatformLocale } from "../../lib/platform/routing";
import type { ProfileReadiness } from "../../lib/platform/profile-readiness";
import "./profile-setup.css";

const labels: Record<ProfileReadiness, Record<PlatformLocale, string>> = {
  business_optional: { ru: "Для бизнеса · по желанию", uz: "Biznes uchun · ixtiyoriy", en: "Business · optional" },
  lawyer_draft: { ru: "Профиль юриста · черновик", uz: "Yurist profili · qoralama", en: "Counsel profile · draft" },
  lawyer_review: { ru: "Профиль на проверке", uz: "Profil tekshirilmoqda", en: "Profile under review" },
  lawyer_changes: { ru: "Нужны изменения", uz: "O‘zgartirishlar kerak", en: "Changes requested" },
  lawyer_restricted: { ru: "Профессиональный доступ ограничен", uz: "Kasbiy kirish cheklangan", en: "Professional access restricted" },
};

export function profileReadinessLabel(state: ProfileReadiness, locale: PlatformLocale) {
  return labels[state][locale];
}

export function ProfileSetupCard({ state, locale, base }: { state: ProfileReadiness; locale: PlatformLocale; base: string }) {
  const text = (ru: string, uz: string, en: string) => ({ ru, uz, en })[locale];
  const business = state === "business_optional";
  const reviewing = state === "lawyer_review";
  const restricted = state === "lawyer_restricted";
  const changes = state === "lawyer_changes";
  const Icon = business ? Building2 : reviewing ? Clock3 : ShieldCheck;
  const title = business
    ? text("Работаете от имени организации?", "Tashkilot nomidan ishlaysizmi?", "Working for an organization?")
    : reviewing ? text("Заявка отправлена. Мы проверяем профиль.", "Ariza yuborildi. Profilni tekshiryapmiz.", "Application received. Your profile is under review.")
    : changes ? text("Обновите профиль по замечаниям JURO", "JURO izohlariga ko‘ra profilni yangilang", "Update your profile using JURO’s feedback")
    : restricted ? text("Проверьте решение по вашему профилю", "Profilingiz bo‘yicha qarorni tekshiring", "Review the decision on your profile")
    : text("Подготовьте профиль для работы с клиентами", "Mijozlar bilan ishlash uchun profilni tayyorlang", "Prepare your profile to work with clients");
  const body = business
    ? text("Создайте отдельное пространство для документов и команды. Личные инструменты уже доступны.", "Hujjatlar va jamoa uchun alohida makon yarating. Shaxsiy vositalar allaqachon tayyor.", "Create a separate workspace for documents and your team. Your personal tools are already available.")
    : reviewing ? text("Повторно отправлять заявку не нужно. Статус и замечания будут доступны в профессиональном профиле.", "Arizani qayta yuborish shart emas. Holat va izohlar professional profilda ko‘rinadi.", "No need to submit again. Your professional profile shows the current status and any feedback.")
    : changes || restricted ? text("Откройте профессиональный профиль, чтобы увидеть решение и доступные действия. Приём заявок и материалы клиентов пока недоступны.", "Qaror va mavjud amallarni ko‘rish uchun professional profilni oching. So‘rovlar va mijoz materiallari hozircha yopiq.", "Open your professional profile to see the decision and available actions. New requests and client materials remain unavailable.")
    : text("Расскажите о практике, добавьте профессиональные сведения и отправьте профиль на проверку. Можно сохранять черновик и возвращаться позже.", "Amaliyotingiz va kasbiy ma’lumotlarni kiriting, so‘ng profilni tekshiruvga yuboring. Qoralamani saqlab, keyin davom etishingiz mumkin.", "Add your practice and professional details, then submit your profile for review. Save a draft and return whenever you’re ready.");
  return <section className="profile-setup" aria-label={profileReadinessLabel(state, locale)} data-state={state}>
    <div className="profile-setup-heading"><span className="profile-setup-icon"><Icon aria-hidden="true" /></span><span className="profile-setup-label">{profileReadinessLabel(state, locale)}</span></div>
    <h2>{title}</h2><p>{body}</p>
    {!business && !restricted && <ol className="profile-setup-steps" aria-label={text("Как начать работу", "Ishni qanday boshlash", "Getting started")}>
      <li data-complete={reviewing}><span>{reviewing ? <Check aria-hidden="true" /> : "1"}</span>{text("Профиль и практика", "Profil va amaliyot", "Profile & practice")}</li>
      <li aria-current={reviewing ? "step" : undefined}><span>2</span>{text("Проверка JURO", "JURO tekshiruvi", "JURO review")}</li>
      <li><span>3</span>{text("Работа с клиентами", "Mijozlar bilan ishlash", "Client work")}</li>
    </ol>}
    <footer><Link href={business ? `${base}/settings#business-workspace` : `${base}/profile#professional-profile`}>
      {business ? text("Создать пространство", "Makon yaratish", "Create a workspace") : reviewing || restricted ? text("Посмотреть статус", "Holatni ko‘rish", "View status") : changes ? text("Посмотреть замечания", "Izohlarni ko‘rish", "View feedback") : text("Подготовить профиль", "Profilni tayyorlash", "Prepare profile")}<ArrowRight aria-hidden="true" />
    </Link><small><FileCheck2 aria-hidden="true" />{business ? text("Без проверки JURO. Вы станете владельцем.", "JURO tekshiruvisiz. Siz egasi bo‘lasiz.", "No JURO review. You become the owner.") : text("Заявки — после одобрения JURO. Материалы — с согласия клиента.", "So‘rovlar — JURO tasdig‘idan so‘ng. Materiallar — mijoz roziligi bilan.", "Accept requests after JURO approval. Access materials with client consent.")}</small></footer>
  </section>;
}
