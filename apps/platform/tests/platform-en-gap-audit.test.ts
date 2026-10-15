import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { publicStatusMetadata } from "../lib/operations/status-metadata";

const root = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("legacy root and main redirects preserve an explicitly saved English locale", async () => {
  const [rootPage, mainPage] = await Promise.all([
    source("app/page.tsx"),
    source("app/main/page.tsx"),
  ]);
  for (const page of [rootPage, mainPage]) {
    assert.match(page, /typeof storedLocale === "string" && isLocale\(storedLocale\)/);
    assert.match(page, /`\/\$\{fallbackLocale\}\/auth\/login/);
    assert.doesNotMatch(page, /redirect\("\/uz\/auth\/login/);
  }
  assert.match(rootPage, /profile\?\.locale \?\? fallbackLocale/);
  assert.match(mainPage, /`\/\$\{profile\.locale\}\/\$\{profile\.accountType\}\/dashboard`/);
});

test("legacy document-builder routing treats en as a canonical UI locale", async () => {
  const routeHelpers = await source("app/document-builder/route-helpers.ts");
  assert.match(routeHelpers, /typeof queryLocale === "string" && isLocale\(queryLocale\)/);
  assert.match(routeHelpers, /typeof storedLocale === "string" && isLocale\(storedLocale\)/);
  assert.doesNotMatch(routeHelpers, /queryLocale === "uz"|storedLocale === "uz"/);
});

test("global search keeps English template and source queries fail-closed", async () => {
  const searchRoute = await source("app/api/platform/search/route.ts");
  assert.match(searchRoute, /typeof requestedLocale === "string" && isLocale\(requestedLocale\)/);
  assert.match(searchRoute, /l\.language=\?/);
  assert.match(searchRoute, /content_sha256 IS NOT NULL AND locale=\?/);
  assert.doesNotMatch(searchRoute, /searchParams\.get\("locale"\) === "uz" \? "uz" : "ru"/);
});

test("public status exposes English routing and metadata without a Russian fallback", async () => {
  const [legacyPage, localizedPage] = await Promise.all([
    source("app/status/page.tsx"),
    source("app/[locale]/status/page.tsx"),
  ]);
  assert.equal(publicStatusMetadata(null, "en").title, "Platform status");
  assert.equal(publicStatusMetadata(null, "uz").title, "Platforma holati");
  assert.equal(publicStatusMetadata(null).title, "Статус платформы");
  assert.match(legacyPage, /typeof requestedLocale === "string" && isLocale\(requestedLocale\)/);
  assert.match(legacyPage, /publicStatusMetadata\([\s\S]*isLocale\(requestedLocale\)/);
  assert.match(localizedPage, /publicStatusMetadata\([\s\S]*isLocale\(locale\)/);
  assert.doesNotMatch(legacyPage, /\.lang === "uz" \? "uz" : "ru"/);
});

test("legacy builder invitations and public shares expose explicit English chrome", async () => {
  const [
    localeHelper,
    invitationPage,
    invitationClient,
    sharePage,
    publicView,
    signedPage,
    signedClient,
  ] = await Promise.all([
    source("app/_document-builder/public-builder-locale.ts"),
    source("app/_document-builder/invitations/[token]/page.tsx"),
    source("app/_document-builder/invitations/[token]/InvitationClient.tsx"),
    source("app/_document-builder/share/[token]/page.tsx"),
    source("app/_document-builder/_components/PublicDocumentView.tsx"),
    source("app/_document-builder/signed-share/[token]/page.tsx"),
    source("app/_document-builder/signed-share/[token]/SignedShareAccessClient.tsx"),
  ]);
  assert.match(localeHelper, /isLocale\(requestedLocale\)/);
  assert.match(localeHelper, /isLocale\(storedLocale\)/);
  assert.match(invitationPage, /Sign in to open this invitation/);
  assert.match(invitationPage, /<InvitationClient token=\{token\} locale=\{locale\}/);
  assert.match(invitationClient, /title: "Document invitation"/);
  assert.match(invitationClient, /instanceof ApiClientError/);
  assert.doesNotMatch(invitationClient, /caught\.message/);
  assert.match(sharePage, /This link is no longer valid/);
  assert.match(publicView, /Shared by the document owner/);
  assert.match(signedPage, /Access a signed document/);
  assert.match(signedClient, /title: "Signed document"/);
  assert.match(signedClient, /"x-juro-locale": locale/);
  assert.doesNotMatch(signedClient, /data\.error \|\|/);
});

test("theme, support and knowledge-base failures stay English-safe", async () => {
  const [
    themeRoute,
    supportRoute,
    feedbackRoute,
    helpClient,
    feedbackClient,
  ] = await Promise.all([
    source("app/api/platform/theme/route.ts"),
    source("app/api/platform/support-tickets/[ticketId]/route.ts"),
    source("app/api/platform/help/articles/[articleSlug]/feedback/route.ts"),
    source("app/_platform/HelpClient.tsx"),
    source("app/_platform/KnowledgeBaseFeedback.tsx"),
  ]);

  assert.match(themeRoute, /authLocaleFromRequest\(request\)/);
  assert.match(themeRoute, /Choose the light or dark theme\./);
  assert.doesNotMatch(themeRoute, /Проверьте тему \/ Mavzuni tekshiring/);
  assert.match(supportRoute, /The support request was not found\./);
  assert.match(supportRoute, /This support request is already closed\./);
  assert.match(feedbackRoute, /knowledgeBaseErrorMessage\(error\.code, locale\)/);
  for (const client of [helpClient, feedbackClient]) {
    assert.match(client, /"x-juro-locale": locale/);
    assert.match(client, /platformApiError\(locale,/);
  }
});
