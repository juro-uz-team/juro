import { lawyerText } from "../../lib/platform/lawyer-localization";
import type { PlatformLocale } from "../../lib/platform/routing";

export type LawyerDirectoryEntry = {
  id: string;
  displayName: string;
  firmName: string | null;
  role?: string;
  specialties: string[];
  languages: string[];
  experienceYears: number | null;
  priceDescription: string | null;
  consultationDurationMinutes: number | null;
  availabilityStatus: "unknown" | "available" | "limited" | "unavailable";
  advocateStatus: string;
  canReceiveRequests: boolean;
  readOnly?: true;
  city: string | null;
  region: string | null;
  profilePhotoUrl: string | null;
  bio: string | null;
  juroApproved: boolean;
  topLawyer: boolean;
  topLawyerCriteria: string | null;
  rating: { reviewCount: number; overallAverage: number | null };
};

export type LawyerDirectoryProfile = LawyerDirectoryEntry & {
  additionalServices: string[];
  consultationFormats: string[];
  education: string | null;
  nextAvailableAt: string | null;
  reviews: Array<{ id: string; overallRating: number; body: string | null; createdAt: string; reply: { body: string; createdAt: string | null } | null }>;
};

export const lawyerAvailability: Record<LawyerDirectoryEntry["availabilityStatus"], [string, string, string]> = {
  available: ["Доступен", "Mavjud", "Available"],
  limited: ["Ограниченная доступность", "Cheklangan mavjudlik", "Limited availability"],
  unavailable: ["Недоступен", "Mavjud emas", "Unavailable"],
  unknown: ["Доступность не указана", "Mavjudlik ko‘rsatilmagan", "Availability not specified"],
};

export const lawyerRequestLabel = {
  ru: "Выбрать для заявки",
  uz: "So‘rov uchun tanlash",
  en: "Select for request",
};

export function lawyerExperience(locale: PlatformLocale, years: number) {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "year", unitDisplay: "long" }).format(years);
}

export function lawyerDuration(locale: PlatformLocale, minutes: number | null) {
  return minutes === null ? "—" : `${minutes} ${lawyerText(locale, "мин.", "daq.", "min")}`;
}
