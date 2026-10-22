import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getOrCreateUserProfile } from "../../lib/document-builder/storage/db";
import { workspaceProfile } from "../../lib/platform/profile";
import {
  workspaceForUser,
  workspaceForUserById,
  workspacesForUser,
} from "../../lib/platform/workspace";
import type {
  AccountType,
  PlatformLocale,
} from "../../lib/platform/routing";
import {
  INTERNAL_REQUEST_PATH_HEADER,
  isAuthenticatedPlatformLocaleReady,
  platformBasePath,
  platformPath,
  safeWorkspaceReturnPath,
  workspaceForAccountRoute,
  workspaceTypeForAccountType,
} from "../../lib/platform/routing";
import { requireChatGPTUser } from "../chatgpt-auth";
import { PlatformShell } from "./PlatformShell";
import { safeDisplayName } from "../../lib/platform/display-name";
import {
  isLawyerHostRequest,
  lawyerLandingDestination,
} from "../../lib/platform/lawyer-entry-routing";

import { profileReadiness } from "../../lib/platform/profile-readiness";
import { requireD1 } from "../../lib/document-builder/storage/runtime";

export async function WorkspaceShellLayout({
  children,
  locale,
  accountType,
  requestedWorkspaceId,
}: {
  children: React.ReactNode;
  locale: PlatformLocale;
  accountType: AccountType;
  requestedWorkspaceId?: string;
}) {
  if (!isAuthenticatedPlatformLocaleReady(locale)) notFound();
  const fallbackReturnTo = platformPath(
    locale,
    accountType,
    "dashboard",
    requestedWorkspaceId,
  );
  const incomingHeaders = await headers();
  const returnTo = safeWorkspaceReturnPath(
    incomingHeaders.get(INTERNAL_REQUEST_PATH_HEADER),
    platformBasePath(locale, accountType, requestedWorkspaceId),
    fallbackReturnTo,
  );
  const user = await requireChatGPTUser(returnTo);
  const userProfile = await getOrCreateUserProfile(user);
  const profile = await workspaceProfile(user.email);
  const requestHeaders = await headers();
  const lawyerHost = isLawyerHostRequest(requestHeaders);
  if (accountType === "lawyer" && profile?.accountType !== "lawyer") {
    if (lawyerHost) {
      const query = new URLSearchParams({
        accountType: "lawyer",
        reauth: "1",
        returnTo: `/${locale}/dashboard`,
      });
      redirect(`/${locale}/auth/login?${query}`);
    }
    redirect(`/${profile?.locale ?? locale}/${profile?.accountType ?? "individual"}/dashboard`);
  }
  const practiceRoute = incomingHeaders.get(INTERNAL_REQUEST_PATH_HEADER)?.split("?")[0].endsWith("/practice");
  if (profile?.accountType === "lawyer" && accountType !== "lawyer" && !practiceRoute) {
    redirect(lawyerLandingDestination(
      profile,
      lawyerHost,
      requestHeaders.get("host"),
    ));
  }

  const defaultWorkspace = requestedWorkspaceId
    ? await workspaceForUserById(userProfile.id, requestedWorkspaceId, {
        activate: true,
        source: "canonical_business_route",
      })
    : await workspaceForUser(userProfile);
  if (!defaultWorkspace) notFound();

  const availableWorkspaces = await workspacesForUser(userProfile.id);
  const activeWorkspace = requestedWorkspaceId
    ? defaultWorkspace
    : workspaceForAccountRoute(
        defaultWorkspace,
        availableWorkspaces,
        accountType,
      );

  if (activeWorkspace.type !== workspaceTypeForAccountType(accountType)) {
    const destination = activeWorkspace.type === "business"
      ? "business"
      : profile?.accountType === "business"
        ? "individual"
        : (profile?.accountType ?? "individual");
    const base = destination === "business"
      ? `/${profile?.locale ?? locale}/business/${encodeURIComponent(activeWorkspace.id)}`
      : `/${profile?.locale ?? locale}/${destination}`;
    redirect(`${base}/dashboard`);
  }
  if (
    activeWorkspace.type === "individual"
    && profile
    && profile.accountType !== "business"
    && profile.accountType !== accountType
  ) {
    redirect(`/${profile.locale}/${profile.accountType}/dashboard`);
  }

  return (
    <PlatformShell
      locale={locale}
      accountType={accountType}
      userName={safeDisplayName(user.fullName ?? user.displayName)}
      activeWorkspaceId={activeWorkspace.id}
      workspaces={availableWorkspaces}
      profileSetup={profileReadiness({ accountType, lawyerProfileStatus: profile?.lawyerProfileStatus ?? null, lawyerMarketplaceStatus: profile?.lawyerMarketplaceStatus ?? null, hasBusinessWorkspace: availableWorkspaces.some(workspace => workspace.type === "business") })}
      practiceAvailable={process.env.PRACTICE_ENABLED === "true" && Boolean(await requireD1().prepare("SELECT workspace_id FROM practice_workspaces WHERE workspace_id=?").bind(activeWorkspace.id).first())}
    >
      {children}
    </PlatformShell>
  );
}
