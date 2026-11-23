import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AuthPage, isAuthLocale } from "../../../_auth/AuthPage";
import { googleOAuthConfig, readGoogleProof } from "../../../../lib/auth/google-oauth";
import { googleLinkSession } from "../../../../lib/auth/google-accounts";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { isLawyerHostRequest } from "../../../../lib/platform/lawyer-entry-routing";

export const dynamic = "force-dynamic";

export default async function GoogleContinuation({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isAuthLocale(locale)) notFound();
  const requestHeaders = await headers();
  const config = googleOAuthConfig();
  if (!config || isLawyerHostRequest(requestHeaders)) notFound();
  const proof = readGoogleProof(config, requestHeaders.get("cookie"));
  if (!proof) redirect(`/${locale}/auth/login?google=failed`);
  if (proof.request.locale !== locale) redirect(`/${proof.request.locale}/auth/google`);
  if (proof.kind === "link") {
    const request = new Request(config.origin, { headers: requestHeaders });
    const session = await googleLinkSession(requireD1(), request, proof);
    if (!session) {
      const query = new URLSearchParams({ google: "link", reauth: "1", returnTo: `/${locale}/auth/google` });
      redirect(`/${locale}/auth/login?${query}`);
    }
  }
  return <AuthPage
    mode={proof.kind === "signup" ? "register" : "login"}
    locale={locale}
    accountType={proof.request.accountType}
    returnTo={proof.request.returnTo}
    googleFlow={{ kind: proof.kind, email: proof.email, name: proof.name, rememberMe: proof.request.rememberMe }}
  />;
}
