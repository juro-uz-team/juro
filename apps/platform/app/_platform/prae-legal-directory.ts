import type { PlatformLocale } from "../../lib/platform/routing";
import type { LawyerDirectoryProfile } from "./lawyer-directory-entry";

type Localized = readonly [russian: string, uzbek: string, english: string];

const city = ["Ташкент", "Toshkent", "Tashkent"] satisfies Localized;
const languages = {
  uz: ["Узбекский", "O‘zbek tili", "Uzbek"],
  ru: ["Русский", "Rus tili", "Russian"],
  en: ["Английский", "Ingliz tili", "English"],
  fr: ["Французский", "Fransuz tili", "French"],
} satisfies Record<string, Localized>;

const areas = {
  arbitration: ["Международный арбитраж", "Xalqaro arbitraj", "International arbitration"],
  banking: ["Банковское право и финансирование", "Bank huquqi va moliyalashtirish", "Banking law and finance"],
  bankruptcy: ["Банкротство", "Bankrotlik", "Insolvency"],
  compliance: ["Комплаенс", "Komplayens", "Compliance"],
  construction: ["Строительство и недвижимость", "Qurilish va ko‘chmas mulk", "Construction and real estate"],
  contracts: ["Договорное право", "Shartnoma huquqi", "Contract law"],
  corporate: ["Корпоративное право", "Korporativ huquq", "Corporate law"],
  digitalAssets: ["Цифровые активы", "Raqamli aktivlar", "Digital assets"],
  employment: ["Трудовое право", "Mehnat huquqi", "Employment law"],
  intellectualProperty: ["Интеллектуальная собственность", "Intellektual mulk", "Intellectual property"],
  litigation: ["Судебные споры", "Sud nizolari", "Litigation"],
  mining: ["Добыча полезных ископаемых и природные ресурсы", "Konchilik va tabiiy resurslar", "Mining and natural resources"],
  procurement: ["Государственные закупки", "Davlat xaridlari", "Public procurement"],
  trade: ["Международная торговля", "Xalqaro savdo", "International trade"],
} satisfies Record<string, Localized>;

// Names and portraits follow the firm's team roster. Practice areas and summaries come from the linked bios.
const profiles: {
  slug: string;
  name: readonly [russian: string, latin: string];
  role: Localized;
  areas: (keyof typeof areas)[];
  about: Localized;
  languages?: (keyof typeof languages)[];
  experience?: Localized;
  education?: Localized;
}[] = [
  {
    slug: "shakhnoza-kodirova",
    name: ["Шахноза Кодирова", "Shakhnoza Kodirova"],
    role: ["Старший юридический советник, адвокат", "Katta yuridik maslahatchi, advokat", "Senior counsel, attorney"],
    experience: ["Более 9 лет", "9 yildan ortiq", "Over 9 years"],
    areas: ["corporate", "trade", "procurement"],
    about: ["Сопровождает сделки M&A и корпоративные реорганизации. Работает над инвестиционными проектами и государственно-частными партнёрствами.",
      "Qo‘shilish va sotib olish bitimlari hamda korporativ qayta tashkil etish jarayonlariga hamrohlik qiladi. Investitsiya va davlat-xususiy sheriklik loyihalarida ishlaydi.",
      "Works on mergers and acquisitions, corporate reorganizations, investment projects and public-private partnerships."],
  },
  {
    slug: "mushtariy-aripova",
    name: ["Муштарий Арипова", "Mushtariy Aripova"],
    role: ["Старший юрист", "Katta yurist", "Senior associate"],
    experience: ["Более 10 лет", "10 yildan ortiq", "Over 10 years"],
    languages: ["fr"],
    areas: ["mining", "arbitration"],
    about: ["Работает с вопросами регулирования, сделками и спорами в горнодобывающей и энергетической отраслях. Имеет опыт коммерческого и инвестиционного арбитража.",
      "Konchilik va energetika sohalaridagi tartibga solish, bitim va nizolar bo‘yicha ishlaydi. Tijorat va investitsiya arbitrajida tajribaga ega.",
      "Works on regulation, transactions and disputes in mining and energy, with experience in commercial and investment arbitration."],
  },
  {
    slug: "jahongir-ismatov",
    name: ["Джахонгир Исматов", "Jahongir Ismatov"],
    role: ["Старший юрист, руководитель отдела LPO", "Katta yurist, LPO bo‘limi rahbari", "Senior associate, head of LPO"],
    experience: ["Более 5 лет", "5 yildan ortiq", "Over 5 years"],
    areas: ["trade", "employment", "compliance"],
    about: ["Составляет договоры и сопровождает трансграничные сделки. Работает с вопросами аутсорсинга, налогообложения и таможенного регулирования.",
      "Shartnomalar tuzadi va transchegaraviy bitimlarga hamrohlik qiladi. Autsorsing, soliq va bojxona masalalari bo‘yicha ishlaydi.",
      "Drafts contracts and supports cross-border transactions, including outsourcing, tax and customs matters."],
  },
  {
    slug: "asrorbek-turgunbaev",
    name: ["Асрорбек Тургунбаев", "Asrorbek Turgunbaev"],
    role: ["Старший юрист, руководитель судебного отдела", "Katta yurist, sud ishlari bo‘limi rahbari", "Senior lawyer, head of litigation"],
    areas: ["litigation", "intellectualProperty"],
    about: ["Руководит судебной практикой и представляет клиентов в спорах. Работает с регистрацией и защитой товарных знаков, патентов и авторских прав.",
      "Sud amaliyotiga rahbarlik qiladi va nizolarda mijozlar manfaatini himoya qiladi. Tovar belgilari, patentlar va mualliflik huquqi bo‘yicha ishlaydi.",
      "Leads the litigation practice and represents clients in disputes. His intellectual property work includes trademarks, patents and copyright."],
  },
  {
    slug: "oybek-usmonbekov",
    name: ["Ойбек Усмонбеков", "Oybek Usmonbekov"],
    role: ["Юрист", "Yurist", "Associate"],
    areas: ["digitalAssets", "compliance"],
    about: ["Сопровождает лицензирование, инвестиционные сделки и запуск проектов в сфере цифровых активов.",
      "Raqamli aktivlar sohasida litsenziyalash, investitsiya bitimlari va loyihalarni ishga tushirishda yuridik yordam ko‘rsatadi.",
      "Supports licensing, investment transactions and project launches in the digital assets sector."],
  },
  {
    slug: "diyora-muminova",
    name: ["Диёра Муминова", "Diyora Muminova"],
    role: ["Юрист, руководитель отдела ILO", "Yurist, ILO bo‘limi rahbari", "Associate, head of ILO"],
    education: ["Университет Сорбонна", "Sorbonna universiteti", "Sorbonne University"],
    areas: ["trade", "contracts", "procurement"],
    about: ["Сопровождает внешнеторговые контракты. Работает с торговым и валютным регулированием и государственными закупками.",
      "Tashqi savdo shartnomalariga hamrohlik qiladi. Savdo va valyutani tartibga solish hamda davlat xaridlari bo‘yicha ishlaydi.",
      "Works on international trade contracts, trade and currency regulation, and public procurement."],
  },
  {
    slug: "nazokat-kamilova",
    name: ["Назокат Камилова", "Nazokat Kamilova"],
    role: ["Юрист", "Yurist", "Associate"],
    areas: ["construction", "contracts", "arbitration"],
    about: ["Работает с договорами EPC и EPCM, проводит правовую проверку в строительных проектах и сделках с недвижимостью, участвует в арбитражных делах.",
      "EPC va EPCM shartnomalari bilan ishlaydi, qurilish va ko‘chmas mulk loyihalarini huquqiy tekshiradi hamda arbitraj ishlarida qatnashadi.",
      "Works on EPC and EPCM contracts and due diligence for construction and real estate projects, and assists with arbitration proceedings."],
  },
  {
    slug: "navruza-yunusova",
    name: ["Навруза Юнусова", "Navruza Yunusova"],
    role: ["Юрист практики международного арбитража", "Xalqaro arbitraj amaliyoti yuristi", "International arbitration associate"],
    languages: ["uz", "ru", "en"],
    education: ["Уппсальский университет, LL.M.", "Uppsala universiteti, LL.M.", "Uppsala University, LL.M."],
    areas: ["arbitration"],
    about: ["Работает над трансграничными спорами по регламентам UNCITRAL, LCIA, SCC и TIAC. Готовит процессуальные документы и проводит правовой анализ.",
      "UNCITRAL, LCIA, SCC va TIAC qoidalari bo‘yicha transchegaraviy nizolarda ishlaydi. Protsessual hujjatlar tayyorlaydi va huquqiy tahlil o‘tkazadi.",
      "Works on cross-border disputes under UNCITRAL, LCIA, SCC and TIAC rules, including written submissions and legal research."],
  },
  {
    slug: "zukhra-abdurashidova",
    name: ["Зухра Абдурашидова", "Zukhra Abdurashidova"],
    role: ["Младший юрист отдела LPO", "LPO bo‘limi kichik yuristi", "Junior associate, LPO"],
    areas: ["employment", "corporate", "contracts", "compliance"],
    about: ["Помогает компаниям с текущими юридическими задачами, включая трудовые отношения, договоры и соблюдение правовых требований.",
      "Kompaniyalarga mehnat munosabatlari, shartnomalar va qonunchilik talablariga rioya etish bo‘yicha kundalik yuridik yordam ko‘rsatadi.",
      "Supports businesses with day-to-day legal matters, including employment, contracts and regulatory compliance."],
  },
  {
    slug: "kamaliddin-bakhavadinov",
    name: ["Камалиддин Бахавадинов", "Kamaliddin Bakhavadinov"],
    role: ["Адвокат отдела по спорам", "Nizolar bo‘limi advokati", "Attorney, dispute resolution"],
    experience: ["С 2020 года", "2020-yildan beri", "Since 2020"],
    areas: ["litigation"],
    about: ["Ведёт гражданские, экономические и административные дела. Работает с коммерческими спорами и защитой имущественных прав.",
      "Fuqarolik, iqtisodiy va ma’muriy ishlarni yuritadi. Tijorat nizolari va mulkiy huquqlarni himoya qilish bo‘yicha ishlaydi.",
      "Handles civil, commercial and administrative litigation, including business disputes and property rights matters."],
  },
  {
    slug: "boburbek-makhsudov",
    name: ["Бобурбек Махсудов", "Boburbek Makhsudov"],
    role: ["Младший юрист отдела LPO", "LPO bo‘limi kichik yuristi", "Junior associate, LPO"],
    languages: ["uz", "ru", "en"],
    areas: ["corporate", "contracts"],
    about: ["Готовит и анализирует юридические документы, участвует в проектах по слияниям и поглощениям и лицензированию.",
      "Yuridik hujjatlarni tayyorlaydi va tahlil qiladi, qo‘shilish va sotib olish hamda litsenziyalash loyihalarida qatnashadi.",
      "Drafts and reviews legal documents and supports mergers and acquisitions and licensing projects."],
  },
  {
    slug: "alisher-turdiboev",
    name: ["Алишер Турдибоев", "Alisher Turdiboev"],
    role: ["Младший юрист отдела по спорам", "Nizolar bo‘limi kichik yuristi", "Junior associate, dispute resolution"],
    areas: ["litigation", "bankruptcy", "contracts"],
    about: ["Сопровождает гражданские и экономические споры. Готовит процессуальные документы по вопросам взыскания задолженности, банкротства и корпоративных споров.",
      "Fuqarolik va iqtisodiy nizolarga hamrohlik qiladi. Qarzdorlikni undirish, bankrotlik va korporativ nizolar bo‘yicha protsessual hujjatlar tayyorlaydi.",
      "Assists with civil and commercial disputes and drafts filings for debt recovery, insolvency and corporate disputes."],
  },
  {
    slug: "humoyun-kuldoshev",
    name: ["Хумоюн Кулдошов", "Humoyun Kuldoshev"],
    role: ["Младший юрист отдела по спорам", "Nizolar bo‘limi kichik yuristi", "Junior associate, dispute resolution"],
    areas: ["litigation"],
    about: ["Анализирует материалы уголовных и административных дел, готовит процессуальные документы и участвует в выработке правовой позиции.",
      "Jinoyat va ma’muriy ishlar materiallarini tahlil qiladi, protsessual hujjatlar tayyorlaydi va huquqiy pozitsiyani shakllantirishda qatnashadi.",
      "Reviews case materials, drafts procedural documents and helps develop legal arguments in criminal and administrative proceedings."],
  },
  {
    slug: "muhammadali-raxmonov",
    name: ["Мухаммадали Рахмонов", "Muhammadali Raxmonov"],
    role: ["Младший юрист", "Kichik yurist", "Junior associate"],
    areas: ["corporate", "banking"],
    about: ["Участвует в структурировании сделок финансирования, анализе регуляторных требований и сопровождении инвестиционных проектов.",
      "Moliyalashtirish bitimlarini tuzish, tartibga solish talablarini tahlil qilish va investitsiya loyihalariga hamrohlik qilishda qatnashadi.",
      "Helps structure financing transactions, reviews regulatory requirements and supports investment projects."],
  },
  {
    slug: "zilola-turabova",
    name: ["Зилола Турабова", "Zilola Turabova"],
    role: ["Младший юрист", "Kichik yurist", "Junior associate"],
    areas: ["corporate", "compliance"],
    about: ["Сопровождает корпоративную работу и инвестиционные проекты, анализирует юридические документы и регуляторные риски.",
      "Korporativ ishlar va investitsiya loyihalariga hamrohlik qiladi, yuridik hujjatlar va tartibga solish bilan bog‘liq xavflarni tahlil qiladi.",
      "Supports corporate matters and investment projects and reviews legal documents and regulatory risks."],
  },
  {
    slug: "nagiyev-tengiz",
    name: ["Нагиев Тенгиз", "Nagiyev Tengiz"],
    role: ["Младший юрист", "Kichik yurist", "Junior associate"],
    areas: ["bankruptcy", "contracts", "litigation"],
    about: ["Работает с договорами, банкротством и взысканием задолженности. Готовит внутренние нормативные документы.",
      "Shartnomalar, bankrotlik va qarzdorlikni undirish masalalari bilan ishlaydi. Ichki me’yoriy hujjatlar tayyorlaydi.",
      "Works on contracts, insolvency and debt recovery, and drafts internal policies and regulations."],
  },
];

const localeIndex = { ru: 0, uz: 1, en: 2 } as const;

export function praeLegalDirectoryProfiles(locale: PlatformLocale): LawyerDirectoryProfile[] {
  const index = localeIndex[locale];
  return profiles.map((profile) => ({
    id: `praelegal-${profile.slug}`,
    displayName: profile.name[locale === "ru" ? 0 : 1],
    firmName: "PraeLegal Uzbekistan",
    role: profile.role[index],
    specialties: profile.areas.map((area) => areas[area][index]),
    languages: profile.languages?.map((language) => languages[language][index]) ?? [],
    city: city[index],
    region: null,
    experienceYears: null,
    experienceLabel: profile.experience?.[index],
    education: profile.education?.[index] ?? null,
    bio: profile.about[index],
    profilePhotoUrl: `/lawyer-directory/praelegal/${profile.slug}.webp`,
    readOnly: true,
    canReceiveRequests: false,
    availabilityStatus: "unavailable",
    priceDescription: null,
    consultationDurationMinutes: null,
    consultationFormats: [],
    nextAvailableAt: null,
    additionalServices: [],
    advocateStatus: "not_declared",
    juroApproved: false,
    topLawyer: false,
    topLawyerCriteria: null,
    rating: { reviewCount: 0, overallAverage: null },
    reviews: [],
  }));
}
