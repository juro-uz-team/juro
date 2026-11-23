import type { PublicLanguage } from "../../../content/types";

const PLATFORM_ORIGIN = process.env.NEXT_PUBLIC_PLATFORM_ORIGIN ?? "http://localhost:3000";

export function platformAuthHref(
  locale: PublicLanguage,
  mode: "login" | "register",
): string {
  return `${PLATFORM_ORIGIN}/${locale}/auth/${mode}`;
}

export function platformRegistrationHref(locale: PublicLanguage): string {
  return `${platformAuthHref(locale, "register")}?accountType=individual`;
}

export function platformToolHref(locale: PublicLanguage, tool: string): string {
  return `${PLATFORM_ORIGIN}/${locale}/workspace/${tool}`;
}

export function platformPersonalHref(
  locale: PublicLanguage,
  path: string,
): string {
  return platformAccountHref(locale, "individual", path);
}

export function platformAccountHref(
  locale: PublicLanguage,
  account: "individual" | "business" | "lawyer",
  path: string,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${PLATFORM_ORIGIN}/${locale}/${account}${normalizedPath}`;
}
