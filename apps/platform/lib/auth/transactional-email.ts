import { captureEmailRequest } from "../runtime/email";
export type AuthEmailLocale = "ru" | "uz" | "en";
export type AuthEmailPurpose =
  | "registration"
  | "password_reset"
  | "email_change_current"
  | "email_change"
  | "email_changed"
  | "password_changed"
  | "new_device"
  | "new_region"
  | "account_deletion"
  | "critical_action"
  | "login_code";

export type AuthEmailDetail = {
  label: string;
  value: string;
};

/**
 * Safe delivery metadata for operational logs. It intentionally contains no
 * recipient, message content, API key, or provider response body.
 */
export type AuthEmailDeliveryResult =
  | { ok: true; attempts: number }
  | {
    ok: false;
    attempts: number;
    failure: "network_or_timeout" | "provider_rejected";
    providerStatus: number | null;
  };

type Copy = {
  subject: string;
  title: string;
  intro: string;
  expiry: string;
  security: string;
  ignored: string;
  support: string;
  footer: string;
  codeLabel: string;
};

const copy: Record<AuthEmailLocale, Record<AuthEmailPurpose, Omit<Copy, "footer" | "support" | "codeLabel">> & Pick<Copy, "footer" | "support" | "codeLabel">> = {
  ru: {
    registration: { subject: "Подтвердите email — JURO", title: "Код подтверждения JURO", intro: "Используйте код ниже, чтобы подтвердить электронную почту и завершить создание аккаунта.", expiry: "Код действует 10 минут.", security: "Никому не сообщайте этот код. Сотрудники JURO никогда не запрашивают его в переписке или по телефону.", ignored: "Если вы не создавали аккаунт JURO, просто проигнорируйте это письмо." },
    password_reset: { subject: "Восстановление пароля — JURO", title: "Восстановление пароля", intro: "Используйте код ниже, чтобы установить новый пароль JURO.", expiry: "Код действует 10 минут и может быть использован только один раз.", security: "Никому не сообщайте этот код. Сотрудники JURO никогда не запрашивают его.", ignored: "Если вы не запрашивали восстановление пароля, проигнорируйте письмо и не передавайте код." },
    email_change_current: { subject: "Подтвердите смену email — JURO", title: "Подтвердите смену email", intro: "Это код для текущего адреса. Введите его вместе с кодом, отправленным на новый email.", expiry: "Коды действуют 10 минут и используются только один раз.", security: "Никому не сообщайте эти коды. Если вы не запрашивали смену email, завершите неизвестные сессии.", ignored: "Если это были не вы, обратитесь в поддержку JURO." },
    email_change: { subject: "Подтверждение нового email — JURO", title: "Подтвердите новый email", intro: "Используйте код ниже, чтобы подтвердить изменение адреса электронной почты.", expiry: "Код действует 10 минут.", security: "Не передавайте код третьим лицам.", ignored: "Если вы не меняли email, проигнорируйте письмо и обратитесь в поддержку." },
    email_changed: { subject: "Email для входа в JURO изменён", title: "Email для входа изменён", intro: "Адрес для входа в ваш аккаунт JURO был успешно изменён.", expiry: "", security: "Если это сделали не вы, немедленно восстановите доступ, завершите неизвестные сессии и обратитесь в поддержку.", ignored: "" },
    password_changed: { subject: "Пароль JURO изменён", title: "Пароль успешно изменён", intro: "Пароль вашего аккаунта JURO был изменён. Все прежние активные сессии завершены.", expiry: "", security: "Если это сделали не вы, немедленно восстановите доступ и свяжитесь с поддержкой.", ignored: "" },
    new_device: { subject: "Вход в JURO с нового устройства", title: "Вход с нового устройства", intro: "Мы заметили вход в ваш аккаунт JURO с нового устройства.", expiry: "", security: "Если это были не вы, завершите неизвестные сессии и измените пароль.", ignored: "" },
    new_region: { subject: "Вход в JURO из нового региона", title: "Вход из нового региона", intro: "Знакомое устройство вошло в ваш аккаунт JURO из региона, отличающегося от предыдущего входа.", expiry: "", security: "Если это были не вы, завершите неизвестные сессии и измените пароль.", ignored: "" },
    account_deletion: { subject: "Подтвердите удаление аккаунта — JURO", title: "Подтверждение удаления аккаунта", intro: "Используйте код ниже, чтобы подтвердить запрос на удаление аккаунта JURO.", expiry: "Код действует 10 минут и может быть использован только один раз.", security: "Никому не сообщайте этот код. Сотрудники JURO никогда не запрашивают его в переписке или по телефону.", ignored: "Если вы не запрашивали удаление аккаунта, не используйте код, завершите неизвестные сессии и обратитесь в поддержку." },
    critical_action: { subject: "Подтвердите действие — JURO", title: "Подтверждение действия", intro: "Используйте код ниже для подтверждения важного действия в JURO.", expiry: "Код действует 10 минут и используется один раз.", security: "Никому не сообщайте этот код.", ignored: "Если вы не выполняли это действие, проигнорируйте письмо и обратитесь в поддержку." },
    login_code: { subject: "Код входа — JURO", title: "Код входа JURO", intro: "Используйте код ниже только для дополнительной проверки входа.", expiry: "Код действует 10 минут.", security: "Никому не сообщайте этот код.", ignored: "Если вы не пытались войти, проигнорируйте письмо." },
    codeLabel: "Код подтверждения",
    support: "Нужна помощь? Напишите в поддержку: admin@juro.uz",
    footer: "JURO — цифровая юридическая платформа. Ташкент, Республика Узбекистан.",
  },
  uz: {
    registration: { subject: "Emailni tasdiqlang — JURO", title: "JURO tasdiqlash kodi", intro: "Email manzilingizni tasdiqlash va hisob yaratishni yakunlash uchun quyidagi koddan foydalaning.", expiry: "Kod 10 daqiqa amal qiladi.", security: "Kodni hech kimga bermang. JURO xodimlari uni yozishmada yoki telefon orqali so‘ramaydi.", ignored: "Agar JURO hisobini siz yaratmagan bo‘lsangiz, ushbu xatni e’tiborsiz qoldiring." },
    password_reset: { subject: "Parolni tiklash — JURO", title: "Parolni tiklash", intro: "Yangi JURO parolini o‘rnatish uchun quyidagi koddan foydalaning.", expiry: "Kod 10 daqiqa amal qiladi va faqat bir marta ishlatiladi.", security: "Kodni hech kimga bermang. JURO xodimlari uni so‘ramaydi.", ignored: "Agar parolni tiklashni so‘ramagan bo‘lsangiz, xatni e’tiborsiz qoldiring." },
    email_change_current: { subject: "Emailni almashtirishni tasdiqlang — JURO", title: "Emailni almashtirishni tasdiqlang", intro: "Bu joriy manzil uchun kod. Uni yangi emailga yuborilgan kod bilan birga kiriting.", expiry: "Kodlar 10 daqiqa amal qiladi va faqat bir marta ishlatiladi.", security: "Kodlarni hech kimga bermang. Emailni almashtirishni so‘ramagan bo‘lsangiz, noma’lum seanslarni yakunlang.", ignored: "Agar bu siz bo‘lmasangiz, JURO yordam xizmatiga murojaat qiling." },
    email_change: { subject: "Yangi emailni tasdiqlang — JURO", title: "Yangi emailni tasdiqlang", intro: "Email manzilini o‘zgartirishni tasdiqlash uchun quyidagi koddan foydalaning.", expiry: "Kod 10 daqiqa amal qiladi.", security: "Kodni boshqa shaxslarga bermang.", ignored: "Agar emailni o‘zgartirmagan bo‘lsangiz, xatni e’tiborsiz qoldiring va yordam xizmatiga murojaat qiling." },
    email_changed: { subject: "JURO emailingiz o‘zgartirildi", title: "Kirish emailingiz o‘zgartirildi", intro: "JURO hisobingizga kirish uchun email manzili muvaffaqiyatli o‘zgartirildi.", expiry: "", security: "Agar buni siz qilmagan bo‘lsangiz, darhol kirishni tiklang, noma’lum seanslarni yakunlang va yordam xizmatiga murojaat qiling.", ignored: "" },
    password_changed: { subject: "JURO paroli o‘zgartirildi", title: "Parol muvaffaqiyatli o‘zgartirildi", intro: "JURO hisobingiz paroli o‘zgartirildi. Avvalgi faol seanslar yakunlandi.", expiry: "", security: "Agar buni siz qilmagan bo‘lsangiz, darhol kirishni tiklang va yordam xizmatiga yozing.", ignored: "" },
    new_device: { subject: "JURO hisobiga yangi qurilmadan kirish", title: "Yangi qurilmadan kirish", intro: "JURO hisobingizga yangi qurilmadan kirish aniqlandi.", expiry: "", security: "Agar bu siz bo‘lmasangiz, noma’lum seanslarni yakunlang va parolni o‘zgartiring.", ignored: "" },
    new_region: { subject: "JURO hisobiga yangi hududdan kirish", title: "Yangi hududdan kirish", intro: "Tanish qurilma avvalgi kirishdan boshqa hududdan JURO hisobingizga kirdi.", expiry: "", security: "Agar bu siz bo‘lmasangiz, noma’lum seanslarni yakunlang va parolni o‘zgartiring.", ignored: "" },
    account_deletion: { subject: "Hisobni o‘chirishni tasdiqlang — JURO", title: "Hisobni o‘chirishni tasdiqlash", intro: "JURO hisobini o‘chirish so‘rovini tasdiqlash uchun quyidagi koddan foydalaning.", expiry: "Kod 10 daqiqa amal qiladi va faqat bir marta ishlatiladi.", security: "Kodni hech kimga bermang. JURO xodimlari uni yozishmada yoki telefon orqali hech qachon so‘ramaydi.", ignored: "Agar hisobni o‘chirishni so‘ramagan bo‘lsangiz, koddan foydalanmang, noma’lum seanslarni yakunlang va yordam xizmatiga murojaat qiling." },
    critical_action: { subject: "Amalni tasdiqlang — JURO", title: "Amalni tasdiqlash", intro: "JUROdagi muhim amalni tasdiqlash uchun quyidagi koddan foydalaning.", expiry: "Kod 10 daqiqa amal qiladi va bir marta ishlatiladi.", security: "Kodni hech kimga bermang.", ignored: "Agar bu amalni bajarmagan bo‘lsangiz, xatni e’tiborsiz qoldiring va yordam xizmatiga murojaat qiling." },
    login_code: { subject: "Kirish kodi — JURO", title: "JURO kirish kodi", intro: "Kirishni qo‘shimcha tekshirish uchun quyidagi koddan foydalaning.", expiry: "Kod 10 daqiqa amal qiladi.", security: "Kodni hech kimga bermang.", ignored: "Agar kirishga urinmagan bo‘lsangiz, xatni e’tiborsiz qoldiring." },
    codeLabel: "Tasdiqlash kodi",
    support: "Yordam kerakmi? admin@juro.uz manziliga yozing",
    footer: "JURO — raqamli yuridik platforma. Toshkent, O‘zbekiston Respublikasi.",
  },
  en: {
    registration: { subject: "Confirm your email — JURO", title: "Your JURO verification code", intro: "Use the code below to confirm your email and finish creating your account.", expiry: "The code expires in 10 minutes.", security: "Never share this code. JURO staff will never ask for it by message or phone.", ignored: "If you did not create a JURO account, you can ignore this email." },
    password_reset: { subject: "Reset your password — JURO", title: "Reset your password", intro: "Use the code below to set a new JURO password.", expiry: "The code expires in 10 minutes and can be used only once.", security: "Never share this code. JURO staff will never ask for it.", ignored: "If you did not request a password reset, ignore this email and do not share the code." },
    email_change_current: { subject: "Confirm your email change — JURO", title: "Confirm your email change", intro: "This code is for your current address. Enter it together with the code sent to your new email.", expiry: "The codes expire in 10 minutes and can be used only once.", security: "Never share these codes. If you did not request the change, end unknown sessions.", ignored: "If this was not you, contact JURO support." },
    email_change: { subject: "Confirm your new email — JURO", title: "Confirm your new email", intro: "Use the code below to confirm the change to your email address.", expiry: "The code expires in 10 minutes.", security: "Do not share this code with anyone.", ignored: "If you did not change your email, ignore this email and contact support." },
    email_changed: { subject: "Your JURO sign-in email was changed", title: "Sign-in email changed", intro: "The email address used to sign in to your JURO account was changed successfully.", expiry: "", security: "If this was not you, recover access immediately, end unknown sessions, and contact support.", ignored: "" },
    password_changed: { subject: "Your JURO password was changed", title: "Password changed", intro: "The password for your JURO account was changed. Previous active sessions have been signed out.", expiry: "", security: "If this was not you, recover access immediately and contact support.", ignored: "" },
    new_device: { subject: "Sign-in to JURO from a new device", title: "Sign-in from a new device", intro: "We noticed a sign-in to your JURO account from a new device.", expiry: "", security: "If this was not you, end unknown sessions and change your password.", ignored: "" },
    new_region: { subject: "Sign-in to JURO from a new region", title: "Sign-in from a new region", intro: "A recognized device signed in to your JURO account from a region different from its previous sign-in.", expiry: "", security: "If this was not you, end unknown sessions and change your password.", ignored: "" },
    account_deletion: { subject: "Confirm account deletion — JURO", title: "Confirm account deletion", intro: "Use the code below to confirm your request to delete your JURO account.", expiry: "The code expires in 10 minutes and can be used only once.", security: "Never share this code. JURO staff will never ask for it by message or phone.", ignored: "If you did not request account deletion, do not use the code, end unknown sessions, and contact support." },
    critical_action: { subject: "Confirm an action — JURO", title: "Confirm this action", intro: "Use the code below to confirm a sensitive action in JURO.", expiry: "The code expires in 10 minutes and can be used once.", security: "Never share this code.", ignored: "If you did not request this action, ignore this email and contact support." },
    login_code: { subject: "Sign-in code — JURO", title: "Your JURO sign-in code", intro: "Use the code below only for an additional sign-in check.", expiry: "The code expires in 10 minutes.", security: "Never share this code.", ignored: "If you did not try to sign in, ignore this email." },
    codeLabel: "Verification code",
    support: "Need help? Contact support at admin@juro.uz",
    footer: "JURO — a digital legal platform. Tashkent, Republic of Uzbekistan.",
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function singleLineText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/[\r\n]+/gu, " ")
    .trim();
}

export function renderJuroAuthEmail(input: {
  locale: AuthEmailLocale;
  purpose: AuthEmailPurpose;
  code?: string;
  details?: readonly AuthEmailDetail[];
}): { subject: string; html: string; text: string } {
  const language = copy[input.locale];
  const message = language[input.purpose];
  const plainCode = input.code ? singleLineText(input.code) : null;
  const code = plainCode ? escapeHtml(plainCode) : null;
  const details = (input.details ?? []).map(detail => ({
    label: singleLineText(detail.label),
    value: singleLineText(detail.value),
  })).filter(detail => detail.label && detail.value);
  const content = [message.intro, message.expiry, message.security, message.ignored]
    .filter(Boolean);
  const text = [
    `JURO — ${message.title}`,
    "",
    ...content,
    ...(plainCode ? ["", `${language.codeLabel}: ${plainCode}`] : []),
    ...(details.length
      ? ["", ...details.map(detail => `${detail.label}: ${detail.value}`)]
      : []),
    "",
    language.support,
    language.footer,
  ].join("\n");
  const detailsHtml = details.length
    ? `<tr><td style="padding:4px 32px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f7f9fa;border:1px solid #dce3e7;border-radius:12px">${details.map(detail => `<tr><td style="padding:10px 12px;font-size:13px;line-height:1.5;color:#607182">${escapeHtml(detail.label)}</td><td align="right" style="padding:10px 12px;font-size:13px;line-height:1.5;font-weight:600;color:#102333">${escapeHtml(detail.value)}</td></tr>`).join("")}</table></td></tr>`
    : "";
  const html = `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(message.subject)}</title></head><body style="margin:0;padding:0;background:#f8f6f2;color:#102333;font-family:Arial,'Helvetica Neue',sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(message.intro)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f8f6f2"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e3ddd2;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 32px;background:#062844"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="font-size:24px;line-height:1;font-weight:800;letter-spacing:3px;color:#ffffff">JURO</td><td align="right" style="font-size:12px;line-height:1.4;color:#d8c291">LEGALTECH</td></tr></table></td></tr><tr><td style="padding:36px 32px 12px"><h1 style="margin:0;font-size:26px;line-height:1.25;color:#062844">${escapeHtml(message.title)}</h1><p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#405568">${escapeHtml(message.intro)}</p></td></tr>${code ? `<tr><td style="padding:20px 32px"><div style="padding:22px 16px;text-align:center;background:#f3eee4;border:1px solid #dfd2ba;border-radius:14px"><div style="font-size:12px;line-height:1.4;text-transform:uppercase;letter-spacing:1.4px;color:#7a6747">${escapeHtml(language.codeLabel)}</div><div style="margin-top:8px;font-family:'Courier New',monospace;font-size:34px;line-height:1.2;font-weight:700;letter-spacing:8px;color:#062844">${code}</div></div></td></tr>` : ""}${detailsHtml}<tr><td style="padding:12px 32px 32px">${message.expiry ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#405568">${escapeHtml(message.expiry)}</p>` : ""}<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#8a3d34">${escapeHtml(message.security)}</p>${message.ignored ? `<p style="margin:0;font-size:14px;line-height:1.6;color:#607182">${escapeHtml(message.ignored)}</p>` : ""}</td></tr><tr><td style="padding:24px 32px;background:#edf1f3;border-top:1px solid #dce3e7"><p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#405568"><a href="mailto:admin@juro.uz" style="color:#062844;text-decoration:underline">${escapeHtml(language.support)}</a></p><p style="margin:0;font-size:12px;line-height:1.5;color:#6a7a87">${escapeHtml(language.footer)}</p></td></tr></table></td></tr></table></body></html>`;
  return { subject: message.subject, html, text };
}

export async function sendJuroAuthEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  idempotencyKey: string;
  message: { subject: string; html: string; text: string };
}): Promise<AuthEmailDeliveryResult> {
  // A single retry covers short-lived provider/edge failures. Reusing the
  // idempotency key ensures that a delayed successful first request cannot
  // result in two verification emails.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await captureEmailRequest({
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({
          from: input.from,
          to: [input.to],
          subject: input.message.subject,
          html: input.message.html,
          text: input.message.text,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) {
        await response.body?.cancel();
        return { ok: true, attempts: attempt };
      }
      const retryable = response.status === 429 || response.status >= 500;
      const providerStatus = response.status;
      await response.body?.cancel();
      if (!retryable || attempt === 2) {
        return {
          ok: false,
          attempts: attempt,
          failure: "provider_rejected",
          providerStatus,
        };
      }
    } catch {
      if (attempt === 2) {
        return {
          ok: false,
          attempts: attempt,
          failure: "network_or_timeout",
          providerStatus: null,
        };
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 250 * attempt));
  }
  return {
    ok: false,
    attempts: 2,
    failure: "network_or_timeout",
    providerStatus: null,
  };
}
