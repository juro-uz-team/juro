import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { pricingConfig } from "../config/pricing";
import {
  billingPlanSelectionSchema,
  checkoutConfirmSchema,
  checkoutCreateSchema,
  demoPaymentInputSchema,
  sandboxAuthorizeSchema,
} from "../lib/billing/input";
import { billingErrorMessage } from "../lib/billing/localization";
import { entitlementsForSubscription, subscriptionPeriod } from "../lib/billing/entitlements";
import { accountingPages } from "../lib/billing/usage";

const requestId = "11111111-1111-4111-8111-111111111111";
const planVersionId = "22222222-2222-4222-8222-222222222222";

test("Company shares one monthly allowance anchored on the local activation day", () => {
  const anchor = "2027-01-31T08:00:00.000Z";
  const termEnd = "2027-03-31T08:00:00.000Z";
  const february = new Date("2027-02-28T08:00:00.000Z");
  assert.deepEqual(subscriptionPeriod(february,anchor,termEnd), {
    periodStart: february.toISOString(), periodEnd: termEnd,
  });
  const grant = { planCode: "company", status: "active", startedAt: anchor, currentPeriodEndsAt: termEnd };
  const current = entitlementsForSubscription(grant,february,true);
  assert.equal(current.pooled,true);
  assert.equal(current.limits.answers,500);
  assert.equal(entitlementsForSubscription(grant,new Date(termEnd),true).readOnly,true);
  assert.equal(entitlementsForSubscription(null,february,true).pooled,true);
  assert.equal(entitlementsForSubscription(null,february,false).pooled,false);
});

test("accounting pages round each document and retain the scanned page floor", () => {
  assert.equal(accountingPages("a".repeat(20_000)) * 2,16);
  assert.equal(accountingPages("a".repeat(2_501)) + accountingPages("a"),3);
  assert.equal(accountingPages("one readable page",4),4);
});

test("billing inputs accept every supported platform locale and reject unknown values", () => {
  assert.equal(billingPlanSelectionSchema.safeParse({ planCode: "individual", locale: "en" }).success, true);
  assert.equal(checkoutCreateSchema.safeParse({ requestId, planVersionId, locale: "en" }).success, true);
  assert.equal(checkoutConfirmSchema.safeParse({
    requestId,
    locale: "en",
    accountType: "individual",
    renewalMode: "ONE_TIME",
    paymentMethod: "SANDBOX_CARD",
  }).success, true);
  assert.equal(sandboxAuthorizeSchema.safeParse({ requestId, locale: "en", outcome: "FUNDED" }).success, true);
  assert.equal(demoPaymentInputSchema.safeParse({
    action: "create",
    requestId,
    locale: "en",
    flowType: "subscription",
    amountMinor: 10_000,
  }).success, true);
  assert.equal(billingPlanSelectionSchema.safeParse({ planCode: "individual", locale: "de" }).success, false);
});

test("billing copy is complete in English without mixed-language server fallbacks", () => {
  assert.equal(pricingConfig.plans[0].name.en, "Free");
  assert.equal(pricingConfig.plans.every((plan) => plan.name.en.length > 0 && plan.benefit.en.length > 0), true);
  assert.equal(billingErrorMessage("ORDER_EXPIRED", "en"), "This price calculation has expired. Create a new order.");
  assert.equal(billingErrorMessage("CASE_UNAVAILABLE", "uz"), "Ish topilmadi yoki undan foydalanib bo‘lmaydi.");
  assert.equal(billingErrorMessage("CHECKOUT_UNAVAILABLE", "en"), "Checkout is temporarily unavailable.");
  assert.equal(billingErrorMessage("UNKNOWN", "en"), "We could not complete the billing action. Please try again.");
  assert.doesNotMatch(billingErrorMessage("PAYMENT_PROVIDER_UNAVAILABLE", "en"), /[\u0400-\u04ff]/u);
});

test("checkout route adapters accept English and localize domain failures", async () => {
  const [create, confirm, marketplace, proposalMarketplace] = await Promise.all([
    readFile(new URL("../app/api/checkout/create/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/checkout/[orderId]/confirm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/checkout/[orderId]/confirm-marketplace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cases/[caseId]/proposals/[proposalId]/checkout/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(marketplace, /z\.enum\(\["ru","uz","en"\]\)/u);
  assert.match(proposalMarketplace, /authLocaleFromRequest/u);
  for (const source of [create, confirm, marketplace, proposalMarketplace]) {
    assert.match(source, /billingErrorMessage/u);
    assert.doesNotMatch(source, /error\s*:\s*error\.message/u);
  }
});
