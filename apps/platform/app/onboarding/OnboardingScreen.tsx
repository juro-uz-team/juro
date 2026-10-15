import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireChatGPTUser } from "../chatgpt-auth";
import { getOrCreateUserProfile } from "../../lib/document-builder/storage/db";
import { type PlatformLocale } from "../../lib/platform/routing";
import { workspaceProfile } from "../../lib/platform/profile";
import { isLawyerHostRequest, lawyerLandingDestination } from "../../lib/platform/lawyer-entry-routing";

/** Older bookmarks enter the workspace without a second registration form. */
export async function OnboardingScreen({ locale }: { locale: PlatformLocale }) {
  const user = await requireChatGPTUser(`/${locale}/dashboard`);
  await getOrCreateUserProfile(user);
  const profile = await workspaceProfile(user.email);
  if (profile?.accountType === "lawyer") {
    const requestHeaders = await headers();
    redirect(lawyerLandingDestination({ ...profile, locale }, isLawyerHostRequest(requestHeaders), requestHeaders.get("host")));
  }
  return redirect(`/${locale}/${profile?.accountType ?? "individual"}/dashboard`);
}

