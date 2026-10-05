import Link from "next/link";
import type { PlatformLocale } from "../../lib/platform/routing";

const copy = {
  ru: {
    title: "Требуется защищённый вход",
    description: "Консоль доступна только сотруднику с действующей ролью и MFA/TOTP, подтверждённой за последние 15 минут. Если доступ назначен, войдите заново и вернитесь сюда.",
    action: "Обновить защищённый вход",
    privacy: "Страница не сообщает, какая именно проверка не пройдена, и не раскрывает наличие staff-ролей.",
  },
  uz: {
    title: "Himoyalangan kirish talab qilinadi",
    description: "Konsol faqat amaldagi rolga va oxirgi 15 daqiqada tasdiqlangan MFA/TOTP ga ega xodim uchun ochiladi. Ruxsat berilgan bo‘lsa, qayta kiring va shu sahifaga qayting.",
    action: "Himoyalangan kirishni yangilash",
    privacy: "Sahifa aynan qaysi tekshiruv o‘tmaganini yoki staff rollari mavjudligini oshkor qilmaydi.",
  },
  en: {
    title: "Secure sign-in required",
    description: "This console is available only to staff with an active role and MFA/TOTP verified within the last 15 minutes. If you have access, sign in again and return here.",
    action: "Refresh secure sign-in",
    privacy: "This page does not reveal which check failed or whether any staff role exists.",
  },
} as const;

export function AdminConsoleAccess({
  locale,
  environment,
}: {
  locale: PlatformLocale;
  environment: "production" | "staging";
}) {
  const t = copy[locale];
  const label = environment === "production" ? "JURO · ADMIN" : "JURO · STAGING ADMIN";
  const returnTo = `/${locale}/admin/console`;
  return <main style={{ maxWidth: "44rem", margin: "4rem auto", padding: "1.5rem", fontFamily: "var(--font-primary)" }}>
    <p style={{ color: "var(--brand-gold-text)", fontWeight: 700, letterSpacing: ".08em" }}>{label}</p>
    <h1 style={{ color: "var(--text-primary)" }}>{t.title}</h1>
    <p style={{ lineHeight: 1.6, color: "var(--text-secondary)" }}>{t.description}</p>
    <Link
      href={`/${locale}/auth/login?reauth=1&returnTo=${encodeURIComponent(returnTo)}`}
      style={{ display: "inline-flex", minHeight: 44, alignItems: "center", borderRadius: 8, padding: "0 1rem", background: "var(--interactive-primary)", color: "var(--text-on-action)", fontWeight: 600, textDecoration: "none" }}
    >
      {t.action}
    </Link>
    <p style={{ marginTop: "1rem", color: "var(--text-secondary)", fontSize: ".875rem", lineHeight: 1.5 }}>
      {t.privacy}
    </p>
  </main>;
}
