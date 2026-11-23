import type { PublicLanguage } from "./types";

type WorkspaceCopy = {
  title: string;
  intro: string;
  choose: string;
  chooseLink: string;
  sample: string;
  open: string;
  monitoring: { label: string; title: string; hint: string; inspect: string; act: string; identifier: string; date: string; source: string };
  calendar: { label: string; title: string; hint: string; month: string; day: string; task: string; matter: string };
  search: { label: string; title: string; hint: string; query: string; results: [string, string][] };
  team: { label: string; title: string; hint: string; preview: string; viewer: string; pending: string };
  more: string;
  individual: string;
  lawyer: string;
  history: string;
  archive: string;
  requests: string;
  schedule: string;
};

export const workspaceCopy = {
  ru: {
    title: "В рабочем пространстве JURO",
    intro: "Следите за публикациями законов, сроками по делам и работой команды. Выберите задачу и попробуйте её на примере.",
    choose: "Выберите задачу", chooseLink: "Рабочее пространство", sample: "Учебный пример", open: "Открыть в JURO",
    monitoring: {
      label: "Мониторинг законов", title: "От публикации к первоисточнику",
      hint: "JURO показывает новые и изменённые записи Lex.uz. Чтобы проверить содержание, откройте сам акт.",
      inspect: "Посмотреть запись Lex.uz", act: "Об утверждении Трудового кодекса Республики Узбекистан", identifier: "ЗРУ-798", date: "28 октября 2022 г.", source: "Открыть акт на Lex.uz",
    },
    calendar: {
      label: "Дела и сроки", title: "Задача на своём месте в календаре",
      hint: "Откройте дату, чтобы увидеть задачу и связанное с ней дело.",
      month: "Май", day: "18 мая", task: "Написать арендодателю о возврате депозита", matter: "Дело · Возврат депозита",
    },
    search: {
      label: "Поиск по пространству", title: "Вернитесь к тому, что уже нашли",
      hint: "Поиск помогает найти сохранённые чаты, дела и документы по одному запросу.",
      query: "Найти «депозит»",
      results: [["Чат", "Когда вернут депозит?"], ["Дело", "Возврат депозита"], ["Документ", "Договор аренды · депозит"]],
    },
    team: {
      label: "Доступ команды", title: "Дайте коллеге доступ для просмотра",
      hint: "В бизнес-пространстве приглашения отправляет владелец или администратор.",
      preview: "Пример приглашения с ролью «Наблюдатель»", viewer: "Наблюдатель", pending: "Ожидает принятия",
    },
    more: "Другие инструменты", individual: "Личное пространство", lawyer: "Кабинет юриста",
    history: "История чатов", archive: "Архив и восстановление дел", requests: "Заявки на консультацию", schedule: "Расписание консультаций",
  },
  uz: {
    title: "JURO ish maydonida",
    intro: "Qonun hujjatlari e’lonlarini, ishlar bo‘yicha muddatlarni va jamoa ishini kuzating. Vazifani tanlab, misolda sinab ko‘ring.",
    choose: "Vazifani tanlang", chooseLink: "Ish maydoni", sample: "Namuna", open: "JURO’da ochish",
    monitoring: {
      label: "Qonunchilik monitoringi", title: "E’londan rasmiy manbagacha",
      hint: "JURO Lex.uz’dagi yangi va yangilangan yozuvlarni ko‘rsatadi. Mazmunini tekshirish uchun hujjatning o‘zini oching.",
      inspect: "Lex.uz yozuvini ko‘rish", act: "O‘zbekiston Respublikasining Mehnat kodeksini tasdiqlash to‘g‘risida", identifier: "O‘RQ-798", date: "2022-yil 28-oktabr", source: "Hujjatni Lex.uz’da ochish",
    },
    calendar: {
      label: "Ishlar va muddatlar", title: "Vazifani kalendardan toping",
      hint: "Vazifa va u bilan bog‘liq ishni ko‘rish uchun sanani oching.",
      month: "May", day: "18-may", task: "Depozitni qaytarish haqida ijaraga beruvchiga yozish", matter: "Ish · Depozitni qaytarish",
    },
    search: {
      label: "Ish maydonida qidirish", title: "Oldingi ishingizni tez toping",
      hint: "Bitta so‘rov orqali saqlangan suhbat, ish va hujjatlarni qidiring.",
      query: "«Depozit»ni qidirish",
      results: [["Suhbat", "Depozit qachon qaytariladi?"], ["Ish", "Depozitni qaytarish"], ["Hujjat", "Ijara shartnomasi · depozit"]],
    },
    team: {
      label: "Jamoa ruxsatlari", title: "Hamkasbingizga ko‘rish huquqini bering",
      hint: "Biznes ish maydonida takliflarni egasi yoki administrator yuboradi.",
      preview: "«Kuzatuvchi» taklifi namunasi", viewer: "Kuzatuvchi", pending: "Qabul qilinishi kutilmoqda",
    },
    more: "Boshqa vositalar", individual: "Shaxsiy ish maydoni", lawyer: "Yurist kabineti",
    history: "Suhbatlar tarixi", archive: "Ishlarni arxivlash va tiklash", requests: "Maslahat so‘rovlari", schedule: "Maslahatlar jadvali",
  },
  en: {
    title: "Inside your JURO workspace",
    intro: "Follow legal publications, keep track of deadlines, and manage who can access your work. Pick a task to try an example.",
    choose: "Choose a task", chooseLink: "Workspace tools", sample: "Worked example", open: "Open in JURO",
    monitoring: {
      label: "Follow legislation", title: "From a new listing to the official act",
      hint: "JURO shows new and changed publication records from Lex.uz. Open the act to check its contents.",
      inspect: "Inspect the Lex.uz record", act: "On Approval of the Labour Code of the Republic of Uzbekistan", identifier: "O‘RQ-798", date: "28 October 2022", source: "Open the act on Lex.uz",
    },
    calendar: {
      label: "Track a deadline", title: "Find a task on your calendar",
      hint: "Open the date to see the task and the matter it belongs to.",
      month: "May", day: "18 May", task: "Write to the landlord about the deposit", matter: "Matter · Deposit return",
    },
    search: {
      label: "Find earlier work", title: "Pick up where you left off",
      hint: "Search for a term across saved chats, matters, and documents.",
      query: "Search for “deposit”",
      results: [["Chat", "When will I get my deposit back?"], ["Matter", "Deposit return"], ["Document", "Rental agreement · deposit"]],
    },
    team: {
      label: "Manage team access", title: "Give a colleague viewing access",
      hint: "In a business workspace, owners and administrators can invite team members.",
      preview: "Preview a Viewer invitation", viewer: "Viewer", pending: "Awaiting acceptance",
    },
    more: "More workspace tools", individual: "Personal workspace", lawyer: "Lawyer workspace",
    history: "Chat history", archive: "Archive and restore matters", requests: "Consultation requests", schedule: "Consultation schedule",
  },
} satisfies Record<PublicLanguage, WorkspaceCopy>;
