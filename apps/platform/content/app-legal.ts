export type AppLegalSlug = "terms" | "privacy" | "cookies" | "ai-rules" | "personal-data";

export type LegalDocument = {
  title: string;
  description: string;
  updated: string;
  sections: Array<{ heading: string; paragraphs: string[] }>;
};

// This is the same pre-incorporation contact published by the public site and
// configured for platform operations. Keep policy content deterministic: an
// environment-dependent value would make acceptance digests unverifiable.
export const APP_LEGAL_OPERATOR_EMAIL = "admin@juro.uz";

const sharedRu = {
  operator: `JURO работает в режиме предварительного запуска до регистрации отдельного оператора. Юридически значимые уведомления принимаются по адресу ${APP_LEGAL_OPERATOR_EMAIL}. Наименование и адрес зарегистрированного оператора будут опубликованы до заключения договоров от его имени.`,
  disclaimer: "JURO не является государственным органом, нотариусом или судом. AI-инструменты не заменяют помощь специалиста там, где она обязательна или разумно необходима.",
};
const sharedUz = {
  operator: `JURO alohida operator ro‘yxatdan o‘tkazilguniga qadar dastlabki ishga tushirish rejimida ishlaydi. Yuridik ahamiyatga ega xabarlar ${APP_LEGAL_OPERATOR_EMAIL} manzilida qabul qilinadi. Ro‘yxatdan o‘tkazilgan operatorning nomi va manzili uning nomidan shartnomalar tuzilishidan oldin e’lon qilinadi.`,
  disclaimer: "JURO davlat organi, notarius yoki sud emas. AI vositalari majburiy yoki oqilona zarur bo‘lgan mutaxassis yordamini almashtirmaydi.",
};
const sharedEn = {
  operator: `JURO is operating in pre-launch mode until a dedicated operator is incorporated. Legally significant notices are accepted at ${APP_LEGAL_OPERATOR_EMAIL}. The registered operator’s name and address will be published before contracts are entered into on its behalf.`,
  disclaimer: "JURO is not a public authority, notary, or court. AI tools do not replace qualified professional assistance where it is required or reasonably necessary.",
};

export const appLegalContent: Record<"ru" | "uz" | "en", Record<AppLegalSlug, LegalDocument>> = {
  ru: {
    terms: {
      title: "Условия использования личного кабинета JURO",
      description: "Правила регистрации, работы с AI, документами, командой и специалистами внутри app.juro.uz.",
      updated: "23 ноября 2026",
      sections: [
        { heading: "1. Область действия", paragraphs: ["Эти условия относятся к закрытому личному кабинету app.juro.uz и дополняют информационные условия публичного сайта. Используя кабинет, пользователь подтверждает дееспособность и право передавать загружаемые материалы.", sharedRu.operator] },
        { heading: "2. Возможности и ограничения", paragraphs: ["JURO помогает структурировать ситуацию, хранить дела, создавать и проверять документы, вести планы и передавать выбранный контекст специалисту. Доступность отдельных функций зависит от тарифа, технических интеграций и применимых ограничений.", sharedRu.disclaimer] },
        { heading: "3. Аккаунт и команда", paragraphs: ["Пользователь отвечает за доступ к своему email и действия в активной сессии. Владелец рабочего пространства управляет ролями участников; серверные проверки ограничивают доступ к данным пространства.", "Запрещается загружать данные или документы без законного основания, вмешиваться в работу сервиса, обходить ограничения и пытаться получить доступ к чужим материалам."] },
        { heading: "4. Платные услуги и прекращение", paragraphs: ["Цена, период, лимиты, дополнительные услуги и условия отмены показываются до подтверждения платежа. Платёж не считается выполненным без подтверждения платёжного провайдера.", "Пользователь может прекратить использование сервиса и запросить удаление аккаунта в настройках приватности. Архивирование документа не является удалением аккаунта или данных."] },
      ],
    },
    privacy: {
      title: "Политика конфиденциальности приложения JURO",
      description: "Как закрытый кабинет обрабатывает аккаунт, документы, юридические ситуации и служебные журналы.",
      updated: "23 ноября 2026",
      sections: [
        { heading: "1. Какие данные обрабатываются", paragraphs: ["JURO обрабатывает данные регистрации, настройки рабочего пространства, введённые пользователем факты, документы, комментарии, планы, согласия, технические журналы и историю действий. Состав данных зависит от используемой функции.", sharedRu.operator] },
        { heading: "2. Цели и доступ", paragraphs: ["Данные используются для предоставления функций кабинета, обеспечения безопасности, исполнения запросов, поддержки, расчёта лимитов и выполнения юридических обязанностей. Участники команды и специалисты видят только тот объём, который разрешён ролью, настройками и отдельным согласием.", "Содержание юридических вопросов и документов не должно передаваться в продуктовую аналитику."] },
        { heading: "3. Провайдеры и передача", paragraphs: ["Для email, AI, хранения файлов, мониторинга и платежей могут использоваться внешние обработчики. До включения конкретного провайдера оператор должен определить договорные основания, территорию обработки, сроки хранения и меры защиты.", "При трансграничной передаче оператор обязан применять предусмотренное применимым правом основание и уведомление."] },
        { heading: "4. Права пользователя", paragraphs: ["В настройках можно получить переносимый экспорт метаданных, посмотреть историю согласий и направить запрос на удаление. Отдельные сведения могут сохраняться в течение обязательного срока или для защиты законных требований.", `Для обращения или жалобы используйте ${APP_LEGAL_OPERATOR_EMAIL}.`] },
      ],
    },
    cookies: {
      title: "Правила cookies приложения JURO",
      description: "Необходимые cookies сессии, языка и пользовательских настроек.",
      updated: "26 июля 2026",
      sections: [
        { heading: "Необходимые cookies", paragraphs: ["Приложение использует защищённую cookie сессии для входа, cookie языка и технические значения, необходимые для безопасности и сохранения настроек. Без них закрытый кабинет может работать некорректно."] },
        { heading: "Аналитика", paragraphs: ["Необязательная аналитика должна включаться только в соответствии с применимыми требованиями и настройками согласия. В события нельзя помещать текст вопроса, содержимое документа, OTP, паспортные или платёжные реквизиты."] },
        { heading: "Управление", paragraphs: ["Пользователь может ограничить cookies через браузер и управлять необязательными категориями в настройках приватности после подключения consent-платформы. Удаление необходимой cookie завершает сессию."] },
      ],
    },
    "ai-rules": {
      title: "Правила использования AI в JURO",
      description: "Границы AI-разбора, источники, проверка и передача специалисту.",
      updated: "26 июля 2026",
      sections: [
        { heading: "1. Роль AI", paragraphs: ["AI помогает собрать факты, выявить неопределённости, подготовить черновик плана или документа. Ответ может быть неполным или ошибочным и не является гарантией результата.", sharedRu.disclaimer] },
        { heading: "2. Источники", paragraphs: ["Правовые объяснения должны ссылаться только на источники из контролируемого серверного реестра с датой проверки. Если подходящий источник не найден, JURO сообщает об этом и не придумывает статью, номер акта или ссылку."] },
        { heading: "3. Данные и проверка", paragraphs: ["Не вводите лишние персональные данные. Перед отправкой материалов внешнему AI-провайдеру оператор должен включить его в политику конфиденциальности и применить минимизацию данных.", "Перед важным решением пользователь должен проверить факты, даты, реквизиты и при необходимости обратиться к квалифицированному специалисту."] },
        { heading: "4. Живой специалист", paragraphs: ["Передача специалисту выполняется отдельно. Пользователь видит, какие материалы передаются, и подтверждает согласие; доступ не распространяется на всё пространство автоматически."] },
      ],
    },
    "personal-data": {
      title: "Уведомление об обработке персональных данных",
      description: "Состав, цели и управление обработкой данных внутри JURO.",
      updated: "23 ноября 2026",
      sections: [
        { heading: "Обработка", paragraphs: ["JURO обрабатывает данные, необходимые для аккаунта, рабочего пространства и выбранных функций. Чувствительные сведения следует вводить только когда это действительно необходимо для юридического сценария.", sharedRu.operator] },
        { heading: "Согласия", paragraphs: ["Согласие на общие правила, анализ документа, передачу специалисту и запись консультации фиксируются отдельно, когда соответствующая операция требует согласия. Согласие можно отозвать на будущее, если иное не следует из закона или уже исполненной операции."] },
        { heading: "Хранение и удаление", paragraphs: ["Сроки хранения должны быть утверждены оператором для каждой категории данных. Запрос на удаление доступен в настройках; архивирование объекта не считается удалением."] },
      ],
    },
  },
  uz: {
    terms: {
      title: "JURO shaxsiy kabinetidan foydalanish shartlari",
      description: "app.juro.uz ichida ro‘yxatdan o‘tish, AI, hujjatlar, jamoa va mutaxassislar bilan ishlash qoidalari.",
      updated: "2026-yil 23-noyabr",
      sections: [
        { heading: "1. Qo‘llanish sohasi", paragraphs: ["Ushbu shartlar app.juro.uz yopiq kabinetiga tegishli va ommaviy sayt axborot shartlarini to‘ldiradi. Kabinetdan foydalangan shaxs yuklanadigan materiallarni berish huquqiga ega ekanini tasdiqlaydi.", sharedUz.operator] },
        { heading: "2. Imkoniyatlar va cheklovlar", paragraphs: ["JURO vaziyatni tuzishga, ishlarni saqlashga, hujjat yaratish va tekshirishga, reja yuritishga hamda tanlangan kontekstni mutaxassisga berishga yordam beradi. Ayrim funksiyalar tarif va texnik integratsiyalarga bog‘liq.", sharedUz.disclaimer] },
        { heading: "3. Hisob va jamoa", paragraphs: ["Foydalanuvchi o‘z emailiga kirish va faol sessiyadagi harakatlar uchun javob beradi. Makon egasi rollarni boshqaradi; server tekshiruvlari ma’lumotlarga kirishni cheklaydi.", "Qonuniy asossiz ma’lumot yuklash, xizmatga xalaqit berish va begona materiallarga kirishga urinish taqiqlanadi."] },
        { heading: "4. To‘lov va foydalanishni tugatish", paragraphs: ["Narx, davr, limitlar va bekor qilish shartlari to‘lovni tasdiqlashdan oldin ko‘rsatiladi. Provayder tasdig‘isiz to‘lov bajarilgan hisoblanmaydi.", "Hisobni o‘chirish so‘rovi maxfiylik sozlamalarida beriladi. Hujjatni arxivlash hisobni o‘chirish emas."] },
      ],
    },
    privacy: {
      title: "JURO ilovasi maxfiylik siyosati",
      description: "Yopiq kabinet hisob, hujjat, yuridik vaziyat va xizmat jurnallarini qanday qayta ishlaydi.",
      updated: "2026-yil 23-noyabr",
      sections: [
        { heading: "1. Qayta ishlanadigan ma’lumotlar", paragraphs: ["JURO ro‘yxatdan o‘tish ma’lumotlari, makon sozlamalari, faktlar, hujjatlar, izohlar, rejalar, roziliklar va harakatlar tarixini qayta ishlaydi.", sharedUz.operator] },
        { heading: "2. Maqsad va kirish", paragraphs: ["Ma’lumotlar kabinet funksiyalari, xavfsizlik, qo‘llab-quvvatlash va majburiyatlarni bajarish uchun ishlatiladi. Jamoa a’zolari va mutaxassislar faqat rol va alohida rozilik doirasidagi ma’lumotni ko‘radi.", "Yuridik savol va hujjat mazmuni mahsulot analitikasiga yuborilmasligi kerak."] },
        { heading: "3. Provayderlar va uzatish", paragraphs: ["Email, AI, fayl saqlash, monitoring va to‘lov uchun tashqi qayta ishlovchilar ishlatilishi mumkin. Har bir provayder uchun asos, hudud, muddat va himoya choralari belgilanadi.", "Transchegaraviy uzatishda amaldagi huquq talablari bajarilishi kerak."] },
        { heading: "4. Foydalanuvchi huquqlari", paragraphs: ["Sozlamalarda metadata eksporti, roziliklar tarixi va o‘chirish so‘rovi mavjud. Ayrim ma’lumotlar majburiy muddat davomida saqlanishi mumkin.", `Murojaat yoki shikoyat uchun ${APP_LEGAL_OPERATOR_EMAIL} manzilidan foydalaning.`] },
      ],
    },
    cookies: {
      title: "JURO ilovasi cookie qoidalari",
      description: "Sessiya, til va foydalanuvchi sozlamalari uchun zarur cookie fayllari.",
      updated: "2026-yil 26-iyul",
      sections: [
        { heading: "Zarur cookies", paragraphs: ["Ilova kirish uchun himoyalangan sessiya cookie-si, til cookie-si va xavfsizlik hamda sozlamalar uchun zarur texnik qiymatlardan foydalanadi."] },
        { heading: "Analitika", paragraphs: ["Ixtiyoriy analitika faqat tegishli talab va rozilikka muvofiq yoqiladi. Savol matni, hujjat mazmuni, OTP, pasport va to‘lov rekvizitlari analitikaga yuborilmaydi."] },
        { heading: "Boshqarish", paragraphs: ["Foydalanuvchi brauzer orqali cookie-larni cheklashi va consent platformasi ulangach ixtiyoriy toifalarni boshqarishi mumkin. Zarur cookie-ni o‘chirish sessiyani tugatadi."] },
      ],
    },
    "ai-rules": {
      title: "JUROda AIdan foydalanish qoidalari",
      description: "AI tahlili, manbalar, tekshirish va mutaxassisga topshirish chegaralari.",
      updated: "2026-yil 26-iyul",
      sections: [
        { heading: "1. AI roli", paragraphs: ["AI faktlarni yig‘ish, noaniqliklarni aniqlash va reja yoki hujjat loyihasini tayyorlashga yordam beradi. Javob xato bo‘lishi mumkin va natijani kafolatlamaydi.", sharedUz.disclaimer] },
        { heading: "2. Manbalar", paragraphs: ["Huquqiy tushuntirishlar faqat tekshirish sanasi bo‘lgan server reestridagi manbalarga tayanadi. Manba topilmasa, JURO modda yoki havolani o‘ylab topmaydi."] },
        { heading: "3. Ma’lumot va tekshirish", paragraphs: ["Ortiqcha shaxsiy ma’lumotlarni kiritmang. Tashqi AI-provayderga uzatishdan oldin u maxfiylik siyosatida ko‘rsatilishi va ma’lumot minimallashtirilishi kerak.", "Muhim qaror oldidan fakt, sana va rekvizitlarni tekshirib, kerak bo‘lsa mutaxassisga murojaat qiling."] },
        { heading: "4. Jonli mutaxassis", paragraphs: ["Mutaxassisga topshirish alohida amalga oshiriladi. Foydalanuvchi beriladigan materiallarni ko‘radi va rozilik beradi; butun makonga avtomatik kirish berilmaydi."] },
      ],
    },
    "personal-data": {
      title: "Shaxsiy ma’lumotlarni qayta ishlash xabarnomasi",
      description: "JURO ichida ma’lumotlar tarkibi, maqsadi va boshqaruvi.",
      updated: "2026-yil 23-noyabr",
      sections: [
        { heading: "Qayta ishlash", paragraphs: ["JURO hisob, makon va tanlangan funksiyalar uchun zarur ma’lumotlarni qayta ishlaydi. Nozik ma’lumotlar faqat yuridik ssenariy uchun zarur bo‘lsa kiritilishi kerak.", sharedUz.operator] },
        { heading: "Roziliklar", paragraphs: ["Umumiy qoidalar, hujjat tahlili, mutaxassisga uzatish va konsultatsiya yozuvi uchun roziliklar zarur holatlarda alohida qayd etiladi."] },
        { heading: "Saqlash va o‘chirish", paragraphs: ["Har bir toifa uchun saqlash muddati operator tomonidan tasdiqlanishi kerak. O‘chirish so‘rovi sozlamalarda mavjud; arxivlash o‘chirish emas."] },
      ],
    },
  },
  en: {
    terms: {
      title: "JURO account Terms of Use",
      description: "Rules for registration and for using AI, documents, teams, and professionals within app.juro.uz.",
      updated: "23 November 2026",
      sections: [
        { heading: "1. Scope", paragraphs: ["These terms apply to the private account area at app.juro.uz and supplement the information terms of the public website. By using the account area, a user confirms that they have legal capacity and the right to provide any uploaded materials.", sharedEn.operator] },
        { heading: "2. Features and limitations", paragraphs: ["JURO helps users structure a matter, store cases, create and review documents, manage action plans, and share selected context with a professional. Availability may depend on the subscription, technical integrations, and applicable restrictions.", sharedEn.disclaimer] },
        { heading: "3. Account and team", paragraphs: ["Users are responsible for access to their email and for actions performed in an active session. A workspace owner manages member roles, while server-side controls restrict access to workspace data.", "Users must not upload data or documents without a lawful basis, interfere with the service, bypass restrictions, or attempt to access another person's materials."] },
        { heading: "4. Paid services and termination", paragraphs: ["The price, billing period, limits, additional services, and cancellation terms are shown before payment is confirmed. A payment is not complete without confirmation from the payment provider.", "A user may stop using the service and request account deletion in privacy settings. Archiving a document does not delete the account or its data."] },
      ],
    },
    privacy: {
      title: "JURO application Privacy Policy",
      description: "How the private account area processes account data, documents, legal matters, and service logs.",
      updated: "23 November 2026",
      sections: [
        { heading: "1. Data we process", paragraphs: ["JURO processes registration data, workspace settings, facts entered by users, documents, comments, plans, consent records, technical logs, and activity history. The exact data depends on the feature being used.", sharedEn.operator] },
        { heading: "2. Purposes and access", paragraphs: ["Data is used to provide account features, maintain security, fulfil requests, provide support, calculate limits, and meet legal obligations. Team members and professionals can see only the information permitted by their role, settings, and any specific consent.", "The content of legal questions and documents must not be sent to product analytics."] },
        { heading: "3. Providers and transfers", paragraphs: ["External processors may be used for email, AI, file storage, monitoring, and payments. Before enabling a provider, the operator must establish the contractual basis, processing location, retention period, and protective measures.", "For a cross-border transfer, the operator must use a basis and notice permitted by applicable law."] },
        { heading: "4. User rights", paragraphs: ["In settings, users can obtain a portable metadata export, review their consent history, and submit a deletion request. Some information may be retained for a mandatory period or to protect legal claims.", `For a request or complaint, contact ${APP_LEGAL_OPERATOR_EMAIL}.`] },
      ],
    },
    cookies: {
      title: "JURO application Cookie Policy",
      description: "Essential cookies for sessions, language, and user preferences.",
      updated: "26 July 2026",
      sections: [
        { heading: "Essential cookies", paragraphs: ["The application uses a protected session cookie for sign-in, a language cookie, and technical values required for security and preference storage. The private account area may not work correctly without them."] },
        { heading: "Analytics", paragraphs: ["Optional analytics must be enabled only in accordance with applicable requirements and consent settings. Events must not contain question text, document content, OTP codes, passport information, or payment details."] },
        { heading: "Controls", paragraphs: ["Users can restrict cookies through their browser and, once a consent platform is connected, manage optional categories in privacy settings. Deleting an essential session cookie signs the user out."] },
      ],
    },
    "ai-rules": {
      title: "Rules for using AI in JURO",
      description: "Boundaries for AI analysis, sources, verification, and hand-off to a professional.",
      updated: "26 July 2026",
      sections: [
        { heading: "1. Role of AI", paragraphs: ["AI can help collect facts, identify uncertainty, and prepare a draft plan or document. Its output may be incomplete or incorrect and does not guarantee an outcome.", sharedEn.disclaimer] },
        { heading: "2. Sources", paragraphs: ["Legal explanations must cite only sources from the controlled server registry and include their verification date. If no suitable source is found, JURO says so and does not invent a legal provision, act number, or link."] },
        { heading: "3. Data and verification", paragraphs: ["Do not enter unnecessary personal data. Before materials are sent to an external AI provider, the operator must identify that provider in the Privacy Policy and apply data minimisation.", "Before making an important decision, users should verify facts, dates, and details and obtain qualified professional advice where appropriate."] },
        { heading: "4. Human professional", paragraphs: ["Hand-off to a professional is a separate action. The user can review the materials to be shared and confirms consent; access is not automatically granted to the entire workspace."] },
      ],
    },
    "personal-data": {
      title: "Personal Data Processing Notice",
      description: "The categories, purposes, and controls for data processing within JURO.",
      updated: "23 November 2026",
      sections: [
        { heading: "Processing", paragraphs: ["JURO processes the data needed for the account, workspace, and selected features. Sensitive information should be provided only when it is genuinely necessary for the legal matter.", sharedEn.operator] },
        { heading: "Consent", paragraphs: ["Consent to general terms, document analysis, hand-off to a professional, and consultation recording is captured separately whenever the relevant operation requires it. Consent may be withdrawn for future processing unless the law or an operation already completed requires otherwise."] },
        { heading: "Retention and deletion", paragraphs: ["The operator must approve a retention period for each data category. A deletion request is available in settings; archiving an item is not deletion."] },
      ],
    },
  },
};
