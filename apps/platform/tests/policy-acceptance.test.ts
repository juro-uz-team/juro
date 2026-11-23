import assert from "node:assert/strict";
import test from "node:test";
import { APP_LEGAL_OPERATOR_EMAIL } from "../content/app-legal";
import { recordRegistrationAcceptances } from "../lib/legal/acceptance";
import {
  policyRegistry,
  policySlugs,
  registrationPolicies,
  verifiedPolicyDocument,
} from "../lib/legal/policies";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

test("every displayed RU/UZ/EN policy has a locked version and content digest", async () => {
  const privacyUpdated = {
    ru: "23 ноября 2026",
    uz: "2026-yil 23-noyabr",
    en: "23 November 2026",
  } as const;
  for (const locale of ["ru", "uz", "en"] as const) {
    const registry = await policyRegistry(locale);
    assert.equal(registry.length, 5);
    assert.deepEqual(
      registry.map(({ slug }) => slug),
      policySlugs,
    );
    for (const policy of registry) {
      assert.equal(
        policy.documentVersion,
        policy.mandatoryAtRegistration
          ? "2026-11-23.draft.1"
          : "2026-09-04.draft.2",
      );
      assert.equal(policy.status, "draft");
      assert.match(policy.contentSha256, /^[a-f0-9]{64}$/);
      assert.doesNotMatch(JSON.stringify(policy.content), /\{OPERATOR_EMAIL\}/u);
      if (policy.slug === "privacy") {
        assert.equal(policy.content.updated, privacyUpdated[locale]);
        assert.ok(
          JSON.stringify(policy.content).includes(APP_LEGAL_OPERATOR_EMAIL),
        );
      }
      assert.deepEqual(
        await verifiedPolicyDocument(locale, policy.slug),
        policy,
      );
    }
    assert.deepEqual(
      (await registrationPolicies(locale))
        .map(({ documentKey }) => documentKey)
        .sort(),
      ["personal-data-processing", "privacy-policy", "terms"],
    );
  }
});

test("registration records exact policy evidence and separates marketing consent", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const now = "2026-07-26T12:00:00.000Z";
    sqlite.prepare(
      `INSERT INTO user_profiles (
         id,email,locale,created_at,updated_at
       ) VALUES (?,?,?,?,?)`,
    ).run("policy-user", "policy@example.test", "ru", now, now);
    await recordRegistrationAcceptances(d1, {
      userId: "policy-user",
      locale: "ru",
      otpChallengeId: "11111111-1111-4111-8111-111111111111",
      acceptedMarketing: true,
      acceptedAt: now,
    });

    const policies = sqlite.prepare(
      `SELECT
         document_key AS documentKey,document_version AS documentVersion,
         locale,content_sha256 AS contentSha256,status
       FROM policy_documents
       ORDER BY document_key`,
    ).all() as Array<Record<string, unknown>>;
    assert.equal(policies.length, 5);
    assert.ok(policies.every(({ locale }) => locale === "ru"));
    assert.ok(policies.every(({ status }) => status === "draft"));
    assert.ok(policies.every(({ contentSha256 }) =>
      typeof contentSha256 === "string"
      && /^[a-f0-9]{64}$/.test(contentSha256)
    ));

    const acceptances = sqlite.prepare(
      `SELECT
         acceptance.document_key AS documentKey,
         acceptance.document_version AS documentVersion,
         acceptance.locale,
         acceptance.content_sha256 AS contentSha256,
         acceptance.acceptance_method AS acceptanceMethod,
         acceptance.auth_source AS authSource,
         acceptance.evidence_json AS evidenceJson,
         policy.content_sha256 AS policyDigest
       FROM user_acceptances acceptance
       JOIN policy_documents policy
         ON policy.id=acceptance.policy_document_id
       WHERE acceptance.user_id=?
       ORDER BY acceptance.document_key`,
    ).all("policy-user") as Array<{
      documentKey: string;
      documentVersion: string;
      locale: string;
      contentSha256: string;
      acceptanceMethod: string;
      authSource: string;
      evidenceJson: string;
      policyDigest: string;
    }>;
    assert.deepEqual(
      acceptances.map(({ documentKey }) => documentKey),
      ["personal-data-processing", "privacy-policy", "terms"],
    );
    for (const acceptance of acceptances) {
      assert.equal(
        acceptance.documentVersion,
        "2026-11-23.draft.1",
      );
      assert.equal(acceptance.locale, "ru");
      assert.equal(acceptance.contentSha256, acceptance.policyDigest);
      assert.equal(
        acceptance.acceptanceMethod,
        "registration_checkbox",
      );
      assert.equal(acceptance.authSource, "email_otp");
      assert.deepEqual(JSON.parse(acceptance.evidenceJson), {
        otpChallengeId: "11111111-1111-4111-8111-111111111111",
        source: "registration",
      });
    }
    assert.equal(
      (
        sqlite.prepare(
          "SELECT count(*) AS total FROM user_acceptances WHERE document_key='marketing'",
        ).get() as { total: number }
      ).total,
      0,
    );
    assert.deepEqual({
      ...(sqlite.prepare(
        `SELECT type,version,scope_json AS scopeJson
         FROM consents WHERE user_id=?`,
      ).get("policy-user") as Record<string, unknown>),
    }, {
      type: "marketing_email",
      version: "2026-07-26.1",
      scopeJson: "{\"channels\":[\"email\"]}",
    });
  } finally {
    sqlite.close();
  }
});

test("English registration records English policy evidence without a language fallback", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const now = "2026-09-04T12:30:00.000Z";
    sqlite.prepare(
      `INSERT INTO user_profiles (id,email,locale,created_at,updated_at)
       VALUES (?,?,?,?,?)`,
    ).run("policy-user-en", "policy-en@example.test", "en", now, now);
    await recordRegistrationAcceptances(d1, {
      userId: "policy-user-en",
      locale: "en",
      otpChallengeId: "22222222-2222-4222-8222-222222222222",
      acceptedMarketing: false,
      acceptedAt: now,
    });
    const rows = sqlite.prepare(
      `SELECT locale,count(*) AS total
       FROM user_acceptances WHERE user_id=? GROUP BY locale`,
    ).all("policy-user-en") as Array<{ locale: string; total: number }>;
    assert.deepEqual(rows.map((row) => ({ ...row })), [{ locale: "en", total: 3 }]);
  } finally {
    sqlite.close();
  }
});

test("a new immutable privacy version coexists with production-era acceptance rows", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const acceptedAt = "2026-09-04T13:00:00.000Z";
    sqlite.prepare(
      `INSERT INTO user_profiles (id,email,locale,created_at,updated_at)
       VALUES (?,?,?,?,?)`,
    ).run("policy-version-user", "version@example.test", "ru", acceptedAt, acceptedAt);
    const prior = [
      ["terms", "bee1ea543edf4d2ed79025cfaeafb17440640a5c9038855b1e38dccf0d3d0ad1"],
      ["privacy-policy", "8f843cededaa10aaa1bcc490ebc7c722645213e967e2a13db37011634d9e2805"],
      ["personal-data-processing", "672d2020393c98d5392b26cec0e0a42253ba0a1328d5b1e1d9bed3d64b2e4c31"],
    ] as const;
    for (const [documentKey, digest] of prior) {
      sqlite.prepare(
        `INSERT INTO policy_documents (
           id,document_key,document_version,locale,content_sha256,status,
           effective_at,published_at,created_at
         ) VALUES (?,?,?,'ru',?,'draft',NULL,NULL,?)`,
      ).run(
        `policy:${documentKey}:2026-07-26.draft.1:ru`,
        documentKey,
        "2026-07-26.draft.1",
        digest,
        "2026-07-26T12:00:00.000Z",
      );
    }

    await recordRegistrationAcceptances(d1, {
      userId: "policy-version-user",
      locale: "ru",
      otpChallengeId: "33333333-3333-4333-8333-333333333333",
      acceptedMarketing: false,
      acceptedAt,
    });

    const versions = sqlite.prepare(
      `SELECT document_key AS documentKey,document_version AS documentVersion
       FROM policy_documents
       WHERE locale='ru' AND document_key IN (
         'terms','privacy-policy','personal-data-processing'
       )
       ORDER BY document_key,document_version`,
    ).all() as Array<{ documentKey: string; documentVersion: string }>;
    assert.equal(versions.length, 6);
    assert.deepEqual(
      versions.filter(({ documentVersion }) =>
        documentVersion !== "2026-07-26.draft.1"
      ).map((row) => ({ ...row })),
      [
        { documentKey: "personal-data-processing", documentVersion: "2026-11-23.draft.1" },
        { documentKey: "privacy-policy", documentVersion: "2026-11-23.draft.1" },
        { documentKey: "terms", documentVersion: "2026-11-23.draft.1" },
      ],
    );
    const accepted = sqlite.prepare(
      `SELECT document_key AS documentKey,document_version AS documentVersion
       FROM user_acceptances WHERE user_id=? ORDER BY document_key`,
    ).all("policy-version-user") as Array<{
      documentKey: string;
      documentVersion: string;
    }>;
    assert.deepEqual(accepted.map((row) => ({ ...row })), [
      { documentKey: "personal-data-processing", documentVersion: "2026-11-23.draft.1" },
      { documentKey: "privacy-policy", documentVersion: "2026-11-23.draft.1" },
      { documentKey: "terms", documentVersion: "2026-11-23.draft.1" },
    ]);
  } finally {
    sqlite.close();
  }
});
