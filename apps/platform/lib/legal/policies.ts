import {
  appLegalContent,
  type AppLegalSlug,
  type LegalDocument,
} from "../../content/app-legal";
import { sha256 } from "../auth/crypto";

export type PolicyLocale = "ru" | "uz" | "en";
export type PolicyStatus = "draft" | "approved" | "superseded";
export type PolicyDocumentKey =
  | "terms"
  | "privacy-policy"
  | "cookies-policy"
  | "ai-usage-rules"
  | "personal-data-processing";

type PolicyDefinition = {
  slug: AppLegalSlug;
  documentKey: PolicyDocumentKey;
  documentVersion: string;
  status: PolicyStatus;
  mandatoryAtRegistration: boolean;
  contentSha256: Record<PolicyLocale, string>;
};

export type VerifiedPolicyDocument = {
  id: string;
  slug: AppLegalSlug;
  documentKey: PolicyDocumentKey;
  documentVersion: string;
  locale: PolicyLocale;
  contentSha256: string;
  status: PolicyStatus;
  mandatoryAtRegistration: boolean;
  content: LegalDocument;
};

export const MARKETING_CONSENT_VERSION = "2026-07-26.1";

// Any canonical text change receives a new immutable version. Production
// acceptance rows are append-only and must continue to reference the exact
// text the user accepted.
const POLICY_VERSION = "2026-09-04.draft.2";
const CONTACT_POLICY_VERSION = "2026-11-23.draft.1";

const policyDefinitions = [
  {
    slug: "terms",
    documentKey: "terms",
    documentVersion: CONTACT_POLICY_VERSION,
    status: "draft",
    mandatoryAtRegistration: true,
    contentSha256: {
      ru: "a039300b1707b39eb4fe5f44efa6182db945482607d114dfc6231e4a00535655",
      uz: "0922180a96c178e876176e7ceebe80b8c167153308080bd0ff4feaf78bc4704e",
      en: "ee42632c7012b8229592142e55c317ebfcc28ff3f24d103ad224c00628845011",
    },
  },
  {
    slug: "privacy",
    documentKey: "privacy-policy",
    documentVersion: CONTACT_POLICY_VERSION,
    status: "draft",
    mandatoryAtRegistration: true,
    contentSha256: {
      ru: "d099022f5f5ad283c6cf3556cd23a1accf2a1f0261616c45db6058722a9ca1c2",
      uz: "57a8104daa163a73a35e8b48bf3f256a0b6ccbc4076877a2012688a3bd0ec8a9",
      en: "ed6f4d1199fe5c070e171ee729c4910a4936acacab2aefa386841a66b0baadc8",
    },
  },
  {
    slug: "cookies",
    documentKey: "cookies-policy",
    documentVersion: POLICY_VERSION,
    status: "draft",
    mandatoryAtRegistration: false,
    contentSha256: {
      ru: "adcf7a408de709503ada3dce8f0fa74b2e12f3b4c15af0114d61ae514a168983",
      uz: "370ce0607bd12842f3480b1a9543fd35a8294f0dcf33436631e1871f71790802",
      en: "7e94db6c7e8e2fc72069fb3eb128eea37ef6910ad9b66d7758483a115cbbe7bf",
    },
  },
  {
    slug: "ai-rules",
    documentKey: "ai-usage-rules",
    documentVersion: POLICY_VERSION,
    status: "draft",
    mandatoryAtRegistration: false,
    contentSha256: {
      ru: "3df570103a71c30c9bd1b86f9a5497c1a5c9c4b05663327c2d904af79ebcc664",
      uz: "45cfb56544660004d434775728505b6445bd6eedb405248285483b6d53a8d24d",
      en: "46f7987bcbb26d99060c8e077f71af2b2f411053dfb734aaf32c38d28e9b0683",
    },
  },
  {
    slug: "personal-data",
    documentKey: "personal-data-processing",
    documentVersion: CONTACT_POLICY_VERSION,
    status: "draft",
    mandatoryAtRegistration: true,
    contentSha256: {
      ru: "a2d88c84532e20d2da6f13741033c94fa1fd2a0e4309a860120625b743cda31f",
      uz: "6f4d27d8d72e40644fb4ead4bf9c94d16429c5602f239fc75cd3e7132b23eaa0",
      en: "8146391ad3d58403d97544435cce5093acbd0580a18b52166964da9dbbc063f5",
    },
  },
] as const satisfies readonly PolicyDefinition[];

function definitionForSlug(slug: AppLegalSlug): PolicyDefinition {
  const definition = policyDefinitions.find((candidate) =>
    candidate.slug === slug
  );
  if (!definition) throw new Error(`UNKNOWN_POLICY_SLUG:${slug}`);
  return definition;
}

export function canonicalPolicyContent(
  locale: PolicyLocale,
  slug: AppLegalSlug,
): string {
  const definition = definitionForSlug(slug);
  const content = appLegalContent[locale][slug];
  return JSON.stringify({
    schema: "juro-policy-content-v1",
    documentKey: definition.documentKey,
    documentVersion: definition.documentVersion,
    locale,
    status: definition.status,
    title: content.title,
    description: content.description,
    updated: content.updated,
    sections: content.sections.map(({ heading, paragraphs }) => ({
      heading,
      paragraphs,
    })),
  });
}

export async function policyContentDigest(
  locale: PolicyLocale,
  slug: AppLegalSlug,
): Promise<string> {
  return sha256(canonicalPolicyContent(locale, slug));
}

export async function verifiedPolicyDocument(
  locale: PolicyLocale,
  slug: AppLegalSlug,
): Promise<VerifiedPolicyDocument> {
  const definition = definitionForSlug(slug);
  const actualDigest = await policyContentDigest(locale, slug);
  const expectedDigest = definition.contentSha256[locale];
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `POLICY_CONTENT_VERSION_MISMATCH:${definition.documentKey}:${locale}`,
    );
  }
  return {
    id: [
      "policy",
      definition.documentKey,
      definition.documentVersion,
      locale,
    ].join(":"),
    slug,
    documentKey: definition.documentKey,
    documentVersion: definition.documentVersion,
    locale,
    contentSha256: actualDigest,
    status: definition.status,
    mandatoryAtRegistration: definition.mandatoryAtRegistration,
    content: appLegalContent[locale][slug],
  };
}

export async function policyRegistry(
  locale: PolicyLocale,
): Promise<VerifiedPolicyDocument[]> {
  return Promise.all(
    policyDefinitions.map(({ slug }) =>
      verifiedPolicyDocument(locale, slug)
    ),
  );
}

export async function registrationPolicies(
  locale: PolicyLocale,
): Promise<VerifiedPolicyDocument[]> {
  return (await policyRegistry(locale)).filter(
    ({ mandatoryAtRegistration }) => mandatoryAtRegistration,
  );
}

export function policyPresentation(slug: AppLegalSlug): {
  documentKey: PolicyDocumentKey;
  documentVersion: string;
  status: PolicyStatus;
} {
  const definition = definitionForSlug(slug);
  return {
    documentKey: definition.documentKey,
    documentVersion: definition.documentVersion,
    status: definition.status,
  };
}

export const policySlugs = policyDefinitions.map(
  ({ slug }) => slug,
) as AppLegalSlug[];
