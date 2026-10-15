import type { Locale } from "./domain";
const errors: Record<string, [string, string, string]> = {
  CLIENT_LINK_REQUIRED: [
    "Сначала пригласите владельца дела в клиентский кабинет фирмы и подтвердите его аккаунт.",
    "Avval ish egasini firma mijoz kabinetiga taklif qiling va hisobini tasdiqlang.",
    "First invite the case owner to the firm's client portal and confirm their account.",
  ],
  SEAT_LIMIT: [
    "Достигнут установленный лимит сотрудников пространства.",
    "Makon xodimlari limiti to‘lgan.",
    "The configured workspace seat limit has been reached.",
  ],
  UNAUTHORIZED: [
    "Войдите в JURO.",
    "JURO hisobiga kiring.",
    "Sign in to JURO.",
  ],
  MODULE_DISABLED: [
    "JURO Practice пока не включён в этом окружении.",
    "Bu muhitda JURO Practice hali yoqilmagan.",
    "JURO Practice is not enabled in this environment.",
  ],
  PILOT_INVITATION_REQUIRED: [
    "Для доступа нужно приглашение в пилот.",
    "Kirish uchun pilotga taklif kerak.",
    "A pilot invitation is required.",
  ],
  ACCESS_DENIED: [
    "У вас нет доступа к этому действию.",
    "Bu amal uchun ruxsatingiz yo‘q.",
    "You do not have access to this action.",
  ],
  NOT_FOUND: [
    "Материал недоступен.",
    "Material mavjud emas.",
    "This item is unavailable.",
  ],
  READ_ONLY: [
    "Доступен режим чтения. Обратитесь к владельцу для продления доступа.",
    "Faqat o‘qish rejimi. Ruxsatni uzaytirish uchun egasiga murojaat qiling.",
    "Read-only access. Contact the owner to renew access.",
  ],
  INVALID_INPUT: [
    "Проверьте заполненные поля.",
    "To‘ldirilgan maydonlarni tekshiring.",
    "Check the completed fields.",
  ],
  RECORD_EXISTS: [
    "Такая запись уже существует. Проверьте номер или повторный запрос.",
    "Bunday yozuv mavjud. Raqam yoki takroriy so‘rovni tekshiring.",
    "This record already exists. Check the number or repeated request.",
  ],
  REVISION_CONFLICT: [
    "Запись уже изменилась. Обновите её перед сохранением.",
    "Yozuv o‘zgardi. Saqlashdan oldin yangilang.",
    "The record changed. Refresh it before saving.",
  ],
  IDEMPOTENCY_CONFLICT: [
    "Этот запрос уже использован для другого действия.",
    "Bu so‘rov boshqa amal uchun ishlatilgan.",
    "This request was already used for another action.",
  ],
  INVALID_MONEY: [
    "Проверьте сумму, валюту и число знаков после точки.",
    "Summa, valyuta va kasr xonalarini tekshiring.",
    "Check the amount, currency and decimal places.",
  ],
  VERSION_LOCKED: [
    "Эта версия зафиксирована. Начните новый черновик.",
    "Bu versiya saqlangan. Yangi qoralama boshlang.",
    "This version is locked. Start a new draft.",
  ],
  CLIENT_APPROVAL_REQUIRED: [
    "Сначала клиент должен согласовать текущую версию.",
    "Avval mijoz joriy versiyani kelishishi kerak.",
    "The client must approve the current version first.",
  ],
  UNFILLED_FIELDS: [
    "Заполните все автополя документа перед отправкой.",
    "Yuborishdan oldin barcha avtomaydonlarni to‘ldiring.",
    "Fill all document fields before sending.",
  ],
  OPEN_PROPOSALS: [
    "Сначала примите или отклоните открытые предложения.",
    "Avval ochiq takliflarni qabul qiling yoki rad eting.",
    "Accept or reject open proposals first.",
  ],
  SIGNED_VERSION_MISMATCH: [
    "Подписанный файл должен относиться к согласованной версии.",
    "Imzolangan fayl kelishilgan versiyaga tegishli bo‘lishi kerak.",
    "The signed file must belong to the agreed version.",
  ],
  SLOT_UNAVAILABLE: [
    "Это время уже занято. Выберите другой интервал.",
    "Bu vaqt band. Boshqa oraliqni tanlang.",
    "This time is already booked. Choose another slot.",
  ],
  GOOGLE_NOT_CONFIGURED: [
    "Google Calendar не подключён: нужны OAuth-настройки сервера.",
    "Google Calendar ulanmagan: server OAuth sozlamalari kerak.",
    "Google Calendar is not connected: server OAuth settings are required.",
  ],
  GOOGLE_NOT_CONNECTED: [
    "Сначала подключите Google Calendar.",
    "Avval Google Calendar’ni ulang.",
    "Connect Google Calendar first.",
  ],
  GOOGLE_REAUTH_REQUIRED: [
    "Доступ Google истёк или отозван. Подключите аккаунт повторно.",
    "Google ruxsati tugagan yoki bekor qilingan. Hisobni qayta ulang.",
    "Google access expired or was revoked. Reconnect your account.",
  ],
  CALENDAR_SELECTION_REQUIRED: [
    "Выберите календарь для синхронизации.",
    "Sinxronlash uchun taqvimni tanlang.",
    "Select a calendar to synchronize.",
  ],
  DISCONNECT_BEFORE_SWITCHING: [
    "Перед сменой календаря отключите интеграцию. События в Google сохранятся.",
    "Taqvimni almashtirishdan oldin integratsiyani uzing. Google tadbirlari saqlanadi.",
    "Disconnect before changing calendars. Google events will be retained.",
  ],
  AI_NOT_CONNECTED: [
    "Журобек не подключён для материалов Practice.",
    "Practice materiallari uchun Jurobek ulanmagan.",
    "Jurobek is not connected for Practice materials.",
  ],
  AI_CONSENT_REQUIRED: [
    "Владелец пространства должен разрешить обработку материалов действующим ИИ-сервисом JURO.",
    "Makon egasi materiallarni JURO AI xizmatida qayta ishlashga ruxsat berishi kerak.",
    "The workspace owner must authorize processing by JURO's existing AI service.",
  ],
  AI_UNAVAILABLE: [
    "ИИ-запрос не выполнен. Проверьте подключение и лимиты.",
    "AI so‘rovi bajarilmadi. Ulanish va limitlarni tekshiring.",
    "The AI request failed. Check connection and limits.",
  ],
  PLAN_LIMIT: [
    "Лимит ИИ текущего тарифа исчерпан.",
    "Joriy tarif AI limiti tugagan.",
    "The current plan's AI limit has been reached.",
  ],
  MALWARE_SCANNER_UNAVAILABLE: [
    "Файл не принят: проверка безопасности файлов недоступна.",
    "Fayl qabul qilinmadi: fayl xavfsizligi tekshiruvi mavjud emas.",
    "The file was not accepted: file scanning is unavailable.",
  ],
  FILE_UNSAFE: [
    "Файл не прошёл проверку безопасности.",
    "Fayl xavfsizlik tekshiruvidan o‘tmadi.",
    "The file did not pass the security scan.",
  ],
  INVITATION_EXPIRED: [
    "Приглашение истекло или уже использовано.",
    "Taklif muddati tugagan yoki ishlatilgan.",
    "The invitation expired or was already used.",
  ],
  VERIFIED_ACCOUNT_REQUIRED: [
    "Сначала подтвердите почту учётной записи JURO.",
    "Avval JURO hisobingiz emailini tasdiqlang.",
    "Verify your JURO account email first.",
  ],
  UNAVAILABLE: [
    "Не удалось выполнить действие. Изменения не подтверждены; повторите запрос.",
    "Amal bajarilmadi. O‘zgarishlar tasdiqlanmadi; qayta urinib ko‘ring.",
    "The action failed. Changes are unconfirmed; retry the request.",
  ],
};
export function message(locale: Locale, code: string) {
  return (errors[code] ?? errors.INVALID_INPUT)[
    { ru: 0, uz: 1, en: 2 }[locale]
  ];
}
