import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getChatGPTUser } from "../chatgpt-auth";
import { workspaceProfile } from "../../lib/platform/profile";
import { getOrCreateUserProfile } from "../../lib/document-builder/storage/db";
import { isLawyerHostRequest, lawyerLandingDestination } from "../../lib/platform/lawyer-entry-routing";
import { isLocale } from "../../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function Main() {
  const store = await cookies();
  const storedLocale = store.get("juro_locale")?.value;
  const fallbackLocale = typeof storedLocale === "string" && isLocale(storedLocale)
    ? storedLocale
    : "uz";
  const user = await getChatGPTUser();
  if (!user) redirect(`/${fallbackLocale}/auth/login?returnTo=/main`);

  let profile = await workspaceProfile(user.email);
  if (!profile) {
    await getOrCreateUserProfile(user);
    profile = await workspaceProfile(user.email);
  }
  if (profile?.accountType === "lawyer") {
    const requestHeaders = await headers();
    redirect(lawyerLandingDestination(
      profile,
      isLawyerHostRequest(requestHeaders),
      requestHeaders.get("host"),
    ));
  }
  if (profile) redirect(`/${profile.locale}/${profile.accountType}/dashboard`);

  const saved = store.get("juro_account_type")?.value;
  const account = saved === "business" || saved === "entrepreneur" || saved === "lawyer"
    ? saved
    : "individual";
  redirect(`/${fallbackLocale}/${account}/dashboard`);
}
