import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getChatGPTUser } from "./chatgpt-auth";
import { workspaceProfile } from "../lib/platform/profile";
import {
  isLawyerHostRequest,
  lawyerLandingDestination,
} from "../lib/platform/lawyer-entry-routing";
import { isLocale } from "../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function Root() {
  const store = await cookies();
  const storedLocale = store.get("juro_locale")?.value;
  const fallbackLocale = typeof storedLocale === "string" && isLocale(storedLocale)
    ? storedLocale
    : "uz";
  const user = await getChatGPTUser();
  if (!user) redirect(`/${fallbackLocale}/auth/login`);
  const profile = await workspaceProfile(user.email);
  const requestHeaders = await headers();
  if (profile?.accountType === "lawyer") {
    redirect(lawyerLandingDestination(
      profile,
      isLawyerHostRequest(requestHeaders),
      requestHeaders.get("host"),
    ));
  }
  redirect(`/${profile?.locale ?? fallbackLocale}/${profile?.accountType ?? "individual"}/dashboard`);
}
