import { publicMetadata } from "../../lib/public-seo";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CinematicLandingPage } from "../components/cinematic/CinematicLandingPage";
import { ru } from "../../content/ru";
import { uz } from "../../content/uz";
import { en } from "../../content/en";
import type { PublicLanguage } from "../../content/types";

type Props = { params: Promise<{ locale: string }> };

function parseLocale(value: string): PublicLanguage | null {
  return value === "ru" || value === "uz" || value === "en" ? value : null;
}

export function generateStaticParams() {
  return [{ locale: "ru" }, { locale: "uz" }, { locale: "en" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
 const locale = parseLocale((await params).locale);
 if (!locale) return {};
 const content = locale === "ru" ? ru : locale === "uz" ? uz : en;
 return publicMetadata({ locale, ...content.meta });
}

export default async function LocalizedHome({ params }: Props) {
  const { locale: rawLocale } = await params;
  const locale = parseLocale(rawLocale);
  if (!locale) notFound();
  return <CinematicLandingPage language={locale} />;
}
