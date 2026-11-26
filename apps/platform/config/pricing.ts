type Localized = Record<"ru" | "uz" | "en", string>;

export type PricingPlanCode = "free" | "starter" | "advanced" | "company" | "lawyer";

export type PlanLimits = {
  answers: number;
  drafts: number;
  pages: number;
  pagesPerRun: number;
  activeCases: number;
  storageBytes: number;
  fileBytes: number;
};

type Plan = {
  code: PricingPlanCode;
  version: 1;
  name: Localized;
  audience: Localized;
  benefit: Localized;
  priceMinor: number;
  limits: PlanLimits;
};

function plan(
  code: PricingPlanCode,
  name: Localized,
  audience: Localized,
  benefit: Localized,
  price: number,
  limits: Omit<PlanLimits, "fileBytes">,
): Plan {
  return {
    code, version: 1, name, audience, benefit,
    priceMinor: price * 100,
    limits: { ...limits, fileBytes: code === "free" ? 5_000_000 : 25_000_000 },
  };
}

const personal = { ru: "Личное пространство", uz: "Shaxsiy makon", en: "Personal workspace" };

export const subscriptionPlans = [
  plan("free", { ru: "Бесплатный", uz: "Bepul", en: "Free" }, personal,
    { ru: "Первые вопросы, шаблоны и краткий обзор документа", uz: "Dastlabki savollar, andozalar va qisqa hujjat sharhi", en: "First questions, templates and a quick document overview" },
    0, { answers: 20, drafts: 1, pages: 5, pagesPerRun: 5, activeCases: 1, storageBytes: 100_000_000 }),
  plan("starter", { ru: "Стартовый", uz: "Boshlang‘ich", en: "Starter" }, personal,
    { ru: "Полная библиотека шаблонов и базовый анализ", uz: "To‘liq andozalar kutubxonasi va asosiy tahlil", en: "Full template library and basic document analysis" },
    49_900, { answers: 100, drafts: 5, pages: 50, pagesPerRun: 10, activeCases: 5, storageBytes: 1_000_000_000 }),
  plan("advanced", { ru: "Продвинутый", uz: "Kengaytirilgan", en: "Advanced" }, personal,
    { ru: "Подробный анализ и сравнение документов", uz: "Batafsil tahlil va hujjatlarni taqqoslash", en: "Detailed analysis and document comparison" },
    79_900, { answers: 300, drafts: 15, pages: 150, pagesPerRun: 30, activeCases: 20, storageBytes: 5_000_000_000 }),
  plan("company", { ru: "Для компаний", uz: "Kompaniyalar uchun", en: "Company" },
    { ru: "Одна компания · участники без ограничений", uz: "Bitta kompaniya · a’zolar soni cheklanmagan", en: "One company · unlimited members" },
    { ru: "Управление командой и общие лимиты", uz: "Jamoa boshqaruvi va umumiy limitlar", en: "Team management and shared allowances" },
    150_000, { answers: 500, drafts: 20, pages: 200, pagesPerRun: 40, activeCases: 50, storageBytes: 15_000_000_000 }),
  plan("lawyer", { ru: "Для юристов", uz: "Yuristlar uchun", en: "Lawyer" },
    { ru: "Один практикующий юрист", uz: "Bitta amaliyotchi yurist", en: "One legal practitioner" },
    { ru: "Клиенты, дела и учёт работы", uz: "Mijozlar, ishlar va ish vaqti hisobi", en: "Clients, matters and time tracking" },
    55_000, { answers: 150, drafts: 10, pages: 100, pagesPerRun: 30, activeCases: 50, storageBytes: 10_000_000_000 }),
] as const;

export const subscriptionExtras = {
  answers: { units: 100, priceMinor: 1_500_000 },
  drafts: { units: 5, priceMinor: 2_000_000 },
  pages: { units: 50, priceMinor: 1_500_000 },
  handoff: { units: 1, priceMinor: 1_000_000 },
} as const;

export const pricingConfig = {
  currency: "UZS",
  plans: subscriptionPlans,
  extras: subscriptionExtras,
  checkoutAvailable: false,
} as const;
