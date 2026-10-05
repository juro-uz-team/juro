import assert from "node:assert/strict";
import test from "node:test";

import {
  accountModuleRedirect,
  authenticatedAuthRedirect,
  canonicalLawyerHostRequestHeaders,
  isLawyerHostRequest,
  lawyerLandingDestination,
  lawyerPublicOrigin,
  operationalLawyer,
  type LawyerEntryProfile,
} from "../lib/platform/lawyer-entry-routing";

test("lawyer-host provenance is canonicalized at the Worker boundary", () => {
  const supplied = new Headers({
    "x-juro-lawyer-host": "1",
    "x-request-id": "request-1",
  });

  const appHeaders = canonicalLawyerHostRequestHeaders(supplied, false);
  assert.equal(isLawyerHostRequest(appHeaders), false);
  assert.equal(appHeaders.get("x-juro-lawyer-host"), null);
  assert.equal(appHeaders.get("x-request-id"), "request-1");

  const lawyerHeaders = canonicalLawyerHostRequestHeaders(
    new Headers({ "x-juro-lawyer-host": "untrusted" }),
    true,
  );
  assert.equal(isLawyerHostRequest(lawyerHeaders), true);
  assert.equal(lawyerHeaders.get("x-juro-lawyer-host"), "1");
});

const approvedLawyer: LawyerEntryProfile = {
  locale: "ru",
  accountType: "lawyer",
  onboardingCompleted: true,
  lawyerProfileStatus: "public_approved",
  lawyerMarketplaceStatus: "public_approved",
};

const pendingLawyer: LawyerEntryProfile = {
  ...approvedLawyer,
  lawyerProfileStatus: "pending",
  lawyerMarketplaceStatus: "pending_review",
};

const client: LawyerEntryProfile = {
  locale: "ru",
  accountType: "individual",
  onboardingCompleted: true,
  lawyerProfileStatus: null,
  lawyerMarketplaceStatus: null,
};

test("shared local hosts retain the lawyer account segment through login and account switching", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", null]) {
    const profile = { ...approvedLawyer, locale: "en" as const };
    assert.equal(lawyerLandingDestination(profile, false, host), "/en/lawyer/dashboard");
    assert.equal(lawyerLandingDestination({ ...pendingLawyer, locale: "en" }, false, host), "/en/lawyer/profile");
    assert.equal(lawyerLandingDestination({ ...profile, onboardingCompleted: false }, false, host), "/en/onboarding");
    assert.equal(accountModuleRedirect({
      requestedLocale: "en", requestedAccountType: "individual", module: "dashboard",
      lawyerHost: false, requestHost: host, profile,
    }), "/en/lawyer/dashboard");
  }
});

test("lawyer public origin uses the dedicated production host and canonical shared staging host", () => {
  assert.equal(lawyerPublicOrigin("app.juro.uz"), "https://lawyer.juro.uz");
  assert.equal(lawyerPublicOrigin("lawyer.juro.uz:443"), "https://lawyer.juro.uz");
  assert.equal(lawyerPublicOrigin("staging.app.juro.uz"), "https://staging.app.juro.uz");
  assert.equal(lawyerPublicOrigin("app.staging.juro.uz"), null);
  assert.equal(lawyerPublicOrigin("lawyer.staging.juro.uz"), null);
  assert.equal(lawyerPublicOrigin("attacker.invalid"), null);
});

test("authenticated lawyer host auth resolves by actual role and lifecycle", () => {
  assert.equal(authenticatedAuthRedirect({ mode: "login", reauth: false, lawyerHost: true, profile: client }), null);
  assert.equal(authenticatedAuthRedirect({ mode: "register", reauth: false, lawyerHost: true, profile: client }), null);
  assert.equal(authenticatedAuthRedirect({ mode: "login", reauth: true, lawyerHost: true, profile: approvedLawyer }), null);
  assert.equal(authenticatedAuthRedirect({ mode: "login", reauth: false, lawyerHost: true, profile: approvedLawyer }), "/ru/dashboard");
  assert.equal(authenticatedAuthRedirect({ mode: "register", reauth: false, lawyerHost: true, profile: pendingLawyer }), "/ru/application");
});

test("lawyer landing routes onboarding, application, and approved workspace separately", () => {
  assert.equal(operationalLawyer(approvedLawyer), true);
  assert.equal(operationalLawyer(pendingLawyer), false);
  assert.equal(lawyerLandingDestination({ ...pendingLawyer, onboardingCompleted: false }, true, "lawyer.juro.uz"), "/ru/onboarding");
  assert.equal(lawyerLandingDestination(pendingLawyer, true, "lawyer.juro.uz"), "/ru/application");
  assert.equal(lawyerLandingDestination(approvedLawyer, false, "app.juro.uz"), "https://lawyer.juro.uz/ru/dashboard");
});

test("account module guard rejects URL role spoofing on the lawyer host", () => {
  const destination = accountModuleRedirect({
    requestedLocale: "ru",
    requestedAccountType: "lawyer",
    module: "dashboard",
    lawyerHost: true,
    requestHost: "lawyer.juro.uz",
    profile: client,
  });
  assert.equal(destination, "/ru/auth/login?accountType=lawyer&reauth=1&returnTo=%2Fru%2Fdashboard");
});

test("pending lawyers stay in application surfaces until approval", () => {
  for (const requestedModule of ["dashboard", "consultations", "calendar"] as const) {
    assert.equal(accountModuleRedirect({
      requestedLocale: "ru",
      requestedAccountType: "lawyer",
      module: requestedModule,
      lawyerHost: true,
      requestHost: "lawyer.juro.uz",
      profile: pendingLawyer,
    }), "/ru/application");
  }
  for (const requestedModule of ["profile", "settings", "security"] as const) {
    assert.equal(accountModuleRedirect({
      requestedLocale: "ru",
      requestedAccountType: "lawyer",
      module: requestedModule,
      lawyerHost: true,
      requestHost: "lawyer.juro.uz",
      profile: pendingLawyer,
    }), null);
  }
});

test("approved lawyers are canonicalized from the client host", () => {
  assert.equal(accountModuleRedirect({
    requestedLocale: "ru",
    requestedAccountType: "lawyer",
    module: "dashboard",
    lawyerHost: false,
    requestHost: "app.juro.uz",
    profile: approvedLawyer,
  }), "https://lawyer.juro.uz/ru/dashboard");
});

test("canonical staging keeps lawyer routes on the Access-protected shared host", () => {
  assert.equal(
    lawyerLandingDestination(approvedLawyer, false, "staging.app.juro.uz"),
    "https://staging.app.juro.uz/ru/lawyer/dashboard",
  );
  assert.equal(
    lawyerLandingDestination(pendingLawyer, false, "staging.app.juro.uz"),
    "https://staging.app.juro.uz/ru/lawyer/profile",
  );
  assert.equal(
    lawyerLandingDestination(
      { ...pendingLawyer, onboardingCompleted: false },
      false,
      "staging.app.juro.uz",
    ),
    "https://staging.app.juro.uz/ru/onboarding",
  );
  assert.equal(accountModuleRedirect({
    requestedLocale: "ru",
    requestedAccountType: "lawyer",
    module: "dashboard",
    lawyerHost: false,
    requestHost: "staging.app.juro.uz",
    profile: approvedLawyer,
  }), null);
  assert.equal(accountModuleRedirect({
    requestedLocale: "ru",
    requestedAccountType: "individual",
    module: "dashboard",
    lawyerHost: false,
    requestHost: "staging.app.juro.uz",
    profile: approvedLawyer,
  }), "https://staging.app.juro.uz/ru/lawyer/dashboard");
});
