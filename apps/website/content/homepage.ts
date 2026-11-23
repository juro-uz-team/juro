import type { PublicLanguage } from "./types";

type ContractExample = {
  id: "lease" | "supplier";
  name: string;
  clause: string;
  original: string;
  revised: [string, string, string];
  finding: string;
};

type ChatExample = {
  id: "pay" | "leave";
  topic: string;
  question: string;
  followUp: string;
  reply: string;
  supported: string;
  next: string;
  article: string;
  sourceTitle: string;
  sourceNote: string;
};

type HomepageCopy = {
  jurisdiction: string;
  headline: [string, string];
  introduction: string;
  start: string;
  example: string;
  fictional: string;
  chat: {
    name: string;
    label: string;
    choose: string;
    ask: string;
    you: string;
    context: string;
    next: string;
    source: string;
    examples: [ChatExample & { id: "pay" }, ChatExample & { id: "leave" }];
  };
  compare: string;
  review: { heading: string; intro: string; original: string; revised: string; why: string; action: string; tools: [string, string] };
  contracts: [ContractExample & { id: "lease" }, ContractExample & { id: "supplier" }];
  plan: { label: string; heading: string; question: string; intro: string; steps: { title: string; detail: string }[]; action: string };
  lawyers: { label: string; heading: string; intro: string; action: string; brief: string; topic: string; question: string; documents: { title: string; detail: string }[] };
  faqTitle: string;
  faqMore: string;
  trust: string;
  closing: string;
  video: string;
  knowledge: string;
  legal: string;
  business: string;
  location: string;
  note: string;
};

export const homepageCopy = {
  ru: {
    jurisdiction: "AI-юрист в Узбекистане",
    headline: ["Есть вопрос", "по закону?"],
    introduction: "Опишите ситуацию своими словами. AI-юрист JURO объяснит, что говорит закон Узбекистана, покажет источники и поможет понять, с чего начать.",
    start: "Начать бесплатно",
    example: "Пример диалога",
    fictional: "Вымышленный пример",
    chat: {
      name: "AI-юрист JURO", label: "Пример диалога", choose: "Выберите вопрос", ask: "Задать свой вопрос", you: "Вы",
      context: "Уточнение", next: "Первый шаг", source: "Открыть на Lex.uz",
      examples: [
        { id: "pay", topic: "Задержка зарплаты", question: "Мне два месяца не платят зарплату. С чего начать?", followUp: "Когда должны были выплатить зарплату?", reply: "Последняя выплата должна была быть 15-го.",
          supported: "Даты выплаты закрепляют в коллективном договоре или локальном акте, а если их нет — в трудовом договоре.",
          next: "Сверьте пропущенные даты с графиком выплат и запишите суммы, которые вам ещё должны.",
          article: "Статья 253", sourceTitle: "Трудовой кодекс Узбекистана · Сроки выплаты зарплаты", sourceNote: "Статья указывает, в каких документах закрепляют сроки выплаты." },
        { id: "leave", topic: "Ежегодный отпуск", question: "Сколько дней ежегодного отпуска мне положено?", followUp: "Вы про минимальную продолжительность основного отпуска?", reply: "Да, хочу узнать минимум.",
          supported: "Ежегодный основной отпуск составляет не менее 21 календарного дня.",
          next: "Проверьте трудовой договор и условия для вашей категории работников. Отпуск может быть длиннее.",
          article: "Статья 217", sourceTitle: "Трудовой кодекс Узбекистана · Минимальный отпуск", sourceNote: "Статья устанавливает минимальную продолжительность ежегодного основного отпуска." },
      ],
    },
    compare: "Сравнить формулировки",
    review: {
      heading: "Проверка договора",
      intro: "JURO показывает спорную формулировку, объясняет, что стоит уточнить, и предлагает редакцию для обсуждения.",
      original: "В договоре", revised: "Предлагаемая редакция", why: "Что стоит уточнить", action: "Проверить свой договор",
      tools: ["Создать документ", "Сравнить договоры"],
    },
    contracts: [
      { id: "lease", name: "Договор аренды", clause: "Возврат депозита", original: "Депозит возвращается после освобождения квартиры.", revised: ["Депозит возвращается ", "в течение [согласованного срока] после передачи ключей", ". Если часть суммы удерживается, арендодатель письменно указывает основания и прилагает подтверждающие документы."], finding: "В пункте не указано, когда именно вернут депозит и как объяснят удержания." },
      { id: "supplier", name: "Договор поставки", clause: "Срок поставки", original: "Поставщик отгружает товар в разумный срок после оплаты.", revised: ["Поставщик ", "доставляет товар не позднее даты, указанной в подтверждённом заказе", ". При риске задержки поставщик письменно сообщает причину и новую дату доставки."], finding: "«Разумный срок» не привязан к дате, а отгрузка и получение товара могут произойти в разные дни." },
    ],
    plan: {
      label: "План действий", heading: "Что делать дальше",
      question: "Я вернул ключи, а депозит ещё не пришёл. С чего начать?",
      intro: "Опишите ситуацию. JURO поможет собрать важные факты и превратить их в шаги с понятной последовательностью.",
      steps: [
        { title: "Сверьте условия", detail: "Найдите пункт о депозите и зафиксируйте дату передачи ключей." },
        { title: "Соберите подтверждения", detail: "Сохраните договор, квитанцию об оплате и переписку о возврате." },
        { title: "Напишите арендодателю", detail: "Попросите подтвердить дату возврата и объяснить возможные удержания." },
      ],
      action: "Составить план действий",
    },
    lawyers: {
      label: "Консультация", heading: "Помощь юриста",
      intro: "В каталоге можно сравнить специализации и выбрать, к кому обратиться. Возьмите с собой ключевые даты и документы, чтобы начать с главного.",
      action: "Открыть каталог юристов", brief: "Что взять на консультацию", topic: "Возврат депозита по аренде",
      question: "Ключи переданы. Какие варианты есть, если депозит не вернули?",
      documents: [
        { title: "Договор аренды", detail: "Отметьте пункт о возврате депозита и возможных удержаниях." },
        { title: "Квитанция об оплате", detail: "Подготовьте подтверждение суммы и даты внесения депозита." },
        { title: "Переписка", detail: "Найдите сообщения о передаче ключей и возврате денег." },
      ],
    },
    faqTitle: "Перед началом", faqMore: "Все вопросы", trust: "Как JURO работает с данными",
    closing: "Начните со своего вопроса.", video: "Видео о JURO", knowledge: "База знаний", legal: "Правовые документы", business: "Для бизнеса", location: "Ташкент, Узбекистан",
    note: "AI может ошибаться. За индивидуальной правовой консультацией обращайтесь к юристу.",
  },
  uz: {
    jurisdiction: "O‘zbekistonda AI-yurist",
    headline: ["Huquqiy", "savolingiz bormi?"],
    introduction: "Savolingizni o‘z so‘zingiz bilan yozing. JURO AI-yuristi O‘zbekiston qonunchiligini manbalar bilan tushuntiradi va birinchi qadamni ko‘rsatadi.",
    start: "Bepul boshlash",
    example: "Suhbatni ko‘rish",
    fictional: "To‘qima misol",
    chat: {
      name: "JURO AI-yuristi", label: "Suhbat namunasi", choose: "Savolni tanlang", ask: "Savolingizni bering", you: "Siz",
      context: "Aniqlik kiritish", next: "Birinchi qadam", source: "Lex.uz saytida ochish",
      examples: [
        { id: "pay", topic: "Ish haqi kechikishi", question: "Ikki oydan beri menga ish haqi to‘lashmayapti. Nimadan boshlay?", followUp: "Ish haqingiz qachon to‘lanishi kerak edi?", reply: "Oxirgi to‘lov oyning 15-kunida bo‘lishi kerak edi.",
          supported: "To‘lov sanalari jamoa shartnomasi yoki ichki hujjatda, ular bo‘lmasa, mehnat shartnomasida belgilanadi.",
          next: "To‘lov jadvalidan o‘tib ketgan sanalarni tekshiring va hali to‘lanmagan summalarni yozib qo‘ying.",
          article: "253-modda", sourceTitle: "O‘zbekiston Mehnat kodeksi · Ish haqini to‘lash muddatlari", sourceNote: "Modda to‘lov muddatlari qaysi hujjatlarda belgilanishini ko‘rsatadi." },
        { id: "leave", topic: "Yillik ta’til", question: "Menga necha kun yillik ta’til berilishi kerak?", followUp: "Asosiy ta’tilning eng kam davomiyligini so‘rayapsizmi?", reply: "Ha, eng kam muddatni bilmoqchiman.",
          supported: "Har yilgi asosiy mehnat ta’tili kamida 21 kalendar kun davom etadi.",
          next: "Mehnat shartnomangizni va toifangiz uchun belgilangan shartlarni tekshiring. Ta’til muddati uzunroq bo‘lishi mumkin.",
          article: "217-modda", sourceTitle: "O‘zbekiston Mehnat kodeksi · Eng kam ta’til", sourceNote: "Modda har yilgi asosiy mehnat ta’tilining eng kam davomiyligini belgilaydi." },
      ],
    },
    compare: "Matnlarni taqqoslash",
    review: {
      heading: "Shartnomani tekshirish",
      intro: "JURO noaniq bandni ko‘rsatadi, nimani aniqlashtirish kerakligini tushuntiradi va muhokama uchun yangi matn taklif qiladi.",
      original: "Shartnomadagi matn", revised: "Taklif etilgan matn", why: "Nimani aniqlashtirish kerak", action: "Shartnomamni tekshirish",
      tools: ["Hujjat tayyorlash", "Shartnomalarni taqqoslash"],
    },
    contracts: [
      { id: "lease", name: "Ijara shartnomasi", clause: "Depozitni qaytarish", original: "Depozit kvartira bo‘shatilganidan keyin qaytariladi.", revised: ["Depozit ", "kalitlar topshirilganidan keyin [kelishilgan muddat] ichida", " qaytariladi. Agar summaning bir qismi ushlab qolinsa, ijaraga beruvchi sababini yozma ravishda ko‘rsatadi va tasdiqlovchi hujjatlarni ilova qiladi."], finding: "Bandda depozitning aniq qaytarish muddati va ushlab qolingan summa qanday asoslanishi ko‘rsatilmagan." },
      { id: "supplier", name: "Yetkazib berish shartnomasi", clause: "Yetkazib berish muddati", original: "Yetkazib beruvchi to‘lovdan so‘ng tovarni oqilona muddatda jo‘natadi.", revised: ["Yetkazib beruvchi tovarni ", "tasdiqlangan buyurtmada ko‘rsatilgan sanadan kechiktirmay yetkazadi", ". Kechikish xavfi tug‘ilsa, uning sababi va yangi yetkazib berish sanasini yozma ravishda bildiradi."], finding: "«Oqilona muddat» aniq sanaga bog‘lanmagan. Tovarni jo‘natish va qabul qilish turli kunlarda bo‘lishi mumkin." },
    ],
    plan: {
      label: "Harakatlar rejasi", heading: "Keyingi qadamlar",
      question: "Kalitlarni topshirdim, depozit hali qaytmadi. Nimadan boshlay?",
      intro: "Vaziyatni tasvirlab bering. JURO muhim faktlarni yig‘ish va qadamlarni ketma-ket tartibga solishga yordam beradi.",
      steps: [
        { title: "Shartlarni tekshiring", detail: "Depozit haqidagi bandni toping va kalitlarni topshirgan sanangizni yozib qo‘ying." },
        { title: "Tasdiqlovchi hujjatlarni yig‘ing", detail: "Shartnoma, to‘lov kvitansiyasi va depozit haqidagi yozishmalarni saqlang." },
        { title: "Ijaraga beruvchiga yozing", detail: "Qaytarish sanasini tasdiqlashini va ushlab qolinishi mumkin bo‘lgan summani izohlashini so‘rang." },
      ],
      action: "Harakatlar rejasini tuzish",
    },
    lawyers: {
      label: "Maslahat", heading: "Yurist yordami",
      intro: "Katalogdagi mutaxassisliklarni taqqoslab, kimga murojaat qilishni tanlang. Suhbatni asosiy masaladan boshlash uchun muhim sanalar va hujjatlarni tayyorlab qo‘ying.",
      action: "Yuristlar katalogini ochish", brief: "Maslahat uchun nimalarni tayyorlash kerak", topic: "Ijara depozitini qaytarish",
      question: "Kalitlarni topshirdim. Depozit qaytarilmasa, qanday yo‘l tutishim mumkin?",
      documents: [
        { title: "Ijara shartnomasi", detail: "Depozitni qaytarish va ushlab qolish haqidagi bandni belgilang." },
        { title: "To‘lov kvitansiyasi", detail: "Depozit summasi va to‘langan sanani tasdiqlovchi hujjatni tayyorlang." },
        { title: "Yozishmalar", detail: "Kalitlarni topshirish va pulni qaytarish haqidagi xabarlarni toping." },
      ],
    },
    faqTitle: "Boshlashdan oldin", faqMore: "Barcha savollar", trust: "JURO ma’lumotlar bilan qanday ishlaydi",
    closing: "O‘z savolingizdan boshlang.", video: "JURO haqida video", knowledge: "Bilimlar bazasi", legal: "Huquqiy hujjatlar", business: "Biznes uchun", location: "Toshkent, O‘zbekiston",
    note: "AI xato qilishi mumkin. Shaxsiy yuridik maslahat uchun yuristga murojaat qiling.",
  },
  en: {
    jurisdiction: "AI legal help in Uzbekistan",
    headline: ["Have a legal", "question?"],
    introduction: "Describe what happened in your own words. JURO AI explains what Uzbekistan’s law says, shows you the sources, and helps you work out where to start.",
    start: "Start for free",
    example: "See an example",
    fictional: "Fictional example",
    chat: {
      name: "JURO AI Lawyer", label: "Sample conversation", choose: "Choose a question", ask: "Ask your question", you: "You",
      context: "One follow-up", next: "First step", source: "Open on Lex.uz",
      examples: [
        { id: "pay", topic: "Late pay", question: "My employer hasn’t paid me for two months. Where do I start?", followUp: "When was your pay due?", reply: "My last payday should have been the 15th.",
          supported: "Pay dates are set by the collective agreement or workplace rules. If neither exists, check your employment contract.",
          next: "Check the pay schedule, then list each missed date and the amount still owed.",
          article: "Article 253", sourceTitle: "Uzbekistan Labour Code · Pay dates", sourceNote: "This article sets out which documents determine when wages are due." },
        { id: "leave", topic: "Annual leave", question: "How many days of annual leave am I entitled to?", followUp: "Are you asking about the minimum for regular annual leave?", reply: "Yes, I’d like to know the minimum.",
          supported: "The minimum for basic annual leave is 21 calendar days.",
          next: "Check your contract and the rules for your category of work. You may be entitled to longer leave.",
          article: "Article 217", sourceTitle: "Uzbekistan Labour Code · Minimum annual leave", sourceNote: "This article sets the minimum length of basic annual leave." },
      ],
    },
    compare: "Compare the wording",
    review: {
      heading: "Review a contract",
      intro: "JURO points to the wording that needs attention, explains why it matters, and suggests a revision you can discuss.",
      original: "Original wording", revised: "Suggested wording", why: "What to clarify", action: "Review my contract",
      tools: ["Create a document", "Compare contracts"],
    },
    contracts: [
      { id: "lease", name: "Rental agreement", clause: "Returning the deposit", original: "The deposit will be returned after the tenant vacates the apartment.", revised: ["The deposit will be returned ", "within [the agreed period] after the keys are handed back", ". If the landlord keeps part of it, they’ll give written reasons and provide supporting documents."], finding: "The clause leaves the return date and the reasons for any deductions open." },
      { id: "supplier", name: "Supplier agreement", clause: "Delivery deadline", original: "The supplier will dispatch the goods within a reasonable time after payment.", revised: ["The supplier will ", "deliver the goods by the date in the confirmed order", ". If a delay is likely, the supplier will give written notice with the reason and a revised delivery date."], finding: "“A reasonable time” gives neither side a date to plan around. Dispatch and receipt can happen on different days." },
    ],
    plan: {
      label: "Action plan", heading: "Know what to do next",
      question: "I handed back the keys and my deposit hasn’t arrived. Where do I start?",
      intro: "Describe what happened. JURO helps you gather the facts and work out which steps to take first.",
      steps: [
        { title: "Check the terms", detail: "Find the deposit clause and write down the date you handed back the keys." },
        { title: "Gather the evidence", detail: "Keep the agreement, proof of payment, and messages about the deposit." },
        { title: "Contact the landlord", detail: "Ask them to confirm a return date and explain any deductions." },
      ],
      action: "Make an action plan",
    },
    lawyers: {
      label: "Consultation", heading: "Talk to a lawyer",
      intro: "Compare specialties in the directory and choose whom to contact. Bring the key dates and documents so you can start with the issue that matters.",
      action: "Browse the lawyer directory", brief: "What to bring to a consultation", topic: "Rental deposit return",
      question: "I’ve handed back the keys. What can I do if the deposit hasn’t been returned?",
      documents: [
        { title: "Rental agreement", detail: "Mark the terms covering deposit returns and deductions." },
        { title: "Payment receipt", detail: "Bring proof of how much you paid and when." },
        { title: "Messages", detail: "Find the messages about handing back the keys and returning the deposit." },
      ],
    },
    faqTitle: "Before you begin", faqMore: "All questions", trust: "How JURO handles your data",
    closing: "Start with your question.", video: "Watch the JURO overview", knowledge: "Knowledge base", legal: "Legal documents", business: "For business", location: "Tashkent, Uzbekistan",
    note: "AI can make mistakes. For individual legal advice, speak to a qualified lawyer.",
  },
} satisfies Record<PublicLanguage, HomepageCopy>;
