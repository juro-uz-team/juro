import { platformApiError, platformLocaleValue } from "../../content/platform-localization";
import type { BuilderLanguage } from "../../lib/document-builder/registry/engine";
import type { PlatformLocale } from "../../lib/platform/routing";

export type BuilderUiLocale = PlatformLocale;

export function builderUiLocale(locale: PlatformLocale | null): BuilderUiLocale {
  return locale ?? "ru";
}

export function builderText<T>(
  locale: PlatformLocale | null,
  copy: Readonly<{ ru: T; uz: T; en: T }>,
): T {
  return platformLocaleValue(builderUiLocale(locale), copy);
}

export function defaultBuilderDocumentLanguage(
  locale: PlatformLocale | null,
): BuilderLanguage {
  return locale === "uz" ? "uz" : "ru";
}

export function builderIntlLocale(locale: PlatformLocale | null): string {
  return builderText(locale, { ru: "ru-RU", uz: "uz-Latn-UZ", en: "en-GB" });
}

export function builderError(
  locale: PlatformLocale | null,
  error: unknown,
  fallback: string,
): string {
  if (error instanceof Error && "code" in error && error.code === "TEMPLATE_PLAN_UNAVAILABLE") {
    return builderText(locale, {
      ru: "Этот шаблон недоступен на вашем тарифе.",
      uz: "Bu andoza joriy tarifingizda mavjud emas.",
      en: "This template is unavailable on your plan.",
    });
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return platformApiError(builderUiLocale(locale), message, fallback);
}
