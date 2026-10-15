import { notFound } from "next/navigation";
import { isAuthenticatedPlatformLocaleReady } from "../../../lib/platform/routing";
import { OnboardingScreen } from "../../onboarding/OnboardingScreen";

export const dynamic = "force-dynamic";

export default async function LocalizedOnboarding({ params }: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isAuthenticatedPlatformLocaleReady(locale)) notFound();
  return <OnboardingScreen locale={locale} />;
}
