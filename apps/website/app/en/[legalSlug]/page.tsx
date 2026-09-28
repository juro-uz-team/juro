import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { SeoLanding, generateSeoLandingMetadata } from "../../[locale]/_seo/SeoLanding";
import { seoLandingSlugs, type SeoLandingSlug } from "../../../content/seo-landings";
import { legacyLegalRoutes } from "../../legal-content";

function isSeoLanding(slug: string): slug is SeoLandingSlug {
  return seoLandingSlugs.includes(slug as SeoLandingSlug);
}

export async function generateMetadata({ params }: { params: Promise<{ legalSlug: string }> }): Promise<Metadata> {
  const { legalSlug } = await params;
  if (!isSeoLanding(legalSlug)) return {};
  return generateSeoLandingMetadata(legalSlug, { params: Promise.resolve({ locale: "en" }) });
}

export default async function EnglishLegacyLegalRoute({ params }: { params: Promise<{ legalSlug: string }> }) {
  const { legalSlug } = await params;
  if (isSeoLanding(legalSlug)) return <SeoLanding slug={legalSlug} params={Promise.resolve({ locale: "en" })} />;
  const canonicalSlug = legacyLegalRoutes[legalSlug];
  if (!canonicalSlug) notFound();
  permanentRedirect(`/en/legal/${canonicalSlug}`);
}
