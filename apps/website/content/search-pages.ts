import { ru } from "./ru";
import { uz } from "./uz";
import { en } from "./en";

export const searchPages = {
  ru: {
    home: ru.meta,
    lawyers: { title: "Юристы и адвокаты в Узбекистане", description: "Найдите юриста в каталоге JURO: специализации, опыт, языки и формат консультации. Сравните публичные профили и выберите специалиста для своей задачи." },
    knowledge: { title: "База знаний: договоры, документы и юридические вопросы", description: "Практические материалы JURO: подготовка к проверке договора, факты для плана действий и выбор юридического специалиста в Узбекистане." },
    trust: { title: "Безопасность, конфиденциальность и работа с данными", description: "Как JURO работает с доступом, документами, хранением, удалением и AI-провайдерами. Проверяемая информация о платформе и её политиках." },
    video: { title: "Как работает JURO: видеопрезентация", description: "Посмотрите, как JURO объединяет AI-юриста, проверку договоров, документы и поиск специалиста для юридических задач в Узбекистане." },
    news: { title: "Новости и обновления JURO", description: "Опубликованные новости JURO: развитие AI-юриста, инструментов для документов и юридической платформы Узбекистана." },
    legal: { title: "Документы и политики JURO", description: "Условия использования, конфиденциальность, персональные данные и правила AI-помощи на платформе JURO." },
  },
  uz: {
    home: uz.meta,
    lawyers: { title: "O‘zbekistonda yurist va advokat topish", description: "JURO katalogida yurist toping: mutaxassislik, tajriba, tillar va maslahat shaklini taqqoslang. Yuridik vazifangiz uchun ochiq profillarni ko‘ring." },
    knowledge: { title: "Bilimlar bazasi: shartnomalar va yuridik hujjatlar", description: "JURO amaliy materiallari: shartnoma tekshiruviga tayyorgarlik, harakat rejasi uchun faktlar va O‘zbekistonda yuridik mutaxassis tanlash." },
    trust: { title: "Xavfsizlik, maxfiylik va ma’lumotlar bilan ishlash", description: "JUROda kirish, hujjatlar, saqlash, o‘chirish va AI-provayderlar bilan ishlash. Platforma va uning siyosatlari haqida tekshiriladigan ma’lumot." },
    video: { title: "JURO qanday ishlaydi: videotaqdimot", description: "JURO O‘zbekistondagi yuridik vazifalar uchun AI-yurist, shartnoma tekshirish, hujjat tayyorlash va mutaxassis topishni qanday birlashtirishini ko‘ring." },
    news: { title: "JURO yangiliklari va yangilanishlari", description: "JURO yangiliklari: O‘zbekistondagi AI-yurist, hujjat vositalari va yuridik platformaning rivojlanishi." },
    legal: { title: "JURO hujjatlari va siyosatlari", description: "JURO platformasidan foydalanish shartlari, maxfiylik, shaxsiy ma’lumotlar va AI-yordam qoidalari." },
  },
  en: {
    home: en.meta,
    lawyers: { title: "Find a Lawyer in Uzbekistan", description: "Browse legal professionals on JURO. Compare public profiles, specialisms, experience, languages and consultation formats for your legal task in Uzbekistan." },
    knowledge: { title: "Legal Guides: Contracts, Documents & Next Steps", description: "Practical JURO guides for Uzbekistan: prepare for contract review, gather facts for an action plan and decide when to consult a legal professional." },
    trust: { title: "Security, Privacy & Data Handling", description: "How JURO handles access, documents, retention, deletion and AI providers. Review verifiable information about the platform and its policies." },
    video: { title: "How JURO Works: Product Video", description: "See how JURO connects AI legal assistance, contract review, document preparation and legal professionals for tasks under Uzbekistan law." },
    news: { title: "JURO News & Product Updates", description: "Published JURO updates about AI legal assistance, document tools and the legal technology platform for Uzbekistan." },
    legal: { title: "JURO Documents & Policies", description: "Terms of use, privacy, personal data and AI assistance policies for the JURO platform." },
  },
} as const;
