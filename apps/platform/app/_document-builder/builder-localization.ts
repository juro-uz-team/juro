import { platformApiError, platformLocaleValue } from "../../content/platform-localization";
import { subscriptionFeedback } from "../../content/subscription-feedback";
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
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return subscriptionFeedback(builderUiLocale(locale), code) ?? platformApiError(builderUiLocale(locale), message, fallback);
}
