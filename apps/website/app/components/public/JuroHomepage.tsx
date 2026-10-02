"use client";


import { JurobekAvatar } from "./JurobekAvatar";
import { IntelligenceScene } from "./IntelligenceScene";
import Link from "next/link";
import { platformAuthHref, platformPersonalHref, platformRegistrationHref } from "./platform-hrefs";
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  FileCheck2,
  Fingerprint,
  Play,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { ru } from "../../../content/ru";
import { uz } from "../../../content/uz";
import { en } from "../../../content/en";
import type { PublicLanguage } from "../../../content/types";
import { SiteFooter, SiteHeader } from "./SiteChrome";
import { JuroMotionDirector } from "./JuroMotionDirector";
import styles from "./juro-home.module.css";
import motionStyles from "./juro-motion.module.css";
import editorialStyles from "./juro-editorial.module.css";
import decisionStyles from "./juro-decision.module.css";
import laptopStyles from "./juro-laptop.module.css";
import processStyles from "./scenario-process.module.css";

const copy = {
  ru: {
    hero: {
      eyebrow: "JURO · Юрист в кармане",
      titleA: "Расскажите,",
      titleB: "что произошло.",
      titleC: "Получите ясный следующий шаг.",
      lead: "JURO превращает вопрос, договор или срок по праву Узбекистана в понятные факты, риски и план — с возможностью подключить живого юриста.",
      primary: "Разобрать ситуацию бесплатно",
      secondary: "Увидеть JURO в работе",
      note: "Первичный сценарий можно начать бесплатно. Без загрузки данных на публичной странице.",
      scene: "Живая модель результата",
      input: "Ситуация человека",
      output: "Карта решения JURO",
      facts: "Подтверждённые факты",
      source: "Правовое основание",
      risk: "Риск и срок",
      action: "Следующий шаг",
      example: "Обезличенный пример",
    },
    scenarios: [
      {
        tab: "Зарплата",
        question: "Рабодатель второй месяц задерживает зарплату. Что мне делать?",
        facts: "Дата выплаты, трудовой договор, начисления",
        source: "Трудовое право · официальный источник",
        risk: "Важно сохранить доказательства и проверить сроки обращения",
        action: "Зафиксировать долг → подготовить обращение",
      },
      {
        tab: "Договор",
        question: "В договоре аренды неясно, когда возвращают депозит.",
        facts: "Срок аренды, сумма депозита, основания удержания",
        source: "Гражданское и договорное право",
        risk: "Формулировка допускает спорное удержание",
        action: "Уточнить срок и закрытый перечень удержаний",
      },
      {
        tab: "Бизнес",
        question: "Поставщик нарушил срок. Как действовать без потери позиции?",
        facts: "Договор, спецификация, срок, переписка",
        source: "Условия сделки + применимое право",
        risk: "Претензионный порядок и сроки уведомления",
        action: "Собрать доказательства → подготовить претензию",
      },
    ],
    proof: ["Право Узбекистана", "Русский и узбекский", "AI + живой юрист"],
    chapters: [["Путь", "product"], ["Документ", "analysis"], ["Дело", "case-flow"], ["Юрист", "lawyer-handoff"], ["Доверие", "trust"]],
    transition: {
      eyebrow: "НЕ ЕЩЁ ОДИН AI-ЧАТ",
      title: "Юридическая ясность не заканчивается ответом",
      lead: "В JURO каждый результат продолжает предыдущий. Факты, документ, сроки и решения остаются связанными с одним делом.",
      items: [
        ["01", "Понять", "Отделить факты от предположений"],
        ["02", "Проверить", "Увидеть источник и уровень риска"],
        ["03", "Подготовить", "Получить план или документ"],
        ["04", "Продолжить", "Передать контекст живому юристу"],
      ],
    },
    audience: {
      eyebrow: "ЧЕТЫРЕ УГЛА ЗРЕНИЯ",
      title: "Один продукт. Разная причина доверять.",
      investor: "Для партнёра и инвестора",
      investorBody: "Сквозная инфраструктура: AI, документы, дела и сеть специалистов — не набор несвязанных функций.",
      investorCta: "Смотреть презентацию",
    },
    document: {
      eyebrow: "DOCUMENT INTELLIGENCE",
      title: "Не просто подсветить пункт. Объяснить, что он меняет.",
      lead: "JURO связывает конкретную формулировку с риском, последствием и улучшенной редакцией. Пользователь видит не абстрактный балл, а причину.",
      file: "Договор аренды · пример",
      current: "Текущая редакция",
      finding: "Что обнаружено",
      revision: "Предложенная редакция",
      label: "Выберите пункт",
      clauses: [
        ["Депозит", "Депозит может быть удержан арендодателем по его усмотрению.", "Нет закрытого перечня оснований и требования подтвердить ущерб.", "Депозит удерживается только в размере подтверждённой задолженности или ущерба с письменным расчётом."],
        ["Изменение цены", "Арендная плата может быть изменена в одностороннем порядке в любое время.", "Нет срока уведомления и предела изменения стоимости.", "Изменение допускается не чаще одного раза в год с письменным уведомлением не менее чем за 30 дней."],
        ["Расторжение", "Порядок расторжения определяется дополнительным соглашением сторон.", "Ключевой механизм отложен на будущее и не даёт предсказуемого выхода.", "Каждая сторона вправе расторгнуть договор с письменным уведомлением за 30 календарных дней."],
      ],
      cta: "Проверить свой документ",
    },
    continuity: {
      eyebrow: "ЕДИНАЯ НИТЬ ДЕЛА",
      title: "Контекст не теряется между инструментами",
      lead: "Юридическая работа редко заканчивается одним сообщением. JURO сохраняет логику задачи — от первого вопроса до документа и специалиста.",
      steps: ["Ситуация", "Факты", "Источники", "Риски", "План", "Документ", "Юрист"],
      cardTitle: "Дело: возврат депозита",
      cardBody: "3 факта подтверждены · 1 риск требует действия",
      next: "Следующий шаг",
      nextBody: "Уточнить редакцию пункта 4.2 и направить её второй стороне",
    },
    handoff: {
      eyebrow: "AI + ЧЕЛОВЕК",
      title: "Юрист подключается к подготовленному делу, а не к пустому чату",
      lead: "Вы сами выбираете, какие факты, документы и выводы передать. Специалист видит структуру вопроса и продолжает работу с нужного места.",
      dossier: "Досье для передачи",
      ready: "Контекст подготовлен",
      items: ["Краткая хронология", "Подтверждённые факты", "Документы и риски", "Выбранный следующий шаг"],
      cta: "Посмотреть каталог юристов",
    },
    trust: {
      eyebrow: "ДОВЕРИЕ БЕЗ ЛОЗУНГОВ",
      title: "Проверяемые механики вместо обещания «всё безопасно»",
      lead: "JURO отделяет уже подтверждённое от того, что ещё уточняется. Это честнее — и полезнее для решения о доверии.",
      verified: "Подтверждено",
      policy: "Описано в политике",
      cta: "Открыть Trust Center",
      legal: "Все юридические документы",
    },
    resources: {
      eyebrow: "ПОЗНАКОМЬТЕСЬ БЛИЖЕ",
      title: "Не ищите отдельные адреса",
      items: [
        ["Видео", "2:42", "Посмотреть продукт и подход JURO", "video"],
        ["Юристы", "Каталог", "Познакомиться со специалистами", "lawyers"],
        ["Trust Center", "Факты", "Проверить работу с данными", "trust"],
        ["Правовой центр", "RU · UZ", "Открыть политики и условия", "legal"],
      ],
    },
    access: {
      eyebrow: "НАЧАТЬ БЕЗ ЛИШНЕГО РИСКА",
      title: "Сначала поймите ценность. Потом выбирайте формат.",
      plans: [
        ["Для себя", "Бесплатный старт", "Разбор личной ситуации, документы и понятный план", "Начать бесплатно"],
        ["Для бизнеса", "Условия до подтверждения", "Договоры, роли, сроки и единая история работы", "Создать бизнес-пространство"],
        ["Для юридической команды", "Индивидуальный формат", "Исследования, документы, согласование и аудит", "Обсудить задачу"],
      ],
      note: "Работа живого юриста и дополнительные услуги согласуются отдельно до подтверждения.",
    },
    faqTitle: "Вопросы, которые стоит задать до начала",
    finalTitle: "От вопроса — к действию.",
    finalBody: "Опишите ситуацию. JURO поможет превратить её в факты, риски и понятный следующий шаг.",
    finalPrimary: "Начать бесплатно",
    finalSecondary: "Посмотреть видео",
  },
  uz: {
    hero: {
      eyebrow: "JURO · Cho‘ntagingizdagi yurist",
      titleA: "Nima bo‘lganini",
      titleB: "aytib bering.",
      titleC: "Aniq keyingi qadamni oling.",
      lead: "JURO O‘zbekiston huquqi bo‘yicha savol, shartnoma yoki muddatni tushunarli faktlar, xavflar va rejaga aylantiradi — zarur bo‘lsa jonli yuristni ulaydi.",
      primary: "Vaziyatni bepul tahlil qilish",
      secondary: "JURO qanday ishlashini ko‘rish",
      note: "Birinchi ssenariyni bepul boshlash mumkin. Ommaviy sahifaga ma’lumot yuklanmaydi.",
      scene: "Natijaning jonli modeli",
      input: "Inson vaziyati",
      output: "JURO yechim xaritasi",
      facts: "Tasdiqlangan faktlar",
      source: "Huquqiy asos",
      risk: "Xavf va muddat",
      action: "Keyingi qadam",
      example: "Shaxssizlashtirilgan misol",
    },
    scenarios: [
      { tab: "Maosh", question: "Ish beruvchi ikkinchi oy maoshni kechiktiryapti. Nima qilay?", facts: "To‘lov sanasi, mehnat shartnomasi, hisob-kitob", source: "Mehnat huquqi · rasmiy manba", risk: "Dalillarni saqlash va murojaat muddatini tekshirish kerak", action: "Qarzni qayd etish → murojaat tayyorlash" },
      { tab: "Shartnoma", question: "Ijara shartnomasida depozit qachon qaytarilishi aniq emas.", facts: "Ijara muddati, depozit summasi, ushlab qolish asoslari", source: "Fuqarolik va shartnoma huquqi", risk: "Matn bahsli ushlab qolishga yo‘l beradi", action: "Muddat va yopiq asoslar ro‘yxatini aniqlashtirish" },
      { tab: "Biznes", question: "Yetkazib beruvchi muddatni buzdi. Pozitsiyani yo‘qotmasdan nima qilish kerak?", facts: "Shartnoma, spetsifikatsiya, muddat, yozishmalar", source: "Bitim shartlari + qo‘llaniladigan huquq", risk: "Talabnoma tartibi va xabardor qilish muddati", action: "Dalillar → talabnoma loyihasi" },
    ],
    proof: ["O‘zbekiston huquqi", "Rus va o‘zbek tillari", "AI + jonli yurist"],
    chapters: [["Yo‘l", "product"], ["Hujjat", "analysis"], ["Ish", "case-flow"], ["Yurist", "lawyer-handoff"], ["Ishonch", "trust"]],
    transition: { eyebrow: "YANA BIR AI-CHAT EMAS", title: "Yuridik aniqlik javob bilan tugamaydi", lead: "JUROda har bir natija avvalgisini davom ettiradi. Fakt, hujjat, muddat va qarorlar bitta ish bilan bog‘liq qoladi.", items: [["01", "Tushunish", "Faktni taxmindan ajratish"], ["02", "Tekshirish", "Manba va xavf darajasini ko‘rish"], ["03", "Tayyorlash", "Reja yoki hujjat olish"], ["04", "Davom ettirish", "Kontekstni jonli yuristga topshirish"]] },
    audience: { eyebrow: "TO‘RT NUQTAI NAZAR", title: "Bitta mahsulot. Ishonish uchun turli sabab.", investor: "Hamkor va investor uchun", investorBody: "AI, hujjatlar, ishlar va mutaxassislar tarmog‘i — alohida funksiyalar emas, yagona infratuzilma.", investorCta: "Taqdimotni ko‘rish" },
    document: { eyebrow: "DOCUMENT INTELLIGENCE", title: "Bandni ajratishning o‘zi emas. Uning ta’sirini tushuntirish.", lead: "JURO aniq matnni xavf, oqibat va yaxshilangan tahrir bilan bog‘laydi. Foydalanuvchi mavhum ball emas, sababni ko‘radi.", file: "Ijara shartnomasi · misol", current: "Joriy tahrir", finding: "Nima aniqlandi", revision: "Taklif etilgan tahrir", label: "Bandni tanlang", clauses: [["Depozit", "Depozit ijaraga beruvchining ixtiyoriga ko‘ra ushlab qolinishi mumkin.", "Asoslarning yopiq ro‘yxati va zararni tasdiqlash talabi yo‘q.", "Depozit faqat tasdiqlangan qarzdorlik yoki zarar miqdorida yozma hisob bilan ushlab qolinadi."], ["Narx o‘zgarishi", "Ijara haqi istalgan vaqtda bir tomonlama o‘zgartirilishi mumkin.", "Xabardor qilish muddati va o‘zgarish chegarasi yo‘q.", "O‘zgarish yiliga bir martadan ko‘p bo‘lmagan holda kamida 30 kun oldin yozma xabar bilan amalga oshiriladi."], ["Bekor qilish", "Bekor qilish tartibi tomonlarning qo‘shimcha kelishuvi bilan belgilanadi.", "Asosiy chiqish mexanizmi kelajakka qoldirilgan.", "Har bir tomon 30 kalendar kun oldin yozma xabar bilan shartnomani bekor qilishi mumkin."]], cta: "Hujjatimni tekshirish" },
    continuity: { eyebrow: "ISHNING YAGONA IPI", title: "Kontekst vositalar o‘rtasida yo‘qolmaydi", lead: "Yuridik ish kamdan-kam bitta xabar bilan tugaydi. JURO birinchi savoldan hujjat va mutaxassisgacha vazifa mantiqini saqlaydi.", steps: ["Vaziyat", "Faktlar", "Manbalar", "Xavflar", "Reja", "Hujjat", "Yurist"], cardTitle: "Ish: depozitni qaytarish", cardBody: "3 fakt tasdiqlangan · 1 xavf harakat talab qiladi", next: "Keyingi qadam", nextBody: "4.2-band tahririni aniqlashtirish va ikkinchi tomonga yuborish" },
    handoff: { eyebrow: "AI + INSON", title: "Yurist bo‘sh chatga emas, tayyorlangan ishga ulanadi", lead: "Qaysi fakt, hujjat va xulosalarni berishni o‘zingiz tanlaysiz. Mutaxassis savol tuzilishini ko‘rib, kerakli joydan davom etadi.", dossier: "Topshirish uchun dosye", ready: "Kontekst tayyor", items: ["Qisqa xronologiya", "Tasdiqlangan faktlar", "Hujjatlar va xavflar", "Tanlangan keyingi qadam"], cta: "Yuristlar katalogini ko‘rish" },
    trust: { eyebrow: "SHIORSIZ ISHONCH", title: "«Hammasi xavfsiz» va’dasi o‘rniga tekshiriladigan mexanika", lead: "JURO tasdiqlangan ma’lumotni hali aniqlashtirilayotgan ma’lumotdan ajratadi. Bu qaror uchun halolroq va foydaliroq.", verified: "Tasdiqlangan", policy: "Siyosatda bayon qilingan", cta: "Trust Centerni ochish", legal: "Barcha yuridik hujjatlar" },
    resources: { eyebrow: "YAQINROQ TANISHING", title: "Alohida manzillarni qidirmang", items: [["Video", "2:42", "JURO mahsuloti va yondashuvini ko‘rish", "video"], ["Yuristlar", "Katalog", "Mutaxassislar bilan tanishish", "lawyers"], ["Trust Center", "Faktlar", "Ma’lumotlar bilan ishlashni tekshirish", "trust"], ["Yuridik markaz", "RU · UZ", "Siyosat va shartlarni ochish", "legal"]] },
    access: { eyebrow: "ORTIQCHA XAVFSIZ BOSHLASH", title: "Avval qiymatni tushuning. Keyin formatni tanlang.", plans: [["O‘zingiz uchun", "Bepul boshlanish", "Shaxsiy vaziyat tahlili, hujjatlar va tushunarli reja", "Bepul boshlash"], ["Biznes uchun", "Tasdiqdan oldingi shartlar", "Shartnomalar, rollar, muddatlar va yagona tarix", "Biznes makonini yaratish"], ["Yuridik jamoa uchun", "Individual format", "Tadqiqot, hujjat, kelishuv va audit", "Vazifani muhokama qilish"]], note: "Jonli yurist va qo‘shimcha xizmatlar tasdiqdan oldin alohida kelishiladi." },
    faqTitle: "Boshlashdan oldin berish kerak bo‘lgan savollar",
    finalTitle: "Savoldan — harakatga.",
    finalBody: "Vaziyatni yozing. JURO uni fakt, xavf va tushunarli keyingi qadamga aylantirishga yordam beradi.",
    finalPrimary: "Bepul boshlash",
    finalSecondary: "Videoni ko‘rish",
  },
} as const;

const englishCopy = {
  hero: {
    eyebrow: "JURO · Legal guidance in your pocket",
    titleA: "Tell us",
    titleB: "what happened.",
    titleC: "Get a clear next step.",
    lead: "JURO turns a question, contract or deadline under Uzbekistan law into understandable facts, risks and a plan — with the option to involve a legal professional.",
    primary: "Explore your situation",
    secondary: "See JURO in action",
    note: "You can explore the first scenario without charge. Do not upload case materials on this public page.",
    scene: "A live model of the outcome",
    input: "Your situation",
    output: "JURO decision map",
    facts: "Verified facts",
    source: "Legal basis",
    risk: "Risk and deadline",
    action: "Next step",
    example: "An anonymised example",
  },
  scenarios: [
    { tab: "Salary", question: "My employer has delayed my salary for a second month. What should I do?", facts: "Pay date, employment agreement, accruals", source: "Employment law · official source", risk: "Keep evidence and check the deadline for an application", action: "Record the debt → prepare an application" },
    { tab: "Contract", question: "The lease agreement does not clearly say when the deposit is returned.", facts: "Lease term, deposit amount, grounds for withholding", source: "Civil and contract law", risk: "The wording allows a disputed withholding", action: "Clarify the deadline and exhaustive grounds for withholding" },
    { tab: "Business", question: "A supplier missed a deadline. How can we act without losing our position?", facts: "Agreement, specification, deadline, correspondence", source: "Deal terms + applicable law", risk: "Pre-claim procedure and notice deadlines", action: "Collect evidence → prepare a claim" },
  ],
  proof: ["Law of Uzbekistan", "Russian, Uzbek and English public site", "AI + legal professional"],
  chapters: [["Journey", "product"], ["Document", "analysis"], ["Case", "case-flow"], ["Professional", "lawyer-handoff"], ["Trust", "trust"]],
  transition: { eyebrow: "NOT ANOTHER AI CHAT", title: "Legal clarity does not end with an answer", lead: "In JURO, each result continues the previous one. Facts, documents, deadlines and decisions stay connected to one case.", items: [["01", "Understand", "Separate facts from assumptions"], ["02", "Verify", "See the source and level of risk"], ["03", "Prepare", "Get a plan or document"], ["04", "Continue", "Hand approved context to a legal professional"]] },
  audience: { eyebrow: "FOUR PERSPECTIVES", title: "One product. Different reasons to trust it.", investor: "For partners and investors", investorBody: "AI, documents, cases and a professional network are designed as one infrastructure — not disconnected features.", investorCta: "Watch the presentation" },
  document: { eyebrow: "DOCUMENT INTELLIGENCE", title: "Not just highlighting a clause. Explaining what it changes.", lead: "JURO connects specific wording to a risk, consequence and improved draft. The user sees a reason, not an abstract score.", file: "Lease agreement · example", current: "Current wording", finding: "What was found", revision: "Suggested wording", label: "Choose a clause", clauses: [["Deposit", "The deposit may be withheld by the landlord at its discretion.", "There is no exhaustive list of grounds or requirement to substantiate damage.", "The deposit may be withheld only for documented debt or damage, together with a written calculation."], ["Price change", "The rent may be changed unilaterally at any time.", "There is no notice period or limit on the amount of the change.", "A change is permitted no more than once a year with written notice at least 30 days in advance."], ["Termination", "The termination procedure is determined by an additional agreement of the parties.", "The key exit mechanism is deferred and gives neither party a predictable outcome.", "Either party may terminate the agreement by giving 30 calendar days' written notice."]], cta: "Review a document" },
  continuity: { eyebrow: "ONE CONTINUOUS CASE", title: "Context is not lost between tools", lead: "Legal work rarely ends with a single message. JURO preserves the logic of a task from the first question to a document and a professional.", steps: ["Situation", "Facts", "Sources", "Risks", "Plan", "Document", "Professional"], cardTitle: "Case: return of a deposit", cardBody: "3 facts verified · 1 risk requires action", next: "Next step", nextBody: "Clarify the wording of clause 4.2 and send it to the other party" },
  handoff: { eyebrow: "AI + HUMAN", title: "A professional joins a prepared case, not an empty chat", lead: "You choose which facts, documents and conclusions to share. The professional sees a structured question and can continue from the right place.", dossier: "Handoff dossier", ready: "Context prepared", items: ["Brief timeline", "Verified facts", "Documents and risks", "Chosen next step"], cta: "Browse legal professionals" },
  trust: { eyebrow: "TRUST WITHOUT SLOGANS", title: "Verifiable mechanics instead of a promise that everything is safe", lead: "JURO separates what is confirmed from what is still being clarified. That is more honest — and more useful when deciding whether to trust a service.", verified: "Confirmed", policy: "Described in policy", cta: "Open Trust Center", legal: "Legal Centre" },
  resources: { eyebrow: "GET TO KNOW JURO", title: "Your public JURO starting points", items: [["Video", "2:42", "Watch JURO’s product and approach", "video"], ["Professionals", "Catalogue", "Meet available legal professionals", "lawyers"], ["Trust Center", "Facts", "Review how data is handled", "trust"], ["Legal Centre", "RU · UZ", "Read published legal originals", "legal"]] },
  access: { eyebrow: "START WITH CLARITY", title: "Understand the value first. Then choose a format.", plans: [["For yourself", "Start without charge", "Explore a personal situation, documents and a clear plan", "Get started"], ["For business", "Terms before confirmation", "Contracts, roles, deadlines and one shared work history", "Create a business workspace"], ["For legal teams", "Tailored format", "Research, documents, review and audit", "Discuss your needs"]], note: "Professional legal services and additional services are agreed separately before confirmation." },
  faqTitle: "Questions worth asking before you start",
  finalTitle: "From a question to a next step.",
  finalBody: "Describe the situation. JURO helps turn it into facts, risks and a clear next step.",
  finalPrimary: "Get started",
  finalSecondary: "Watch the video",
} as const;

export function JuroHomepage({ language }: { language: PublicLanguage }) {
  const t = language === "en" ? englishCopy : copy[language];
  const headline = language === "ru" ? ["Право становится", "понятным.", "AI, документы и юристы. В одной системе."] : language === "uz" ? ["Huquq endi", "tushunarli.", "AI, hujjatlar va yuristlar. Bitta tizimda."] : ["Legal complexity.", "Made clear.", "AI, documents and lawyers. One connected workspace."];
  const baseContent = language === "ru" ? ru : language === "uz" ? uz : en;
  const [publishedFaq,setPublishedFaq]=useState<{question:string;answer:string}[]|null>(null);
  useEffect(()=>{let active=true;fetch(`/api/site-content?kind=faq&locale=${language}`).then(r=>r.ok?r.json():null).then(rows=>{if(active&&Array.isArray(rows)&&rows.length)setPublishedFaq(rows.map((r:{title:string;body:string})=>({question:r.title,answer:r.body})));}).catch(()=>{});return()=>{active=false;setPublishedFaq(null);};},[language]);
  const content={...baseContent,faq:{...baseContent.faq,items:publishedFaq??baseContent.faq.items}};
  const [scenario, setScenario] = useState(0);
  const [processStep, setProcessStep] = useState(0);
  const [clause, setClause] = useState(0);
  const [journey, setJourney] = useState(0);
  const journeyNotes = language === "ru" ? ["Один вопрос создаёт общую рабочую нить дела.", "Подтверждённые факты остаются рядом с исходным вопросом.", "Правовые основания связаны с фактами, которые они объясняют.", "Риск сохраняет связь с конкретным пунктом документа.", "Следующее действие опирается на уже собранные материалы.", "Документ продолжает работу с теми же фактами и выводами.", "Вы выбираете, какой контекст передать специалисту."] : language === "uz" ? ["Bitta savol ishning umumiy yo‘lini boshlaydi.", "Tasdiqlangan faktlar asl savol bilan birga saqlanadi.", "Huquqiy asoslar tegishli faktlar bilan bog‘lanadi.", "Xavf hujjatning aniq bandi bilan bog‘liq qoladi.", "Keyingi qadam yig‘ilgan materiallarga tayanadi.", "Hujjat o‘sha faktlar va xulosalar bilan davom etadi.", "Mutaxassisga qaysi kontekstni uzatishni siz tanlaysiz."] : ["One question starts a shared thread for the case.", "Confirmed facts stay alongside the original question.", "Legal sources stay linked to the facts they explain.", "Each risk retains its connection to the exact clause.", "The next action builds on materials already collected.", "The document carries the same facts and findings forward.", "You choose which context to share with a professional."];
  const clauseInteracted = useRef(false);
  const activeScenario = t.scenarios[scenario];
  const processLabels = [t.hero.facts, t.hero.risk, t.hero.source, t.hero.action];
  const activeClause = t.document.clauses[clause];
  const register = platformRegistrationHref(language);

  const scrollToSection = (targetId: string) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 88;
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    root.style.scrollBehavior = previousScrollBehavior;
  };

  const navigateToSection = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const rawHash = event.currentTarget.hash.slice(1);
    if (!rawHash) return;
    let targetId: string;
    try { targetId = decodeURIComponent(rawHash); } catch { return; }
    if (!document.getElementById(targetId)) return;
    event.preventDefault();
    if (window.location.hash !== `#${rawHash}`) window.history.pushState(null, "", `#${rawHash}`);
    scrollToSection(targetId);
  };

  useEffect(() => {
    const scrollToHash = () => {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      let targetId: string;
      try { targetId = decodeURIComponent(hash); } catch { return; }
      scrollToSection(targetId);
    };
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    window.addEventListener("popstate", scrollToHash);
    return () => {
      window.removeEventListener("hashchange", scrollToHash);
      window.removeEventListener("popstate", scrollToHash);
    };
  }, []);

  useEffect(() => {
    const target = document.getElementById("ai-playground");
    if (!target) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    let visible = false;
    const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
    const sync = () => {
      stop();
      if (media.matches) { setProcessStep(3); return; }
      if (visible && !document.hidden) timer = setInterval(() => setProcessStep(current => {
        if (current >= 3) { stop(); return 3; }
        return current + 1;
      }), 550);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: .15 });
    observer.observe(target);
    document.addEventListener("visibilitychange", sync);
    media.addEventListener("change", sync);
    return () => { stop(); observer.disconnect(); document.removeEventListener("visibilitychange", sync); media.removeEventListener("change", sync); };
  }, [scenario]);

  useEffect(() => {
    const updateClause = (event: Event) => {
      if (clauseInteracted.current) return;
      const next = (event as CustomEvent<number>).detail;
      if (Number.isInteger(next) && next >= 0 && next < t.document.clauses.length) setClause(next);
    };
    document.addEventListener("juro:document-step", updateClause);
    return () => document.removeEventListener("juro:document-step", updateClause);
  }, [t.document.clauses.length]);

  const selectScenario = (index: number) => {
    setProcessStep(0);
    setScenario(index);
  };

  const selectClause = (index: number) => {
    clauseInteracted.current = true;
    setClause(index);
  };

  const moveTab = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: number,
    length: number,
    prefix: string,
    select: (index: number) => void,
  ) => {
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + length) % length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = length - 1;
    else return;
    event.preventDefault();
    select(next);
    requestAnimationFrame(() => document.getElementById(`${prefix}-${next}`)?.focus());
  };

  return (
    <div className={`${styles.page} ${motionStyles.motionRoot}`} data-juro-motion-root lang={language}>
      <JuroMotionDirector />
      <SiteHeader locale={language} onSectionNavigation={navigateToSection} tone="dark" />
      <nav aria-label={language === "ru" ? "Разделы истории JURO" : language === "uz" ? "JURO hikoyasi bo‘limlari" : "JURO story sections"} className={motionStyles.chapterNav}>
        {t.chapters.map(([label, id], index) => <a data-chapter-link href={`#${id}`} key={id} onClick={navigateToSection}><span>0{index + 1}</span><strong>{label}</strong></a>)}
      </nav>
      <main id="main-content">
        <section className={`${styles.hero} ${motionStyles.heroMotion}`} data-motion-hero>
          <div aria-hidden="true" className={`${styles.heroAtmosphere} ${motionStyles.atmosphereMotion}`}><i /><i /><i /></div>
          <div className={`${styles.heroGrid} ${laptopStyles.heroGrid}`}>
            <div className={`${styles.heroCopy} ${motionStyles.heroCopyMotion} ${laptopStyles.heroCopy}`}>
              <p className={styles.eyebrow}>{t.hero.eyebrow}</p>
              <h1 className={laptopStyles.heroTitle}><span>{headline[0]}</span><span>{headline[1]}</span><em>{headline[2]}</em></h1>
              <p className={styles.heroLead}>{t.hero.lead}</p>
              <div className={styles.heroActions}>
                <a className={styles.buttonGold} href={register}>{t.hero.primary}<ArrowRight aria-hidden="true" size={18} /></a>
                <a className={styles.buttonGhost} href="#ai-playground" onClick={navigateToSection}><Play aria-hidden="true" size={16} />{t.hero.secondary}</a>
              </div>
              <p className={styles.heroNote}>{t.hero.note}</p>
              <ul className={styles.heroProof}>{t.proof.map((item) => <li key={item}><Check aria-hidden="true" size={14} />{item}</li>)}</ul>
            </div>
            <IntelligenceScene language={language} />
          </div>
        </section>

        <section className={styles.playground} id="ai-playground">
          <header data-reveal><p className={styles.eyebrowDark}>01 / ASK JURO</p><h2>{language === "ru" ? "Ваш вопрос.\nСистема действий." : language === "uz" ? "Savolingiz. Harakatlar tizimi." : "Your question. A way forward."}</h2><p>{language === "ru" ? "Выберите ситуацию. Посмотрите, как JURO связывает факты, источники и следующий шаг." : language === "uz" ? "Vaziyatni tanlang. JURO faktlar, manbalar va keyingi qadamni qanday bog‘lashini ko‘ring." : "Choose a situation. Explore how JURO connects facts, sources and the next step."}</p><a className={styles.playgroundLink} href={register}>{t.finalPrimary}<ArrowRight size={18} aria-hidden="true" /></a></header>
            <div className={`${styles.heroProduct} ${styles.playgroundWindow} ${laptopStyles.heroProduct}`}>
              <div className={styles.sceneTop}><span><CircleDot aria-hidden="true" size={14} />{t.hero.scene}</span><small>01 — 04</small></div>
              <div aria-label={language === "ru" ? "Примеры юридических ситуаций" : language === "uz" ? "Yuridik vaziyatlar misollari" : "Examples of legal situations"} className={styles.scenarioTabs} role="tablist">
                {t.scenarios.map((item, index) => <button aria-controls="scenario-panel" aria-selected={scenario === index} id={`scenario-tab-${index}`} key={item.tab} onClick={() => selectScenario(index)} onKeyDown={(event) => moveTab(event, index, t.scenarios.length, "scenario-tab", selectScenario)} role="tab" tabIndex={scenario === index ? 0 : -1} type="button">{item.tab}</button>)}
              </div>
              <div aria-labelledby={`scenario-tab-${scenario}`} className={`${styles.caseMap} ${motionStyles.caseMapMotion}`} id="scenario-panel" key={scenario} role="tabpanel">
                <div className={`${styles.caseInput} ${motionStyles.caseInputMotion}`}><span>{t.hero.input}</span><p>{activeScenario.question}</p></div>
                <div aria-hidden="true" className={`${styles.caseThread} ${motionStyles.caseThreadMotion}`}><i /><i /><i /><i /></div>
                <div className={`${styles.caseOutput} ${motionStyles.caseOutputMotion} ${processStyles.output}`}>
                  <div className={processStyles.heading}><span className={styles.outputLabel}>{t.hero.output}</span><span>{t.hero.example}</span></div>
                  <ol aria-label={t.hero.example} className={processStyles.flow}>{processLabels.map((label, index) => <li data-current={processStep === index || undefined} key={label}>{label}</li>)}</ol>
                  <article data-complete={processStep > 0 || undefined} data-current={processStep === 0 || undefined}><Fingerprint aria-hidden="true" size={18} /><div><small>{t.hero.facts}</small><strong>{activeScenario.facts}</strong></div></article>
                  <article data-complete={processStep > 1 || undefined} data-current={processStep === 1 || undefined}><Clock3 aria-hidden="true" size={18} /><div><small>{t.hero.risk}</small><strong>{activeScenario.risk}</strong></div></article>
                  <article data-complete={processStep > 2 || undefined} data-current={processStep === 2 || undefined}><Scale aria-hidden="true" size={18} /><div><small>{t.hero.source}</small><strong>{activeScenario.source}</strong></div></article>
                  <article className={styles.actionResult} data-current={processStep === 3 || undefined}><ArrowDownRight aria-hidden="true" size={18} /><div><small>{t.hero.action}</small><strong>{activeScenario.action}</strong></div></article>
                </div>
              </div>
            </div>
        </section>

        <section className={`${styles.transitionSection} ${motionStyles.storySection} ${laptopStyles.transitionSection}`} data-chapter id="product">
          <div className={`${styles.sectionIntro} ${laptopStyles.sectionIntro}`} data-reveal="left"><p className={styles.eyebrowDark}>{t.transition.eyebrow}</p><h2 className={laptopStyles.transitionTitle}>{t.transition.title}</h2><p>{t.transition.lead}</p></div>
          <div className={`${styles.transitionRail} ${motionStyles.storyRail}`} data-story-rail>{t.transition.items.map(([number, title, body]) => <article className={motionStyles.storyStep} data-story-step key={number}><span>{number}</span><div><h3>{title}</h3><p>{body}</p></div><ChevronRight aria-hidden="true" size={18} /></article>)}</div>
        </section>

        <section className={styles.audienceSection} id="audiences">
          <header className={styles.sectionHeader} data-reveal><p className={styles.eyebrowDark}>{t.audience.eyebrow}</p><h2>{t.audience.title}</h2></header>
          <div className={styles.audienceLayout}>
            <div className={styles.audienceList}>{content.audience.top.map((item, index) => <article className={motionStyles.audienceCardMotion} data-reveal="left" key={item.id}><span>0{index + 1}{index === 0 ? <Fingerprint size={24}/> : index === 1 ? <FileCheck2 size={24}/> : <Scale size={24}/>}</span><div><h3>{item.title}</h3><p>{item.body}</p><ul>{item.scenarios.map((scenarioItem) => <li key={scenarioItem}>{scenarioItem}</li>)}</ul></div><a href={`${register}&intent=${item.id}`}>{item.cta}<ArrowRight aria-hidden="true" size={16} /></a></article>)}</div>
            <aside className={`${styles.investorPanel} ${motionStyles.investorMotion}`} data-reveal="right"><span>04</span><Sparkles aria-hidden="true" size={26} /><h3>{t.audience.investor}</h3><p>{t.audience.investorBody}</p><Link href={`/${language}/video`}>{t.audience.investorCta}<ArrowRight aria-hidden="true" size={17} /></Link></aside>
          </div>
        </section>

        <section className={`${styles.documentSection} ${motionStyles.documentStory}`} data-chapter data-document-story id="analysis">
          <header className={styles.documentIntro} data-reveal><p className={styles.eyebrowLight}>{t.document.eyebrow}</p><h2>{t.document.title}</h2><p>{t.document.lead}</p></header>
          <div className={`${styles.documentLab} ${motionStyles.documentLabMotion}`} data-reveal="mask">
            <div className={`${styles.documentCanvas} ${motionStyles.documentCanvasMotion}`}>
              <div className={styles.documentToolbar}><span><FileCheck2 aria-hidden="true" size={16} />{t.document.file}</span><i>•••</i></div>
              <div className={styles.revisionLegend}>{language === "ru" ? "До → после · пример правки" : language === "uz" ? "Oldin → keyin · tahrir namunasi" : "Before → after · suggested edit"}</div>
              {t.document.clauses.map((item,index)=><p data-current={clause === index || undefined} key={item[0]}>{["4.1.","4.2.","6.3."][index]} {clause === index ? <><del>{item[1]}</del><ins>{item[3]}</ins></> : item[1]}</p>)}
              <div aria-hidden="true" className={styles.documentMarker} data-clause={clause}>0{clause + 1}</div>
            </div>
            <div className={styles.findingPanel}>
              <span>{t.document.label}</span>
              <div aria-label={t.document.label} className={styles.clauseTabs} role="tablist">{t.document.clauses.map((item, index) => <button aria-controls="clause-panel" aria-selected={clause === index} id={`clause-tab-${index}`} key={item[0]} onClick={() => selectClause(index)} onKeyDown={(event) => moveTab(event, index, t.document.clauses.length, "clause-tab", selectClause)} role="tab" tabIndex={clause === index ? 0 : -1} type="button">0{index + 1}<small>{item[0]}</small></button>)}</div>
              <div aria-labelledby={`clause-tab-${clause}`} aria-live="polite" className={`${styles.findingContent} ${motionStyles.findingContentMotion}`} id="clause-panel" key={clause} role="tabpanel">
                <small>{t.document.current}</small><p>{activeClause[1]}</p>
                <small>{t.document.finding}</small><strong>{activeClause[2]}</strong>
                <small>{t.document.revision}</small><blockquote>{activeClause[3]}</blockquote>
              </div>
              <a href={platformPersonalHref(language, "/document-analysis")}>{t.document.cta}<ArrowRight aria-hidden="true" size={17} /></a>
            </div>
          </div>
        </section>

        <section className={`${styles.continuitySection} ${motionStyles.continuityMotion}`} data-chapter data-continuity-story id="case-flow">
          <div className={styles.continuityCopy} data-reveal="left"><p className={styles.eyebrowDark}>{t.continuity.eyebrow}</p><h2>{t.continuity.title}</h2><p>{t.continuity.lead}</p></div>
          <div className={`${styles.continuityVisual} ${motionStyles.continuityVisualMotion}`} data-reveal="right">
            <div className={styles.caseCard}><small>JURO / CASE 024</small><h3>{t.continuity.cardTitle}</h3><p>{t.continuity.cardBody}</p></div>
            <ol className={styles.journeySteps}>{t.continuity.steps.map((step, index) => <li key={step}><button type="button" aria-pressed={journey === index} onClick={()=>setJourney(index)}><span>0{index + 1}</span>{step}</button></li>)}</ol>
            <div className={styles.contextCarry}><FileCheck2 size={16}/><span>CASE 024</span><span>{t.document.file}</span><Check size={15}/></div>
            <div className={styles.nextCard}><span>0{journey+1} / {t.continuity.steps[journey]}</span><strong aria-live="polite">{journeyNotes[journey]}</strong><ArrowDownRight aria-hidden="true" size={20} /></div>
          </div>
        </section>

        <section className={`${styles.handoffSection} ${motionStyles.handoffMotion}`} data-chapter data-handoff-story id="lawyer-handoff">
          <JurobekAvatar language={language} />
          <div className={styles.handoffCopy} data-reveal><p className={styles.eyebrowLight}>{t.handoff.eyebrow}</p><h2>{t.handoff.title}</h2><p>{t.handoff.lead}</p><Link href={`/${language}/lawyers`}>{t.handoff.cta}<ArrowRight aria-hidden="true" size={18} /></Link></div>
          <div className={`${styles.dossier} ${motionStyles.dossierMotion}`}><div><span>{t.handoff.dossier}</span><small><ShieldCheck aria-hidden="true" size={15} />{t.handoff.ready}</small></div>{t.handoff.items.map((item, index) => <p key={item}><i>0{index + 1}</i><Check aria-hidden="true" size={15} />{item}</p>)}</div>
        </section>

        <section className={`${styles.trustSection} ${editorialStyles.trustSection}`} data-chapter id="trust">
          <header data-reveal><p className={styles.eyebrowDark}>{t.trust.eyebrow}</p><h2>{t.trust.title}</h2><p>{t.trust.lead}</p></header>
          <div className={`${styles.trustGrid} ${editorialStyles.trustGrid}`}>{content.security.items.map((item, index) => <article className={`${motionStyles.trustMotion} ${editorialStyles.trustItem}`} data-primary={index === 0 || undefined} data-reveal key={item.title}><span>{index === 2 ? t.trust.policy : t.trust.verified}</span><ShieldCheck aria-hidden="true" size={22} /><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>
          <div className={styles.trustActions}><Link href={`/${language}/trust`}>{t.trust.cta}<ArrowRight aria-hidden="true" size={17} /></Link><Link href={`/${language}/legal`}>{t.trust.legal}</Link></div>
        </section>

        <section className={`${styles.resourcesSection} ${editorialStyles.resourcesSection}`} id="resources">
          <header data-reveal><p className={styles.eyebrowDark}>{t.resources.eyebrow}</p><h2>{t.resources.title}</h2></header>
          <div className={editorialStyles.resourceGrid}>{t.resources.items.map(([title, meta, body, path], index) => <Link className={`${motionStyles.resourceMotion} ${editorialStyles.resourceItem}`} data-primary={index === 0 || undefined} data-reveal href={`/${language}/${path}`} key={path}><span>0{index + 1}</span><small>{meta}</small><h3>{title}</h3><p>{body}</p>{index === 0 ? <><span className={editorialStyles.playDisc} aria-hidden="true"><Play size={38} fill="currentColor" /></span><div className={editorialStyles.watchSignal}><Play aria-hidden="true" size={15} />{language === "ru" ? "Смотреть обзор" : language === "uz" ? "Sharhni ko‘rish" : "Watch overview"}</div></> : null}<ArrowDownRight aria-hidden="true" size={22} /></Link>)}</div>
        </section>

        <section className={`${styles.accessSection} ${decisionStyles.accessSection}`} id="pricing">
          <header data-reveal><p className={styles.eyebrowLight}>{t.access.eyebrow}</p><h2>{t.access.title}</h2></header>
          <div className={`${styles.accessPlans} ${decisionStyles.accessPlans}`}>{t.access.plans.map(([title, meta, body, cta], index) => <article className={`${motionStyles.planMotion} ${decisionStyles.accessPlan}`} data-featured={index === 1 || undefined} data-reveal key={title}><span>0{index + 1}</span><small>{meta}</small><h3>{title}</h3><p>{body}</p><a href={index === 2 ? "mailto:muzaffarbekmurodoff@gmail.com" : `${register}&intent=${index === 1 ? "business" : "individual"}`}>{cta}<ArrowRight aria-hidden="true" size={16} /></a></article>)}</div>
          <p className={styles.accessNote}>{t.access.note}</p>
        </section>

        <section className={styles.faqSection} id="faq">
          <header data-reveal><p className={styles.eyebrowDark}>FAQ</p><h2>{t.faqTitle}</h2></header>
          <div>{content.faq.items.slice(0, 8).map((item, index) => <details key={item.question}><summary><span>0{index + 1}</span>{item.question}<i aria-hidden="true">+</i></summary><p>{item.answer}</p></details>)}</div>
        </section>

        <section className={`${styles.finalSection} ${motionStyles.finalMotion}`} data-reveal="mask" id="start">
          <div aria-hidden="true" className={styles.finalLine}><i /><i /><i /></div>
          <p className={styles.eyebrowLight}>JURO · {language === "ru" ? "ЮРИСТ В КАРМАНЕ" : language === "uz" ? "CHO‘NTAGINGIZDAGI YURIST" : "LEGAL GUIDANCE IN YOUR POCKET"}</p>
          <h2>{t.finalTitle}</h2><p>{t.finalBody}</p>
          <div><a className={styles.buttonGold} href={register}>{t.finalPrimary}<ArrowRight aria-hidden="true" size={18} /></a><Link className={styles.buttonGhost} href={`/${language}/video`}><Play aria-hidden="true" size={16} />{t.finalSecondary}</Link></div>
        </section>
      </main>
      <SiteFooter locale={language} />
    </div>
  );
}
