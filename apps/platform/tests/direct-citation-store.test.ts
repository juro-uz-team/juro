import assert from "node:assert/strict";
import test from "node:test";

import { legalCitationStatements } from "../lib/legal/direct-citation-store";
import type { LegalSourceContext } from "../lib/legal/source-context";

test("citation persistence accepts only an exact validated span excerpt", () => {
  const bindings: unknown[][] = [];
  const db = {
    prepare() {
      return {
        bind(...values: unknown[]) {
          bindings.push(values);
          return {} as D1PreparedStatement;
        },
      };
    },
  } as unknown as D1Database;
  const source: LegalSourceContext = {
    id: "source-1",
    actTitle: "Проверенный закон",
    actIdentifier: "42",
    officialUrl: "https://lex.uz/ru/docs/42",
    revisionDate: "2026-08-15",
    lastCheckedAt: "2026-08-15T08:00:00.000Z",
    locale: "ru",
    publishedAt: null,
    sourceType: "lex",
    status: "verified",
    verificationState: "direct_validated",
    verifiedAt: "2026-08-15T08:00:00.000Z",
    contentSha256: "a".repeat(64),
    article: "7",
    excerpt: "Статья 7. Точное проверенное правило.",
    spans: [{
      id: "span-1",
      article: "7",
      paragraph: null,
      text: "Статья 7. Точное проверенное правило.",
      textSha256: "b".repeat(64),
      quality: "high",
    }],
  };
  const statements = legalCitationStatements({
    db,
    sources: [source],
    citations: [{
      sourceId: source.id,
      actTitle: source.actTitle,
      actIdentifier: source.actIdentifier,
      article: source.article ?? null,
      excerpt: source.excerpt ?? null,
      originalUrl: source.officialUrl,
      status: "current",
      effectiveDate: null,
      verifiedAt: source.verifiedAt,
    }],
    aiRunId: "run-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    now: "2026-08-15T08:01:00.000Z",
    sourceAccessMode: "direct",
  });
  assert.equal(statements.length, 1);
  assert.equal(bindings[0]?.[24],source.id,"Persist the answer source identity independently of the URL");
  assert.equal(bindings[0]?.[13], "Статья 7. Точное проверенное правило.");

  bindings.length = 0;
  legalCitationStatements({
    db,
    sources: [source],
    citations: [{
      sourceId: source.id,
      actTitle: source.actTitle,
      actIdentifier: source.actIdentifier,
      article: source.article ?? null,
      excerpt: "Подменённая моделью цитата",
      originalUrl: source.officialUrl,
      status: "current",
      effectiveDate: null,
      verifiedAt: source.verifiedAt,
    }],
    aiRunId: "run-2",
    now: "2026-08-15T08:02:00.000Z",
    sourceAccessMode: "direct",
  });
  assert.equal(bindings[0]?.[13], null);

  const secondArticle: LegalSourceContext = {
    ...source,
    id: "source-408",
    article: "408",
    excerpt: "Статья 408. Отдельная проверенная гарантия.",
    spans: [{
      id: "span-408",
      article: "408",
      paragraph: null,
      text: "Статья 408. Отдельная проверенная гарантия.",
      textSha256: "c".repeat(64),
      quality: "high",
    }],
  };
  bindings.length = 0;
  const sameActStatements = legalCitationStatements({
    db,
    sources: [source, secondArticle],
    citations: [source, secondArticle].map((item) => ({
      sourceId: item.id,
      actTitle: item.actTitle,
      actIdentifier: item.actIdentifier,
      article: item.article ?? null,
      excerpt: item.excerpt ?? null,
      originalUrl: item.officialUrl,
      status: "current",
      effectiveDate: null,
      verifiedAt: item.verifiedAt,
    })),
    aiRunId: "run-same-act",
    now: "2026-08-15T08:03:00.000Z",
    sourceAccessMode: "direct",
  });
  assert.equal(sameActStatements.length, 2);
  assert.deepEqual(bindings.map((values) => values[12]), ["7", "408"]);
});

test("citation persistence accepts a validated private locator without treating it as Lex", () => {
  const bindings: unknown[][] = [];
  const db = {
    prepare() {
      return {
        bind(...values: unknown[]) {
          bindings.push(values);
          return {} as D1PreparedStatement;
        },
      };
    },
  } as unknown as D1Database;
  const vectorId = `ud_${"d".repeat(61)}`;
  const source: LegalSourceContext = {
    id: `private:${vectorId}`,
    actTitle: "Договор аренды.md",
    actIdentifier: null,
    officialUrl: `juro-private://document/${vectorId}`,
    revisionDate: "2026-08-15T08:00:00.000Z",
    lastCheckedAt: "2026-08-15T08:01:00.000Z",
    locale: "ru",
    publishedAt: "2026-08-15T08:00:00.000Z",
    sourceType: "internal",
    status: "user_supplied",
    verificationState: "user_supplied",
    verifiedAt: "2026-08-15T08:01:00.000Z",
    contentSha256: "a".repeat(64),
    sourceClass: "USER_TRUSTED_PRIVATE",
    excerpt: "Оплата производится до 10 числа.",
    spans: [{
      id: `${vectorId}:span`,
      article: null,
      paragraph: "page:1",
      text: "Оплата производится до 10 числа.",
      textSha256: "b".repeat(64),
      quality: "high",
    }],
    sourceQuality: {
      passed: true, title: true, sufficientText: true, clean: true,
      locale: true, canonicalUrl: true, structured: true,
    },
  };
  const citations = [{
    sourceId: source.id,
    actTitle: source.actTitle,
    actIdentifier: null,
    article: null,
    excerpt: source.excerpt ?? null,
    originalUrl: source.officialUrl,
    status: "current",
    effectiveDate: null,
    verifiedAt: source.verifiedAt,
  }];
  const statements = legalCitationStatements({
    db,
    sources: [source],
    citations,
    aiRunId: "run-private",
    conversationId: "conversation-private",
    messageId: "message-private",
    now: "2026-08-15T08:02:00.000Z",
    sourceAccessMode: "approved_package",
  });
  assert.equal(statements.length, 1);
  assert.equal(bindings[0]?.[5], "internal");
  assert.equal(bindings[0]?.[8], source.officialUrl);
  assert.equal(bindings[0]?.[13], source.excerpt);

  const rejected = legalCitationStatements({
    db,
    sources: [{ ...source, officialUrl: "https://example.invalid/private" }],
    citations,
    aiRunId: "run-forged-private",
    now: "2026-08-15T08:03:00.000Z",
    sourceAccessMode: "approved_package",
  });
  assert.equal(rejected.length, 0);
});
