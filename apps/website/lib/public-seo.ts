import type { Metadata } from "next";
import type { PublicLanguage } from "../content/types";

export const publicOrigin = "https://juro.uz";
export const publicLanguages = ["ru", "uz", "en"] as const;
export const socialLocales = { ru: "ru_RU", uz: "uz_UZ", en: "en_US" } as const;

export function localizedAlternates(path: string, languages: readonly PublicLanguage[] = publicLanguages) {
  return Object.fromEntries([
    ...languages.map(locale => [locale, `${publicOrigin}/${locale}${path}`]),
    ["x-default", `${publicOrigin}/${languages.includes("ru") ? "ru" : languages[0]}${path}`],
  ]);
}

export function publicMetadata({ locale, title, description, path = "", image = "home", noindex = false, languages = publicLanguages, type = "website" }: {
  locale: PublicLanguage;
  title: string;
  description: string;
  path?: string;
  image?: string;
  noindex?: boolean;
  languages?: readonly PublicLanguage[];
  type?: "website" | "article" | "profile";
}): Metadata {
  const brandedTitle = /\bJURO\b/i.test(title) ? title : `${title} — JURO`;
  const canonical = `${publicOrigin}/${locale}${path}`;
  const imageUrl = `${publicOrigin}/og/${locale}/${image}.png`;
  const index = !noindex && process.env.DEPLOYMENT_ENVIRONMENT !== "staging";
  const follow = process.env.DEPLOYMENT_ENVIRONMENT !== "staging";
  return {
    title: { absolute: brandedTitle },
    description,
    applicationName: "JURO",
    robots: { index, follow, googleBot: { index, follow, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
    alternates: { canonical, languages: localizedAlternates(path, languages) },
    openGraph: {
      title: brandedTitle, description, url: canonical, siteName: "JURO", type,
      locale: socialLocales[locale],
      alternateLocale: languages.filter(language => language !== locale).map(language => socialLocales[language]),
      images: [{ url: imageUrl, width: 1200, height: 630, type: "image/png", alt: brandedTitle }],
    },
    twitter: { card: "summary_large_image", title: brandedTitle, description, images: [{ url: imageUrl, alt: brandedTitle }] },
  };
}

export function articleDate(value: string): string | undefined {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return undefined;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}

export function breadcrumbSchema(locale: PublicLanguage, items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ name: "JURO", path: "" }, ...items].map((item, index) => ({
      "@type": "ListItem", position: index + 1, name: item.name, item: `${publicOrigin}/${locale}${item.path}`,
    })),
  };
}
