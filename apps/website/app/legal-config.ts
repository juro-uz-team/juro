export type LegalMode = "PRE_INCORPORATION_PREVIEW" | "INCORPORATED";

export const legalConfig = {
  mode: "PRE_INCORPORATION_PREVIEW" as LegalMode,
  domains: {
    public: process.env.NEXT_PUBLIC_WEBSITE_ORIGIN ?? "http://localhost:3001",
    app: process.env.NEXT_PUBLIC_PLATFORM_ORIGIN ?? "http://localhost:3000",
  },
  contacts: {
    privacyEmail: "muzaffarbekmurodoff@gmail.com",
    legalEmail: "muzaffarbekmurodoff@gmail.com",
    supportEmail: "muzaffarbekmurodoff@gmail.com",
  },
  payments: { enabled: false },
  publication: {
    version: "1.0",
    isPreview: true,
    ru: {
      label: "Тестовый просмотр",
      notice: "Документы показаны для проверки структуры и интерфейса. Перед коммерческим запуском будет опубликована утверждённая редакция с полными обязательными сведениями.",
    },
    uz: {
      label: "Sinov ko‘rish",
      notice: "Hujjatlar tuzilma va interfeysni tekshirish uchun ko‘rsatilgan. Tijoriy ishga tushirishdan oldin barcha majburiy ma’lumotlar bilan tasdiqlangan tahrir e’lon qilinadi.",
    },
  },
} as const;
