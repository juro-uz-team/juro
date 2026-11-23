import {
  MARKETING_CONSENT_VERSION,
  policyRegistry,
  registrationPolicies,
  type PolicyLocale,
} from "./policies";

type RegistrationAcceptanceInput = {
  userId: string;
  locale: PolicyLocale;
  acceptedMarketing: boolean;
  acceptedAt: string;
} & ({ otpChallengeId: string } | { googleProofId: string });

export type RegistrationAcceptanceWrite = {
  statements: D1PreparedStatement[];
  mandatoryPolicyIds: string[];
};

export async function prepareRegistrationAcceptanceWrite(
  db: D1Database,
  input: RegistrationAcceptanceInput,
): Promise<RegistrationAcceptanceWrite> {
  const [registry, mandatory] = await Promise.all([
    policyRegistry(input.locale),
    registrationPolicies(input.locale),
  ]);
  if (mandatory.length === 0) {
    throw new Error("REGISTRATION_ACCEPTANCE_POLICY_SET_EMPTY");
  }
  const google = "googleProofId" in input;
  const authSource = google ? "google" : "email_otp";
  const evidenceJson = JSON.stringify(google
    ? { googleProofId: input.googleProofId, source: "registration" }
    : { otpChallengeId: input.otpChallengeId, source: "registration" });
  const statements = registry.map((policy) =>
    db.prepare(
      `INSERT OR IGNORE INTO policy_documents (
         id,document_key,document_version,locale,content_sha256,status,
         effective_at,published_at,created_at
       ) VALUES (?,?,?,?,?,?,NULL,NULL,?)`,
    ).bind(
      policy.id,
      policy.documentKey,
      policy.documentVersion,
      policy.locale,
      policy.contentSha256,
      policy.status,
      input.acceptedAt,
    )
  );
  statements.push(...mandatory.map((policy) =>
    db.prepare(
      `INSERT OR IGNORE INTO user_acceptances (
         id,user_id,policy_document_id,document_key,document_version,locale,
         content_sha256,acceptance_method,auth_source,session_id,evidence_json,
         accepted_at
       )
       SELECT ?,?,?,?,?,?,?,?,?,NULL,?,?
       FROM policy_documents
       WHERE id=?
         AND document_key=?
         AND document_version=?
         AND locale=?
         AND content_sha256=?
         AND status=?`,
    ).bind(
      crypto.randomUUID(),
      input.userId,
      policy.id,
      policy.documentKey,
      policy.documentVersion,
      policy.locale,
      policy.contentSha256,
      "registration_checkbox",
      authSource,
      evidenceJson,
      input.acceptedAt,
      policy.id,
      policy.documentKey,
      policy.documentVersion,
      policy.locale,
      policy.contentSha256,
      policy.status,
    )
  ));
  if (input.acceptedMarketing) {
    statements.push(
      db.prepare(
        `INSERT INTO consents (
           id,user_id,workspace_id,type,version,scope_json,granted_at,revoked_at
         ) VALUES (?,?,NULL,'marketing_email',?,?,?,NULL)`,
      ).bind(
        crypto.randomUUID(),
        input.userId,
        MARKETING_CONSENT_VERSION,
        JSON.stringify({ channels: ["email"] }),
        input.acceptedAt,
      ),
    );
  }
  return {
    statements,
    mandatoryPolicyIds: mandatory.map(({ id }) => id),
  };
}

export async function recordRegistrationAcceptances(
  db: D1Database,
  input: Extract<RegistrationAcceptanceInput, { otpChallengeId: string }>,
): Promise<void> {
  const write = await prepareRegistrationAcceptanceWrite(db, input);
  await db.batch(write.statements);

  const verified = await db.prepare(
    `SELECT count(*) AS total
     FROM user_acceptances acceptance
     JOIN policy_documents policy ON policy.id=acceptance.policy_document_id
     WHERE acceptance.user_id=?
       AND acceptance.policy_document_id IN (${
         write.mandatoryPolicyIds.map(() => "?").join(",")
       })
       AND acceptance.acceptance_method='registration_checkbox'
       AND acceptance.auth_source='email_otp'
       AND acceptance.locale=?
       AND acceptance.content_sha256=policy.content_sha256
       AND acceptance.document_key=policy.document_key
       AND acceptance.document_version=policy.document_version`,
  ).bind(
    input.userId,
    ...write.mandatoryPolicyIds,
    input.locale,
  ).first<{ total: number }>();
  if (Number(verified?.total ?? 0) !== write.mandatoryPolicyIds.length) {
    throw new Error("POLICY_ACCEPTANCE_EVIDENCE_MISMATCH");
  }
}
