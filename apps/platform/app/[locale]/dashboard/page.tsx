import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getChatGPTUser } from "../../chatgpt-auth";
import { workspaceProfile } from "../../../lib/platform/profile";
import { isLocale, platformPath } from "../../../lib/platform/routing";
import { isLawyerHostRequest, lawyerLandingDestination } from "../../../lib/platform/lawyer-entry-routing";
import { redirectLegacyBusinessRoute } from "../../_platform/LegacyBusinessRoute";

export const dynamic = "force-dynamic";

// Recover account-less dashboard links using the authenticated account.
export default async function DashboardEntry({ params }: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const user = await getChatGPTUser();
  if (!user) redirect(`/${locale}/auth/login?returnTo=${encodeURIComponent(`/${locale}/dashboard`)}`);
  const profile = await workspaceProfile(user.email);
  if (!profile?.onboardingCompleted) redirect(`/${locale}/onboarding`);
  if (profile.accountType === "lawyer") {
    const requestHeaders = await headers();
    redirect(lawyerLandingDestination(
      { ...profile, locale },
      isLawyerHostRequest(requestHeaders),
      requestHeaders.get("host"),
    ));
  }
  if (profile.accountType === "business") return redirectLegacyBusinessRoute(locale, ["dashboard"]);
  redirect(platformPath(locale, profile.accountType, "dashboard"));
}
