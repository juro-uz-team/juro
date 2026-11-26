import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CASE_SCENARIOS,
  LEGACY_CASE_SCENARIO_MIGRATIONS,
  caseCreateInputSchema,
  caseDirectionsForAccount,
  caseScenariosForAccount,
  caseScenarioSteps,
} from "../lib/platform/case-create";

test("case creation input is strict, localized and audience-specific", () => {
  const personal = caseScenariosForAccount("individual");
  const entrepreneur = caseScenariosForAccount("entrepreneur");
  const business = caseScenariosForAccount("business");
  assert.equal(Object.keys(CASE_SCENARIOS).length, 52);
  assert.equal(caseDirectionsForAccount("individual").length, 11);
  assert.equal(caseDirectionsForAccount("business").length, 11);
  assert.equal(personal.length, 52);
  assert.equal(entrepreneur.length, 52);
  assert.equal(business.length, 52);
  assert.equal(caseScenarioSteps("debt-recovery", "ru").length, 4);
  assert.deepEqual(LEGACY_CASE_SCENARIO_MIGRATIONS, {
    "unpaid-salary": "unpaid-salary",
    debt: "debt",
    consumer: "consumer",
    "contract-breach": "contract-breach",
    "debt-recovery": "debt-recovery",
  });
  assert.ok(personal.some((item) => item.direction === "business"));
  assert.ok(personal.some((item) => item.direction === "other"));
  assert.equal(caseScenarioSteps("debt", "ru").length, 4);
  assert.equal(caseScenarioSteps("debt", "uz").length, 4);
  assert.equal(caseScenarioSteps("debt", "en").length, 4);
  assert.equal(
    caseScenariosForAccount("individual").find(({ id }) => id === "debt")?.en,
    "Recovery of a debt evidenced by an IOU",
  );
  assert.equal(
    caseDirectionsForAccount("individual").find(({ id }) => id === "justice")?.en,
    "Courts, public authorities and enforcement",
  );
  for (const direction of caseDirectionsForAccount("individual")) {
    assert.ok(
      direction.id === "other" || caseScenariosForAccount("individual", direction.id).length >= 5,
      `${direction.id} must expose at least five scenarios`,
    );
  }

  assert.equal(caseCreateInputSchema.safeParse({
    title: " Возврат долга ",
    description: "По расписке",
    legalArea: "debt",
    locale: "ru",
    accountType: "individual",
  }).success, true);
  assert.equal(caseCreateInputSchema.safeParse({
    title: "Debt recovery",
    legalArea: "debt",
    locale: "en",
    accountType: "individual",
  }).success, true);
  assert.equal(caseCreateInputSchema.safeParse({
    title: "Debt recovery",
    legalArea: "debt",
    locale: "de",
    accountType: "individual",
  }).success, false);
  assert.equal(caseCreateInputSchema.safeParse({
    title: "",
    legalArea: "debt",
    locale: "ru",
    accountType: "individual",
  }).success, false);
  assert.equal(caseCreateInputSchema.safeParse({
    title: "Дело",
    legalArea: "fabricated-scenario",
    locale: "ru",
    accountType: "individual",
  }).success, false);
  assert.equal(caseCreateInputSchema.safeParse({
    title: "Дело",
    legalArea: "business-registration",
    locale: "ru",
    accountType: "individual",
  }).success, true);
  assert.equal(caseCreateInputSchema.safeParse({
    title: "Дело",
    legalArea: "debt",
    locale: "ru",
    accountType: "individual",
    workspaceId: "attacker-controlled",
  }).success, false);
});

test("personal, explicit business and legacy business routes protect canonical case creation", async () => {
  const [personal, business, legacy] = await Promise.all([
    readFile(new URL("../app/[locale]/[accountType]/cases/new/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/business/[workspaceId]/cases/new/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/business/cases/new/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(personal, /isAccountType\(accountType\)/);
  assert.match(personal, /requireChatGPTUser\(`\/\$\{locale\}\/\$\{accountType\}\/cases\/new`\)/);
  assert.match(personal, /CaseCreateClient locale=\{locale\} accountType=\{accountType\}/);
  assert.match(business, /isWorkspaceId\(workspaceId\)/);
  assert.match(business, /platformBasePath\(locale, "business", workspaceId\)/);
  assert.match(business, /CaseCreateClient locale=\{locale\} accountType="business"/);
  assert.match(legacy, /redirectLegacyBusinessRoute\(locale, \["cases", "new"\]\)/);
});

test("case creation UI posts a CSRF-protected real mutation and opens the persisted case", async () => {
  const [client, list] = await Promise.all([
    readFile(new URL("../app/_platform/CaseCreateClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/CasesClient.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(client, /fetch\("\/api\/platform\/cases"/);
  assert.match(client, /method: "POST"/);
  assert.match(client, /"x-juro-csrf": "1"/);
  assert.match(client, /router\.replace\(`\$\{base\}\/cases\/\$\{encodeURIComponent\(body\.caseId\)\}`\)/);
  assert.match(client, /role="alert"/);
  assert.match(client, /aria-pressed=/);
  assert.doesNotMatch(client, /mock|TODO|setTimeout/);
  assert.match(list, /href=\{`\$\{base\}\/cases\/new`\}/);
  assert.doesNotMatch(list, /href=\{`\$\{base\}\/action-plan`\}/);
});

test("case API validates input, derives tenant context and atomically inserts a correctly aligned plan", async () => {
  const route = await readFile(new URL("../app/api/platform/cases/route.ts", import.meta.url), "utf8");
  assert.match(route, /en: "Plan"/u);
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(route, /requireApiUser\(\)/);
  assert.match(route, /parseJsonRequest\(request,caseCreateInputSchema,4_096\)/);
  assert.match(route, /workspaceForContentEditor\(user, request\.headers\.get\("x-juro-workspace-id"\)\)/);
  assert.match(route, /workspace\.type==="business"\?"business"/);
  assert.match(route, /caseScenarioMatchesAccount\(legalArea,accountType\)/);
  assert.match(route, /INSERT INTO action_plans[\s\S]*VALUES \(\?,\?,\?,\?,'in_progress',0,1,\?,\?\)/);
  assert.match(route, /db\.batch\(\[/);
  assert.match(route, /INSERT INTO action_plan_versions/);
  assert.match(route, /INSERT INTO case_events/);
  assert.doesNotMatch(route, /body\?\.workspaceId|parsed\.data\.workspaceId/);
});
