export type PublicLawyer = {
  id: string;
  displayName: string;
  specialties: string[];
  languages: string[];
  experienceYears: number | null;
  priceDescription: string | null;
  availabilityStatus: "unknown" | "available" | "limited" | "unavailable";
  nextAvailableAt: string | null;
  advocateStatus: "not_declared" | "declared" | "verified";
  firmName: string | null;
  bio: string | null;
  marketplaceStatus: "pending_review" | "public_approved";
  canReceiveRequests: boolean;
  city: string | null;
  region: string | null;
  education: string | null;
  consultationFormats: string[];
  profilePhotoUrl: string | null;
  rating: { reviewCount: number; overallAverage: number | null };
  reviews: Array<{ id: string; overallRating: number; body: string | null; createdAt: string; reply: { body: string; createdAt: string | null } | null }>;
};

function platformOrigin() {
  return (process.env.JURO_PUBLIC_PLATFORM_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
}

function asLawyer(value: unknown): PublicLawyer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PublicLawyer>;
  if (typeof row.id !== "string" || typeof row.displayName !== "string" || !Array.isArray(row.specialties) || !Array.isArray(row.languages)) return null;
  if (row.marketplaceStatus !== "pending_review" && row.marketplaceStatus !== "public_approved") return null;
  return row as PublicLawyer;
}

export function publicPhotoUrl(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith("/") ? `${platformOrigin()}${value}` : value;
}

/**
 * Marketplace profiles are published by the platform in their source language.
 * Keep filtering on the original values, but render controlled taxonomy and the
 * currently published profile fields in English on the English public route.
 * Unknown future values intentionally fall back to the source text instead of
 * being machine-translated as legal or professional information.
 */
const englishProfileText: Record<string, string> = {
  "Банковское и финансовое право": "Banking and finance law",
  "Финтех": "Fintech",
  "Подготовка документов": "Document preparation",
  "Русский": "Russian",
  "Узбекский": "Uzbek",
  "Английский": "English",
  "Ташкент": "Tashkent",
  "По договорённости после оценки задачи": "By agreement after the task is assessed",
  "Юрист и специалист по подготовке документов. Работает с банковским и финансовым правом, финтехом, санкционными и комплаенс-вопросами.": "Lawyer and document-preparation specialist. Works with banking and finance law, fintech, sanctions and compliance matters.",
  "Ташкентский государственный юридический университет, LL.B., 2020–2024": "Tashkent State University of Law, LL.B., 2020–2024",
  "Чат": "Chat",
  "Телефон": "Phone",
};

export function localizePublicLawyerText(value: string, locale: "ru" | "uz" | "en") {
  return locale === "en" ? englishProfileText[value] || value : value;
}

export function localizePublicLawyer(lawyer: PublicLawyer, locale: "ru" | "uz" | "en"): PublicLawyer {
  if (locale !== "en") return lawyer;
  return {
    ...lawyer,
    specialties: lawyer.specialties.map((value) => localizePublicLawyerText(value, locale)),
    languages: lawyer.languages.map((value) => localizePublicLawyerText(value, locale)),
    city: lawyer.city ? localizePublicLawyerText(lawyer.city, locale) : null,
    region: lawyer.region ? localizePublicLawyerText(lawyer.region, locale) : null,
    priceDescription: lawyer.priceDescription ? localizePublicLawyerText(lawyer.priceDescription, locale) : null,
    bio: lawyer.bio ? localizePublicLawyerText(lawyer.bio, locale) : null,
    education: lawyer.education ? localizePublicLawyerText(lawyer.education, locale) : null,
    consultationFormats: lawyer.consultationFormats.map((value) => localizePublicLawyerText(value, locale)),
  };
}

export async function getPublicLawyers() {
  try {
    const response = await fetch(`${platformOrigin()}/api/public/lawyers`, { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) return { lawyers: [] as PublicLawyer[], available: false };
    const payload = await response.json() as { lawyers?: unknown };
    return { lawyers: Array.isArray(payload.lawyers) ? payload.lawyers.map(asLawyer).filter((item): item is PublicLawyer => item !== null) : [], available: true };
  } catch {
    return { lawyers: [] as PublicLawyer[], available: false };
  }
}

export async function getPublicLawyer(id: string) {
  try {
    const response = await fetch(`${platformOrigin()}/api/public/lawyers/${encodeURIComponent(id)}`, { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const payload = await response.json() as { lawyer?: unknown };
    return asLawyer(payload.lawyer);
  } catch {
    return null;
  }
}
