import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const corpusUrl = new URL("../content/legal-preview.generated.json", import.meta.url);

const expectedSlugs = [
  "legal-information", "user-agreement", "public-offer", "privacy-policy",
  "personal-data-processing-policy", "personal-data-consent", "cross-border-ai-consent",
  "cookie-policy", "payments-subscriptions-refunds", "ai-use-policy",
  "marketplace-client-rules", "lawyer-platform-terms", "document-storage-rules",
  "electronic-communications-consent", "marketing-consent", "acceptable-use-policy",
  "complaints-disputes", "data-subject-request-form",
];

test("test legal corpus contains all and only the 18 public RU/UZ documents", async () => {
  const corpus = JSON.parse(await readFile(corpusUrl, "utf8"));
  assert.equal(corpus.mode, "PRE_INCORPORATION_PREVIEW");
  assert.deepEqual(corpus.documents.map((document) => document.slug), expectedSlugs);
  for (const document of corpus.documents) {
    assert.ok(document.locales.ru.title);
    assert.ok(document.locales.uz.title);
    assert.ok(document.locales.ru.sections.length > 0);
    assert.ok(document.locales.uz.sections.length > 0);
  }
});

test("test legal corpus never exposes unresolved placeholders or internal appendices", async () => {
  const corpus = await readFile(corpusUrl, "utf8");
  assert.doesNotMatch(corpus, /\{\{[A-Z0-9_]+\}\}|TODO|TBD|XXXX/u);
  assert.doesNotMatch(corpus, /processor-register-retention|ui-legal-microcopy|launch-compliance-checklist/u);
});

test("legal routing includes a centre, language pair and permanent legacy redirects", async () => {
  const [content, centre, document, legacy] = await Promise.all([
    readFile(new URL("../app/legal-content.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/legal/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/legal/[legalSlug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[locale]/[legalSlug]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(content, /terms: "user-agreement"/u);
  assert.match(content, /cookies: "cookie-policy"/u);
  assert.match(centre, /Юридический центр/u);
  assert.match(document, /legalPath\(locale === "ru" \? "uz" : "ru", legalSlug\)/u);
  assert.match(legacy, /permanentRedirect/u);
});

test("preview contacts are centrally configured and no payment merchant is implied", async () => {
  const config = await readFile(new URL("../app/legal-config.ts", import.meta.url), "utf8");
  assert.match(config, /PRE_INCORPORATION_PREVIEW/u);
  assert.match(config, /payments: \{ enabled: false \}/u);
  assert.equal((config.match(/admin@juro\.uz/g) ?? []).length, 3);
});
