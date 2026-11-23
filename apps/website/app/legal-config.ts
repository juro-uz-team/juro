export type LegalMode = "PRE_INCORPORATION_PREVIEW" | "INCORPORATED";

export const legalConfig = {
  mode: "PRE_INCORPORATION_PREVIEW" as LegalMode,
  domains: {
    public: process.env.NEXT_PUBLIC_WEBSITE_ORIGIN ?? "http://localhost:3001",
    app: process.env.NEXT_PUBLIC_PLATFORM_ORIGIN ?? "http://localhost:3000",
  },
  contacts: {
    privacyEmail: "admin@juro.uz",
    legalEmail: "admin@juro.uz",
    supportEmail: "admin@juro.uz",
  },
  payments: { enabled: false },
  publication: {
    version: "1.0",
    isPreview: true,
    ru: {
      label: "Тестовый просмотр",
    },
    uz: {
      label: "Sinov ko‘rish",
    },
  },
} as const;
