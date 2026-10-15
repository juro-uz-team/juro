import assert from "node:assert/strict";
import test from "node:test";
import { profileReadiness } from "../lib/platform/profile-readiness";
const input = { accountType: "lawyer" as const, lawyerProfileStatus: null, lawyerMarketplaceStatus: null, hasBusinessWorkspace: false };
test("personal accounts never require optional profile setup", () => {
  assert.equal(profileReadiness({ ...input, accountType: "individual" }), null);
  assert.equal(profileReadiness({ ...input, accountType: "business" }), null);
});
test("organization setup is optional and ends once a business workspace exists", () => {
  assert.equal(profileReadiness({ ...input, accountType: "entrepreneur" }), "business_optional");
  assert.equal(profileReadiness({ ...input, accountType: "entrepreneur", hasBusinessWorkspace: true }), null);
});
test("lawyer readiness reflects actual review and restriction states", () => {
  assert.equal(profileReadiness(input), "lawyer_draft");
  assert.equal(profileReadiness({ ...input, lawyerMarketplaceStatus: "pending_review" }), "lawyer_review");
  assert.equal(profileReadiness({ ...input, lawyerMarketplaceStatus: "changes_requested" }), "lawyer_changes");
  for (const status of ["blocked", "suspended", "rejected", "archived"]) {
    assert.equal(profileReadiness({ ...input, lawyerProfileStatus: status, lawyerMarketplaceStatus: "pending_review" }), "lawyer_restricted");
  }
  assert.equal(profileReadiness({ ...input, lawyerProfileStatus: "public_approved", lawyerMarketplaceStatus: "public_approved" }), null);
  assert.equal(profileReadiness({ ...input, lawyerProfileStatus: "public_approved" }), "lawyer_draft");
});
