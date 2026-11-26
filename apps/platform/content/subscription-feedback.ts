import type { PlatformLocale } from "../lib/platform/routing";

const messages = {
  ACTIVE_CASE_LIMIT: {
    ru: "Достигнут лимит активных дел. Завершите или архивируйте одно из них, чтобы открыть ещё одно.",
    uz: "Faol ishlar limiti tugadi. Yangi ish ochish uchun bittasini yakunlang yoki arxivlang.",
    en: "You’ve reached the active case limit. Close or archive a case to open another.",
  },
  SUBSCRIPTION_FILE_LIMIT: {
    ru: "Файл превышает допустимый размер по тарифу. Выберите файл меньшего размера.",
    uz: "Fayl hajmi tarif bo‘yicha limitdan oshdi. Kichikroq faylni tanlang.",
    en: "This file exceeds your plan’s file size limit. Choose a smaller file.",
  },
  SUBSCRIPTION_STORAGE_LIMIT: {
    ru: "Хранилище заполнено. Освободите место и повторите попытку.",
    uz: "Xotira to‘lgan. Joy bo‘shatib, qayta urinib ko‘ring.",
    en: "Storage is full. Free up some space and try again.",
  },
  WORKSPACE_TERM_EXPIRED: {
    ru: "Срок тарифа истёк. В этом пространстве доступны чтение и экспорт.",
    uz: "Tarif muddati tugadi. Bu makonda o‘qish va eksport qilish mumkin.",
    en: "The plan has expired. You can read and export existing work in this workspace.",
  },
  TEMPLATE_PLAN_UNAVAILABLE: {
    ru: "Этот шаблон недоступен на вашем тарифе.",
    uz: "Bu andoza joriy tarifingizda mavjud emas.",
    en: "This template is unavailable on your plan.",
  },
} satisfies Record<string, Record<PlatformLocale, string>>;

export function subscriptionFeedback(locale: PlatformLocale, code?: string): string | undefined {
  return code && Object.hasOwn(messages, code) ? messages[code as keyof typeof messages][locale] : undefined;
}
