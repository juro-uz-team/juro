import { platformPersonalHref } from "../app/components/public/platform-hrefs";
import type { PublicLanguage } from "./types";

export const seoLandingSlugs = ["ai-lawyer", "online-lawyer", "contract-review"] as const;

export type SeoLandingSlug = (typeof seoLandingSlugs)[number];

type SeoLanding = {
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  lead: string;
  scenarioTitle: string;
  scenario: string;
  steps: Array<{ title: string; body: string }>;
  boundariesTitle: string;
  boundaries: string[];
  cta: { label: string; href: string };
  related: { label: string; href: string };
};

export const seoLandings: Record<PublicLanguage, Record<SeoLandingSlug, SeoLanding>> = {
  ru: {
    "ai-lawyer": {
      title: "AI-юрист для права Узбекистана",
      description: "AI-помощник JURO помогает структурировать юридический вопрос, факты и следующий шаг по праву Узбекистана.",
      eyebrow: "JURO · AI-ПОМОЩНИК",
      heading: "Начните с вопроса, а не с догадки",
      lead: "JURO помогает разложить ситуацию на факты, документы, риски и следующий шаг. Если нужен индивидуальный совет, подготовленный контекст можно передать выбранному специалисту только после отдельного подтверждения.",
      scenarioTitle: "Как это выглядит на практике",
      scenario: "Например, при задержке зарплаты сначала важно отделить известные даты, документы и суммы от предположений. Это делает следующий шаг проверяемым, а не автоматически «готовым ответом».",
      steps: [
        { title: "Опишите ситуацию", body: "Укажите цель и известные обстоятельства без лишних персональных данных на публичной странице." },
        { title: "Проверьте факты", body: "Сохраните документы, даты и вопросы, которые ещё требуют подтверждения." },
        { title: "Выберите следующий шаг", body: "Подготовьте план, документ или обращение к независимому юридическому специалисту." },
      ],
      boundariesTitle: "Границы AI-помощи",
      boundaries: ["AI не заменяет индивидуальную юридическую консультацию.", "Юридический результат зависит от фактов, сроков и применимого права.", "Работа с вопросом или файлом начинается в защищённом аккаунте."],
      cta: { label: "Задать вопрос в JURO", href: platformPersonalHref("ru", "/ai-lawyer/new") },
      related: { label: "Какие факты нужны для плана действий", href: "/ru/knowledge/facts-for-action-plan" },
    },
    "online-lawyer": {
      title: "Онлайн-юрист: выбрать специалиста в JURO",
      description: "Каталог JURO помогает сравнить доступных юридических специалистов и оставить запрос на консультацию в защищённом контуре.",
      eyebrow: "JURO · СПЕЦИАЛИСТЫ",
      heading: "Найдите специалиста для следующего шага",
      lead: "В публичном каталоге можно сравнить специализации, опыт, языки и доступность. Материалы дела не публикуются: передача контекста специалисту требует отдельного действия и подтверждения пользователя.",
      scenarioTitle: "Когда полезен живой специалист",
      scenario: "Индивидуальный совет особенно важен, когда есть срок, спор, существенная сумма, риск для бизнеса или необходимость представить интересы перед третьими лицами.",
      steps: [
        { title: "Сравните профиль", body: "Посмотрите специализацию, опыт, языки и формат консультации у доступных специалистов." },
        { title: "Сформулируйте запрос", body: "Кратко опишите задачу, не публикуя личные материалы или конфиденциальные документы." },
        { title: "Подтвердите передачу", body: "JURO передаёт подготовленный контекст только после отдельного подтверждения пользователя." },
      ],
      boundariesTitle: "Как устроен каталог",
      boundaries: ["Профиль получает статус после проверки JURO.", "Юристы и адвокаты не считаются взаимозаменяемыми: статус показывается только при наличии опубликованных данных.", "Специалисты работают независимо, а условия конкретной услуги согласуются отдельно."],
      cta: { label: "Открыть каталог специалистов", href: "/ru/lawyers" },
      related: { label: "Когда нужен профессиональный разбор", href: "/ru/knowledge/when-lawyer-review-is-needed" },
    },
    "contract-review": {
      title: "Проверка договора: подготовить документ к анализу",
      description: "JURO помогает подготовить договор к проверке: собрать версии, вопросы, сроки и условия, которые важно оценить.",
      eyebrow: "JURO · ПРОВЕРКА ДОКУМЕНТА",
      heading: "Проверка договора начинается с контекста сделки",
      lead: "Смысл проверки — понять, какие обязательства, сроки, суммы и риски создаёт текст. JURO помогает собрать факты и подготовить документ к дальнейшему анализу в защищённом аккаунте.",
      scenarioTitle: "Что подготовить до анализа",
      scenario: "Для договора аренды, поставки или услуг обычно нужны последняя версия, приложения, ключевые договорённости и перечень вопросов. Одна формулировка без контекста редко даёт надёжный вывод.",
      steps: [
        { title: "Соберите версии", body: "Подготовьте актуальный договор, приложения и предыдущие редакции с замечаниями." },
        { title: "Отметьте условия", body: "Выделите предмет, оплату, сроки, приёмку, ответственность и прекращение договора." },
        { title: "Проверьте следующий шаг", body: "Решите, нужен ли анализ, сравнение версий, правка проекта или консультация специалиста." },
      ],
      boundariesTitle: "Что важно учитывать",
      boundaries: ["Автоматический анализ не гарантирует юридический результат.", "Условия нужно сопоставлять с документами сделки и актуальной редакцией права.", "Для спорной, срочной или крупной сделки может потребоваться независимый специалист."],
      cta: { label: "Подготовить документ к проверке", href: platformPersonalHref("ru", "/document-analysis") },
      related: { label: "Как подготовиться к проверке договора", href: "/ru/knowledge/contract-review-preparation" },
    },
  },
  uz: {
    "ai-lawyer": {
      title: "O‘zbekiston huquqi uchun AI-yurist",
      description: "JURO AI-yordamchisi yuridik savol, faktlar va keyingi qadamni O‘zbekiston huquqi doirasida tartibga solishga yordam beradi.",
      eyebrow: "JURO · AI-YORDAMCHI",
      heading: "Taxmin bilan emas, savol bilan boshlang",
      lead: "JURO vaziyatni faktlar, hujjatlar, xavflar va keyingi qadamga ajratishga yordam beradi. Individual maslahat zarur bo‘lsa, tayyorlangan kontekst faqat alohida tasdiqdan keyin tanlangan mutaxassisga beriladi.",
      scenarioTitle: "Amalda qanday ishlaydi",
      scenario: "Masalan, ish haqi kechiksa, avval ma’lum sanalar, hujjatlar va summalarni taxminlardan ajratish kerak. Shunda keyingi qadam tekshiriladigan bo‘ladi.",
      steps: [
        { title: "Vaziyatni yozing", body: "Ommaviy sahifada ortiqcha shaxsiy ma’lumotsiz maqsad va ma’lum holatlarni kiriting." },
        { title: "Faktlarni tekshiring", body: "Hujjatlar, sanalar va hali tasdiqlanishi kerak bo‘lgan savollarni saqlang." },
        { title: "Keyingi qadamni tanlang", body: "Reja, hujjat yoki mustaqil yuridik mutaxassisga murojaat tayyorlang." },
      ],
      boundariesTitle: "AI-yordam chegaralari",
      boundaries: ["AI individual yuridik maslahat o‘rnini bosmaydi.", "Natija faktlar, muddatlar va qo‘llaniladigan huquqqa bog‘liq.", "Savol yoki fayl bilan ish himoyalangan akkauntda boshlanadi."],
      cta: { label: "JUROda savol berish", href: platformPersonalHref("uz", "/ai-lawyer/new") },
      related: { label: "Harakatlar rejasi uchun qanday faktlar kerak", href: "/uz/knowledge/facts-for-action-plan" },
    },
    "online-lawyer": {
      title: "Onlayn yurist: JUROda mutaxassis tanlash",
      description: "JURO katalogi mavjud yuridik mutaxassislarni taqqoslash va himoyalangan muhitda maslahat so‘rovini yuborishga yordam beradi.",
      eyebrow: "JURO · MUTAXASSISLAR",
      heading: "Keyingi qadam uchun mutaxassis toping",
      lead: "Ochiq katalogda mutaxassislik, tajriba, til va mavjudlikni taqqoslash mumkin. Ish materiallari e’lon qilinmaydi: kontekstni berish foydalanuvchining alohida harakati va tasdig‘ini talab qiladi.",
      scenarioTitle: "Qachon jonli mutaxassis kerak bo‘ladi",
      scenario: "Muddat, nizo, katta summa, biznes xavfi yoki uchinchi shaxslar oldida manfaatni ifodalash masalasi bo‘lsa, individual maslahat ayniqsa muhim.",
      steps: [
        { title: "Profilni taqqoslang", body: "Mavjud mutaxassislarning yo‘nalishi, tajribasi, tili va maslahat formatini ko‘ring." },
        { title: "So‘rovni tayyorlang", body: "Shaxsiy material yoki maxfiy hujjatlarni e’lon qilmasdan vazifani qisqacha bayon qiling." },
        { title: "Berishni tasdiqlang", body: "JURO tayyorlangan kontekstni faqat foydalanuvchi alohida tasdiqlagandan keyin beradi." },
      ],
      boundariesTitle: "Katalog qanday ishlaydi",
      boundaries: ["Profil JURO tekshiruvidan so‘ng tegishli maqom oladi.", "Yurist va advokat bir xil tushuncha emas: maqom faqat e’lon qilingan ma’lumot mavjud bo‘lsa ko‘rsatiladi.", "Mutaxassislar mustaqil ishlaydi, aniq xizmat shartlari alohida kelishiladi."],
      cta: { label: "Mutaxassislar katalogini ochish", href: "/uz/lawyers" },
      related: { label: "Qachon professional tahlil kerak", href: "/uz/knowledge/when-lawyer-review-is-needed" },
    },
    "contract-review": {
      title: "Shartnomani tekshirish: hujjatni tahlilga tayyorlash",
      description: "JURO shartnomani tekshirishga tayyorlashga yordam beradi: versiyalar, savollar, muddatlar va muhim shartlarni jamlang.",
      eyebrow: "JURO · HUJJATNI TEKSHIRISH",
      heading: "Shartnoma tekshiruvi bitim kontekstidan boshlanadi",
      lead: "Tekshiruvning maqsadi matn qaysi majburiyat, muddat, summa va xavflarni yaratishini tushunishdir. JURO faktlarni yig‘ish va hujjatni himoyalangan akkauntdagi keyingi tahlilga tayyorlashga yordam beradi.",
      scenarioTitle: "Tahlildan oldin nimalarni tayyorlash kerak",
      scenario: "Ijara, yetkazib berish yoki xizmat shartnomasi uchun odatda so‘nggi versiya, ilovalar, asosiy kelishuvlar va savollar kerak bo‘ladi. Kontekstsiz bitta ibora ishonchli xulosa bermaydi.",
      steps: [
        { title: "Versiyalarni yig‘ing", body: "Amaldagi shartnoma, ilovalar va izohli avvalgi tahrirlarni tayyorlang." },
        { title: "Shartlarni belgilang", body: "Predmet, to‘lov, muddat, qabul qilish, javobgarlik va bekor qilishni ajrating." },
        { title: "Keyingi qadamni tekshiring", body: "Tahlil, versiyalarni solishtirish, loyiha tahriri yoki mutaxassis maslahati kerakligini aniqlang." },
      ],
      boundariesTitle: "Muhim cheklovlar",
      boundaries: ["Avtomatik tahlil yuridik natijani kafolatlamaydi.", "Shartlarni bitim hujjatlari va amaldagi huquq bilan solishtirish kerak.", "Nizoli, shoshilinch yoki katta bitim uchun mustaqil mutaxassis kerak bo‘lishi mumkin."],
      cta: { label: "Hujjatni tekshirishga tayyorlash", href: platformPersonalHref("uz", "/document-analysis") },
      related: { label: "Shartnoma tekshiruviga qanday tayyorlanish", href: "/uz/knowledge/contract-review-preparation" },
    },
  },
  en: {
    "ai-lawyer": {
      title: "AI legal assistant for Uzbekistan",
      description: "JURO helps structure a legal question, facts and a next step under the law of Uzbekistan.",
      eyebrow: "JURO · AI LEGAL ASSISTANT",
      heading: "Start with the question, not an assumption",
      lead: "JURO helps separate facts, documents, risks and the next step. Where individual advice is needed, a user can hand prepared context to a chosen professional only after a separate confirmation.",
      scenarioTitle: "What this looks like",
      scenario: "For a delayed salary, first separate known dates, documents and amounts from assumptions. That makes the next step reviewable rather than an automatic final answer.",
      steps: [
        { title: "Describe the situation", body: "State the goal and known circumstances without placing unnecessary personal data on a public page." },
        { title: "Check the facts", body: "Keep documents, dates and questions that still need confirmation together." },
        { title: "Choose a next step", body: "Prepare a plan, a document or a request to an independent legal professional." },
      ],
      boundariesTitle: "Limits of AI assistance",
      boundaries: ["AI does not replace individual legal advice.", "A legal outcome depends on the facts, deadlines and applicable law.", "Work with a question or file begins in a protected account."],
      cta: { label: "Ask JURO a question", href: platformPersonalHref("en", "/ai-lawyer/new") },
      related: { label: "What facts make an action plan useful", href: "/en/knowledge/facts-for-action-plan" },
    },
    "online-lawyer": {
      title: "Online lawyer: find a professional in Uzbekistan",
      description: "JURO’s public catalogue helps compare legal professionals and request a consultation through a protected product flow.",
      eyebrow: "JURO · LEGAL PROFESSIONALS",
      heading: "Find a professional for the next step",
      lead: "Compare specialisms, experience, languages and availability in JURO’s public catalogue. Case materials are not published: sharing prepared context requires a separate action and confirmation from the user.",
      scenarioTitle: "When a professional review matters",
      scenario: "Individual advice is especially important where there is a deadline, dispute, material amount, business risk or a need to represent an interest before another party.",
      steps: [
        { title: "Compare profiles", body: "Review the specialism, experience, languages and consultation format of available professionals." },
        { title: "Prepare a request", body: "Describe the task concisely without publishing personal materials or confidential documents." },
        { title: "Confirm the handoff", body: "JURO shares prepared context only after the user separately confirms it." },
      ],
      boundariesTitle: "How the catalogue works",
      boundaries: ["A profile receives its published status after JURO review.", "Lawyers and advocates are not treated as interchangeable; a status is shown only when published data supports it.", "Professionals work independently and the terms of a particular service are agreed separately."],
      cta: { label: "Browse legal professionals", href: "/en/lawyers" },
      related: { label: "When professional review is needed", href: "/en/knowledge/when-lawyer-review-is-needed" },
    },
    "contract-review": {
      title: "Contract review in Uzbekistan: prepare a document",
      description: "JURO helps prepare a contract for review by collecting versions, questions, deadlines and terms that need attention.",
      eyebrow: "JURO · CONTRACT REVIEW",
      heading: "Contract review starts with the deal context",
      lead: "The purpose of review is to understand the obligations, deadlines, amounts and risks created by a text. JURO helps collect facts and prepare a document for further analysis in a protected account.",
      scenarioTitle: "What to prepare before a review",
      scenario: "For a lease, supply or services agreement, you usually need the latest version, appendices, key agreements and questions. A single clause without context rarely supports a reliable conclusion.",
      steps: [
        { title: "Collect the versions", body: "Prepare the current agreement, appendices and earlier marked-up versions." },
        { title: "Mark key terms", body: "Identify the scope, payment, deadlines, acceptance, liability and termination terms." },
        { title: "Choose the next step", body: "Decide whether analysis, version comparison, drafting changes or professional advice is needed." },
      ],
      boundariesTitle: "Important limits",
      boundaries: ["Automated analysis does not guarantee a legal outcome.", "Terms should be checked against the transaction documents and current law.", "A disputed, urgent or material transaction may require an independent professional."],
      cta: { label: "Prepare a document for review", href: platformPersonalHref("en", "/document-analysis") },
      related: { label: "How to prepare for contract review", href: "/en/knowledge/contract-review-preparation" },
    },
  },
};
