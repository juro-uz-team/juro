import { isLocale, type PlatformLocale } from "../../lib/platform/routing";
import { OnboardingScreen } from "./OnboardingScreen";

export const dynamic = "force-dynamic";

export default async function Onboarding({ searchParams }: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const query = await searchParams;
  return <OnboardingScreen locale={isLocale(query.lang ?? "") ? query.lang as PlatformLocale : "uz"} />;
}
