import type { GoogleProof } from "./google-oauth";
import { sha256 } from "./crypto";
import {
  prepareUserIdentityWrite,
  resolveUserIdentity,
  userIdByEmail,
  userIdentityWriteBindings,
  USER_IDENTITY_SELECT,
  type UserIdentityRow,
} from "./identity-protection";
import { runtimeIdentityProtection } from "./identity-runtime";
import { prepareRegistrationAcceptanceWrite } from "../legal/acceptance";
import { ensureDefaultWorkspace } from "../platform/workspace";
import { isAccountType, isPersonalAccountType } from "../platform/routing";
import { lawyerLandingDestination } from "../platform/lawyer-entry-routing";
import { resolveThemePreference, themePreferenceCookie } from "../platform/theme-preference";
import { authRequestSecurityContext, prepareAuthRequestSecurityEvidence } from "./request-security-evidence";
import { prepareDeviceContinuity } from "./device-continuity";
import { deviceContinuityTokenFromCookie } from "./session-token";
import { identityKeyring, jsonNoStore, optionalIdentityKeyring } from "./mfa-http";
import { createPrimarySessionIfMfaDisabled, localSessionFromCookie } from "./session-management";
import { createPasswordMfaProof } from "./password";
import { createLoginMfaChallenge, hasActiveMfa } from "./mfa-service";
import { deviceContinuityCookie, mfaChallengeCookie, replacementSessionCookies } from "./session";
import { issueSessionHandoff } from "./session-handoff";
import { authReturnDestination } from "./return-path";

type GoogleAccountRow = UserIdentityRow & {
  id: string;
  accountType: string;
  emailVerifiedAt: string | null;
  themePreference: string;
  onboardingCompletedAt: string | null;
  lawyerProfileStatus: string | null;
  lawyerMarketplaceStatus: string | null;
};

export async function googleAccountUserId(db: D1Database, subjectHash: string) {
  const account = await db.prepare("SELECT user_id AS id FROM auth_google_accounts WHERE subject_hash=?")
    .bind(subjectHash).first<{ id: string }>();
  return account?.id ?? null;
}

export function existingGoogleEmailUserId(db: D1Database, email: string) {
  return userIdByEmail(db, runtimeIdentityProtection(), email);
}

export async function storeGoogleProof(db: D1Database, proof: GoogleProof) {
  await db.batch([
    db.prepare("DELETE FROM auth_google_proofs WHERE expires_at<=?").bind(new Date().toISOString()),
    db.prepare("INSERT INTO auth_google_proofs (token_hash,expires_at) VALUES (?,?)")
      .bind(await sha256(proof.token), new Date(proof.expires).toISOString()),
  ]);
}

export async function consumeGoogleProof(db: D1Database, token: string) {
  const result = await db.prepare("DELETE FROM auth_google_proofs WHERE token_hash=? AND expires_at>?")
    .bind(await sha256(token), new Date().toISOString()).run();
  return Number(result.meta.changes) === 1;
}

export async function createGoogleAccount(db: D1Database, proof: GoogleProof, accountType: GoogleProof["request"]["accountType"], name: string) {
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const identity = await prepareUserIdentityWrite(runtimeIdentityProtection(), { userId, email: proof.email, phone: null });
  const acceptance = await prepareRegistrationAcceptanceWrite(db, {
    userId, locale: proof.request.locale, googleProofId: await sha256(proof.token), acceptedMarketing: false, acceptedAt: now,
  });
  await db.batch([
    db.prepare(`INSERT INTO user_profiles (
        id,email,email_ciphertext,email_iv,email_key_version,email_lookup_hash,email_lookup_key_version,
        phone,phone_ciphertext,phone_iv,phone_key_version,phone_lookup_hash,phone_lookup_key_version,
        full_name,locale,account_type,email_verified_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        userId, ...userIdentityWriteBindings(identity), name, proof.request.locale, accountType, now, now, now,
      ),
    ...acceptance.statements,
    // A missing acceptance makes the subquery NULL, rolling back the whole registration.
    db.prepare(`INSERT INTO auth_google_accounts (subject_hash,user_id,linked_at) VALUES (?,(
        SELECT id FROM user_profiles WHERE id=? AND (
          SELECT count(*) FROM user_acceptances
          WHERE user_id=? AND auth_source='google' AND acceptance_method='registration_checkbox'
          AND policy_document_id IN (${acceptance.mandatoryPolicyIds.map(() => "?").join(",")})
        )=?
      ),?)`).bind(proof.subjectHash, userId, userId, ...acceptance.mandatoryPolicyIds, acceptance.mandatoryPolicyIds.length, now),
  ]);
  return userId;
}

export async function googleLinkSession(db: D1Database, request: Request, proof: GoogleProof) {
  const session = await localSessionFromCookie(db, request.headers.get("cookie"), {
    touch: false, identity: runtimeIdentityProtection(),
  });
  const userId = await existingGoogleEmailUserId(db, proof.email);
  return session && userId && session.userId === userId ? session : null;
}

export async function linkGoogleAccount(db: D1Database, subjectHash: string, userId: string, sessionId: string) {
  const now = new Date().toISOString();
  const result = await db.prepare(`INSERT INTO auth_google_accounts (subject_hash,user_id,linked_at)
    SELECT ?,u.id,? FROM user_profiles u
    JOIN auth_sessions s ON s.user_id=u.id
    WHERE u.id=? AND u.lifecycle_status='active' AND u.email_verified_at IS NOT NULL
      AND s.id=? AND s.revoked_at IS NULL
      AND s.expires_at>? AND coalesce(s.idle_expires_at,s.expires_at)>?
      AND (s.assurance_level='mfa' OR NOT EXISTS (
        SELECT 1 FROM auth_totp_credentials WHERE user_id=u.id AND status='active'
      ))
    ON CONFLICT DO NOTHING`).bind(subjectHash, now, userId, sessionId, now, now).run();
  return Number(result.meta.changes) === 1 || await googleAccountUserId(db, subjectHash) === userId;
}

export async function googleSessionResponse(db: D1Database, request: Request, proof: GoogleProof, userId: string) {
  const profile = await db.prepare(`SELECT u.id,${USER_IDENTITY_SELECT},u.account_type AS accountType,
    u.email_verified_at AS emailVerifiedAt,u.theme_preference AS themePreference,
    u.onboarding_completed_at AS onboardingCompletedAt,lp.status AS lawyerProfileStatus,
    lp.marketplace_status AS lawyerMarketplaceStatus
    FROM user_profiles u LEFT JOIN lawyer_profiles lp ON lp.user_id=u.id
    WHERE u.id=? AND u.lifecycle_status='active'`).bind(userId).first<GoogleAccountRow>();
  if (!profile?.emailVerifiedAt || !isAccountType(profile.accountType)) {
    return jsonNoStore({ code: "GOOGLE_ACCOUNT_UNAVAILABLE" }, 403);
  }
  const { locale, rememberMe, returnTo } = proof.request;
  const origin = new URL(request.url);
  const theme = resolveThemePreference(profile.themePreference);
  const themeCookie = themePreferenceCookie(theme, origin);
  const workspaceId = await ensureDefaultWorkspace(userId);
  const fallback = profile.accountType === "lawyer"
    ? lawyerLandingDestination({
      locale, accountType: "lawyer", onboardingCompleted: Boolean(profile.onboardingCompletedAt),
      lawyerProfileStatus: profile.lawyerProfileStatus, lawyerMarketplaceStatus: profile.lawyerMarketplaceStatus,
    }, false, origin.hostname)
    : profile.accountType === "business"
      ? `/${locale}/business/${encodeURIComponent(workspaceId)}/dashboard`
      : `/${locale}/${profile.accountType}/dashboard`;
  const redirectTo = authReturnDestination(fallback, returnTo);
  const userAgent = request.headers.get("user-agent");
  const requestMfa = async () => {
    const bridge = await createPasswordMfaProof(db, {
      email: `google:${await sha256(proof.token)}`, locale, primaryAuthMethod: "google",
      accountType: isPersonalAccountType(profile.accountType) ? profile.accountType : "individual",
    });
    const challenge = await createLoginMfaChallenge(db, identityKeyring(), {
      userId, emailHash: bridge.emailHash, emailOtpChallengeId: bridge.challengeId,
      primaryAuthMethod: "google", userAgent,
    });
    return jsonNoStore({ ok: true, requiresTwoFactor: true, rememberMe }, 200, [mfaChallengeCookie(challenge.token), themeCookie]);
  };
  if (await hasActiveMfa(db, userId)) return requestMfa();
  const keyring = optionalIdentityKeyring();
  const securityEvidence = await prepareAuthRequestSecurityEvidence(keyring, userId, authRequestSecurityContext(request));
  const deviceContinuity = await prepareDeviceContinuity(db, keyring, {
    userId, deviceToken: deviceContinuityTokenFromCookie(request.headers.get("cookie")), securityEvidence,
  });
  const identity = await resolveUserIdentity(runtimeIdentityProtection(), profile);
  const session = await createPrimarySessionIfMfaDisabled(db, {
    userId, userAgent, authMethod: "google", rememberMe, securityEvidence, deviceContinuity,
    loginSecurityNotification: keyring && proof.kind === "login"
      ? { keyring, recipientEmail: identity.email, locale, workspaceId } : null,
  });
  if (!session) return requestMfa();
  const handoff = await issueSessionHandoff(db, {
    userId, sourceSessionId: session.sessionId, sourceHost: origin.hostname, destinationUrl: redirectTo, rememberMe,
  });
  return jsonNoStore({ ok: true, redirectTo, handoff, themePreference: theme }, 200, [
    ...replacementSessionCookies(session.token, rememberMe, origin.hostname),
    ...(session.deviceContinuityToken ? [deviceContinuityCookie(session.deviceContinuityToken)] : []),
    themeCookie,
  ]);
}
