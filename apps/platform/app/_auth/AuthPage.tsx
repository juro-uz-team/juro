import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { localDevelopmentAuthEnabled } from "../../lib/auth/development-auth";
import { authReturnDestination } from "../../lib/auth/return-path";
import { googleOAuthConfig } from "../../lib/auth/google-oauth";
import { runtimeEnv } from "../../lib/document-builder/storage/runtime";
import {
  authenticatedAuthRedirect,
  isLawyerHostRequest,
} from "../../lib/platform/lawyer-entry-routing";
import { workspaceProfile } from "../../lib/platform/profile";
import { getChatGPTUser } from "../chatgpt-auth";
import { AuthForm, type GoogleFlowView } from "./AuthForm";
import "./auth.css";

export type AuthLocale = "ru" | "uz" | "en";
export type RegistrationPersona = "individual" | "entrepreneur" | "lawyer";

export function isAuthLocale(value: string): value is AuthLocale {
  return value === "ru" || value === "uz" || value === "en";
}

export function registrationPersona(value?: string): RegistrationPersona {
  return value === "entrepreneur" || value === "lawyer"
    ? value
    : "individual";
}

export async function AuthPage({
  mode,
  locale,
  accountType,
  returnTo,
  reauth = false,
  googleFlow,
}: {
  mode: "login" | "register";
  locale: AuthLocale;
  accountType?: string;
  returnTo?: string;
  reauth?: boolean;
  googleFlow?: GoogleFlowView;
}) {
  const requestHeaders = await headers();
  const lawyerHost = isLawyerHostRequest(requestHeaders);
  const authenticated = googleFlow ? null : await getChatGPTUser();
  if (authenticated) {
    const destination = authenticatedAuthRedirect({
      mode,
      reauth,
      lawyerHost,
      profile: await workspaceProfile(authenticated.email),
    });
    if (destination) redirect(authReturnDestination(destination, returnTo));
  }
  const env = runtimeEnv();
  return (
    <AuthForm
      mode={mode}
      initialLocale={locale}
      initialAccountType={registrationPersona(accountType)}
      returnTo={returnTo}
      googleAuthEnabled={!lawyerHost && Boolean(googleOAuthConfig())}
      googleFlow={googleFlow}
      passwordAuthEnabled={Boolean(
        env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY
      )}
      emailAuthEnabled={Boolean(
        env.RESEND_API_KEY && env.EMAIL_FROM
          && env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY
      )}
      turnstileSiteKey={env.TURNSTILE_SITE_KEY}
      platformAuthEnabled={env.ALLOW_PLATFORM_AUTH_HEADERS === "true"}
      developmentAuthEnabled={localDevelopmentAuthEnabled()}
    />
  );
}
