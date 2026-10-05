import { sha256 } from "./crypto";
import {
  ACCOUNT_DELETION_POLICY_VERSION,
  accountDeletionLifecycleStatement,
  accountDeletionSubjectHash,
  createAccountDeletionLifecycleRecord,
  deletionPurgeEvidenceHash,
  type AccountDeletionLifecycleInput,
  type AccountDeletionMode,
} from "./account-deletion-lifecycle";
import {
  deleteUserDocumentVectorsForOwner,
  UserDocumentVectorError,
} from "../document-analysis/user-document-vectors";

const PURGE_LEASE_MS = 5 * 60 * 1_000;
const R2_DELETE_BATCH = 1_000;

type PurgeEnv = {
  DB: D1Database;
  BUCKET: R2Bucket;
  QUARANTINE_BUCKET?: R2Bucket;
  USER_DOCUMENTS_INDEX?: VectorizeIndex;
  ACCOUNT_DELETION_PURGE_ENABLED?: string;
  IDENTITY_KEYRING?: string;
};

type DeletionRequestRow = {
  id: string;
  userId: string;
  status: string;
  deletionMode: AccountDeletionMode;
  subjectHash: string | null;
  subjectKeyVersion: string | null;
  requestedAt: string;
  scheduledPurgeAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  purgeIrreversibleAt: string | null;
  purgeLeaseOwner: string | null;
  purgeLeaseExpiresAt: string | null;
};

type ObjectKeyRow = { objectKey: string | null };
type ObjectKeyBuckets = { primary: string[]; quarantine: string[] };

type PurgeInventory = {
  d1DeleteCount: number;
  redactedCount: number;
  retainedSecurityEvents: number;
  retainedPolicyAcceptances: number;
  retainedConsents: number;
  retainedWorkspaceAuditEvents: number;
  retainedFinancialRecords: number;
};

export type AccountDeletionPurgeResult =
  | { status: "completed"; requestId: string; r2DeletedCount: number }
  | { status: "already_completed"; requestId: string }
  | { status: "cancelled"; requestId: string };

export class AccountDeletionPurgeError extends Error {
  constructor(
    readonly code:
      | "ACCOUNT_DELETION_PURGE_DISABLED"
      | "ACCOUNT_DELETION_REQUEST_INVALID"
      | "ACCOUNT_DELETION_NOT_DUE"
      | "ACCOUNT_DELETION_STATE_CONFLICT"
      | "ACCOUNT_DELETION_R2_FAILED"
      | "ACCOUNT_DELETION_VECTOR_FAILED"
      | "ACCOUNT_DELETION_D1_FAILED"
      | "WORKSPACE_OWNERSHIP_TRANSFER_REQUIRED"
      | "PRIVILEGED_ACCOUNT_REVIEW_REQUIRED",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "AccountDeletionPurgeError";
  }
}

function isoAfter(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

async function loadRequest(
  db: D1Database,
  requestId: string,
): Promise<DeletionRequestRow | null> {
  return db.prepare(
    `SELECT id,user_id AS userId,status,deletion_mode AS deletionMode,
       subject_hash AS subjectHash,subject_key_version AS subjectKeyVersion,
       requested_at AS requestedAt,scheduled_purge_at AS scheduledPurgeAt,
       cancelled_at AS cancelledAt,completed_at AS completedAt,
       purge_irreversible_at AS purgeIrreversibleAt,
       purge_lease_owner AS purgeLeaseOwner,
       purge_lease_expires_at AS purgeLeaseExpiresAt
     FROM account_deletion_requests
     WHERE id=? LIMIT 1`,
  ).bind(requestId).first<DeletionRequestRow>();
}

async function ownershipTransferRequired(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS blocked
     FROM workspace_members member
     WHERE member.user_id=?
       AND member.role='owner'
       AND member.status='active'
       AND EXISTS (
         SELECT 1 FROM workspace_members other
         WHERE other.workspace_id=member.workspace_id
           AND other.user_id<>member.user_id
           AND other.status='active'
       )
       AND NOT EXISTS (
         SELECT 1 FROM workspace_members successor
         WHERE successor.workspace_id=member.workspace_id
           AND successor.user_id<>member.user_id
           AND successor.status='active'
           AND successor.role='owner'
       )
     LIMIT 1`,
  ).bind(userId).first<{ blocked: number }>();
  return Boolean(row?.blocked);
}

async function privilegedReviewRequired(
  db: D1Database,
  userId: string,
  now: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS blocked
     FROM platform_staff_assignments
     WHERE user_id=? AND revoked_at IS NULL AND expires_at>?
     LIMIT 1`,
  ).bind(userId, now).first<{ blocked: number }>();
  return Boolean(row?.blocked);
}

async function appendBlockedEvent(
  db: D1Database,
  request: DeletionRequestRow,
  code: "WORKSPACE_OWNERSHIP_TRANSFER_REQUIRED" | "PRIVILEGED_ACCOUNT_REVIEW_REQUIRED",
  now: string,
): Promise<void> {
  if (!request.subjectHash || !request.subjectKeyVersion) {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_REQUEST_INVALID",
      false,
    );
  }
  const input: AccountDeletionLifecycleInput = {
    requestId: request.id,
    subjectHash: request.subjectHash,
    subjectKeyVersion: request.subjectKeyVersion,
    eventType: "blocked",
    deletionMode: request.deletionMode,
    summary: { code },
    createdAt: now,
  };
  const record = await createAccountDeletionLifecycleRecord(db, input);
  const results = await db.batch([
    db.prepare(
      `UPDATE account_deletion_requests
       SET status='blocked',failure_code=?,purge_lease_owner=NULL,
           purge_lease_expires_at=NULL
       WHERE id=? AND status='purging'`,
    ).bind(code, request.id),
    accountDeletionLifecycleStatement(db, input, record, {
      selectSql: `SELECT 1 FROM account_deletion_requests
        WHERE id=? AND status='blocked' AND failure_code=?`,
      bindings: [request.id, code],
    }),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_STATE_CONFLICT",
      true,
    );
  }
}

async function releaseForRetry(
  db: D1Database,
  request: DeletionRequestRow,
  code: "ACCOUNT_DELETION_R2_FAILED" | "ACCOUNT_DELETION_VECTOR_FAILED" | "ACCOUNT_DELETION_D1_FAILED",
  now: string,
): Promise<void> {
  if (!request.subjectHash || !request.subjectKeyVersion) return;
  const input: AccountDeletionLifecycleInput = {
    requestId: request.id,
    subjectHash: request.subjectHash,
    subjectKeyVersion: request.subjectKeyVersion,
    eventType: "failed",
    deletionMode: request.deletionMode,
    summary: { code, retryable: true },
    createdAt: now,
  };
  const record = await createAccountDeletionLifecycleRecord(db, input);
  await db.batch([
    db.prepare(
      `UPDATE account_deletion_requests
       SET status='scheduled',failure_code=?,purge_lease_owner=NULL,
           purge_lease_expires_at=NULL
       WHERE id=? AND status='purging'`,
    ).bind(code, request.id),
    accountDeletionLifecycleStatement(db, input, record, {
      selectSql: `SELECT 1 FROM account_deletion_requests
        WHERE id=? AND status='scheduled' AND failure_code=?`,
      bindings: [request.id, code],
    }),
  ]);
}
async function claimRequest(
  env: PurgeEnv,
  request: DeletionRequestRow,
  now: string,
): Promise<DeletionRequestRow> {
  if (!request.subjectHash || !request.subjectKeyVersion) {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_REQUEST_INVALID",
      false,
    );
  }
  const expectedSubject = await accountDeletionSubjectHash(
    env.IDENTITY_KEYRING,
    request.userId,
    request.subjectKeyVersion,
  );
  if (expectedSubject.hash !== request.subjectHash) {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_REQUEST_INVALID",
      false,
    );
  }
  if (!request.scheduledPurgeAt || request.scheduledPurgeAt > now) {
    throw new AccountDeletionPurgeError("ACCOUNT_DELETION_NOT_DUE", true);
  }
  const leaseOwner = crypto.randomUUID();
  const lifecycleInput: AccountDeletionLifecycleInput = {
    requestId: request.id,
    subjectHash: request.subjectHash,
    subjectKeyVersion: request.subjectKeyVersion,
    eventType: "purge_started",
    deletionMode: request.deletionMode,
    summary: { policyVersion: ACCOUNT_DELETION_POLICY_VERSION },
    createdAt: now,
  };
  const lifecycle = await createAccountDeletionLifecycleRecord(
    env.DB,
    lifecycleInput,
  );
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE account_deletion_requests
       SET status='purging',purge_started_at=coalesce(purge_started_at,?),
           purge_lease_owner=?,purge_lease_expires_at=?,failure_code=NULL
       WHERE id=? AND cancelled_at IS NULL AND completed_at IS NULL
         AND scheduled_purge_at<=?
         AND (
           status='scheduled'
           OR (status='purging' AND purge_lease_expires_at<=?)
         )`,
    ).bind(
      now,
      leaseOwner,
      isoAfter(now, PURGE_LEASE_MS),
      request.id,
      now,
      now,
    ),
    accountDeletionLifecycleStatement(env.DB, lifecycleInput, lifecycle, {
      selectSql: `SELECT 1 FROM account_deletion_requests
        WHERE id=? AND status='purging' AND purge_lease_owner=?`,
      bindings: [request.id, leaseOwner],
    }),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    const current = await loadRequest(env.DB, request.id);
    if (current?.status === "completed") return current;
    if (current?.status === "cancelled") return current;
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_STATE_CONFLICT",
      true,
    );
  }
  const claimed = await loadRequest(env.DB, request.id);
  if (!claimed) {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_STATE_CONFLICT",
      true,
    );
  }
  return claimed;
}

async function markPurgeIrreversible(
  db: D1Database,
  request: DeletionRequestRow,
  now: string,
): Promise<void> {
  if (!request.purgeLeaseOwner) {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_STATE_CONFLICT",
      true,
    );
  }
  const result = await db.prepare(
    `UPDATE account_deletion_requests
     SET purge_irreversible_at=coalesce(purge_irreversible_at,?)
     WHERE id=? AND status='purging' AND purge_lease_owner=?
       AND purge_lease_expires_at>? AND cancelled_at IS NULL
       AND completed_at IS NULL`,
  ).bind(
    now,
    request.id,
    request.purgeLeaseOwner,
    now,
  ).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_STATE_CONFLICT",
      true,
    );
  }
}
async function userObjectKeys(
  db: D1Database,
  userId: string,
): Promise<ObjectKeyBuckets> {
  const rows = await db.prepare(
    `WITH targeted_files AS (
       SELECT file.id,file.r2_key
       FROM document_files file
       WHERE file.owner_user_id=?
          OR file.document_id IN (
            SELECT id FROM documents WHERE owner_user_id=?
          )
     )
     SELECT r2_key AS objectKey
     FROM targeted_files
     UNION
     SELECT version_one_json_key AS objectKey
     FROM document_comparisons
     WHERE (
       owner_user_id=?
       OR version_one_file_id IN (SELECT id FROM targeted_files)
       OR version_two_file_id IN (SELECT id FROM targeted_files)
     ) AND version_one_json_key IS NOT NULL
     UNION
     SELECT version_two_json_key AS objectKey
     FROM document_comparisons
     WHERE (
       owner_user_id=?
       OR version_one_file_id IN (SELECT id FROM targeted_files)
       OR version_two_file_id IN (SELECT id FROM targeted_files)
      ) AND version_two_json_key IS NOT NULL
      UNION
      SELECT r2_key AS objectKey
      FROM file_extractions
      WHERE owner_user_id=? AND r2_key IS NOT NULL
      UNION
      SELECT r2_key AS objectKey
      FROM analysis_exports
      WHERE owner_user_id=? AND r2_key IS NOT NULL
      UNION
      SELECT r2_key AS objectKey
      FROM analysis_report_exports
      WHERE owner_user_id=? AND r2_key IS NOT NULL
      UNION
      SELECT r2_key AS objectKey
      FROM comparison_exports
      WHERE r2_key IS NOT NULL AND (
        owner_user_id=? OR comparison_id IN (
          SELECT id FROM document_comparisons
          WHERE version_one_file_id IN (SELECT id FROM targeted_files)
             OR version_two_file_id IN (SELECT id FROM targeted_files)
        )
      )
      UNION
      SELECT r2_key AS objectKey
      FROM analysis_document_versions
      WHERE owner_user_id=? AND r2_key IS NOT NULL
      UNION
      SELECT r2_key AS objectKey
      FROM analysis_version_object_writes
      WHERE owner_user_id=? AND status IN ('pending','attaching','deleting')
      UNION
      SELECT profile_photo_key AS objectKey
      FROM lawyer_profiles
      WHERE user_id=? AND profile_photo_key IS NOT NULL
      UNION SELECT d.object_key AS objectKey FROM control_professional_documents d JOIN lawyer_profiles p ON p.id=d.profile_id WHERE p.user_id=?`,
  ).bind(userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId).all<ObjectKeyRow>();
  const keys = [...new Set(
    rows.results
      .map(row => row.objectKey)
      .filter((key): key is string => Boolean(key && key.length <= 1_024)),
  )].sort();
  return {
    primary: keys.filter((key) => !key.startsWith("quarantine-v2/")),
    quarantine: keys.filter((key) => key.startsWith("quarantine-v2/")),
  };
}
async function deleteR2Objects(
  bucket: R2Bucket,
  keys: string[],
): Promise<void> {
  try {
    for (let index = 0; index < keys.length; index += R2_DELETE_BATCH) {
      await bucket.delete(keys.slice(index, index + R2_DELETE_BATCH));
    }
  } catch {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_R2_FAILED",
      true,
    );
  }
}

async function inventory(
  db: D1Database,
  userId: string,
): Promise<PurgeInventory> {
  const row = await db.prepare(
    `SELECT
       (
         (SELECT count(*) FROM documents WHERE owner_user_id=?) +
         (SELECT count(*) FROM document_files WHERE owner_user_id=?) +
         (SELECT count(*) FROM document_analyses WHERE owner_user_id=?) +
         (SELECT count(*) FROM analysis_version_object_writes WHERE owner_user_id=?) +
         (SELECT count(*) FROM file_extractions WHERE owner_user_id=?) +
         (SELECT count(*) FROM analysis_exports WHERE owner_user_id=?) +
         (SELECT count(*) FROM document_comparisons WHERE owner_user_id=?) +
         (SELECT count(*) FROM analysis_report_exports WHERE owner_user_id=?) +
         (SELECT count(*) FROM comparison_exports export
          WHERE export.owner_user_id=? OR export.comparison_id IN (
            SELECT comparison.id FROM document_comparisons comparison
            WHERE comparison.version_one_file_id IN (
              SELECT file.id FROM document_files file
              WHERE file.owner_user_id=? OR file.document_id IN (
                SELECT id FROM documents WHERE owner_user_id=?
              )
            ) OR comparison.version_two_file_id IN (
              SELECT file.id FROM document_files file
              WHERE file.owner_user_id=? OR file.document_id IN (
                SELECT id FROM documents WHERE owner_user_id=?
              )
            )
          )) +
         (SELECT count(*) FROM document_suggestions WHERE author_user_id=?) +
         (SELECT count(*) FROM document_change_proposals WHERE author_user_id=?) +
         (SELECT count(*) FROM cases WHERE owner_user_id=?) +
         (SELECT count(*) FROM action_plans WHERE created_by_user_id=?) +
         (SELECT count(*) FROM conversations WHERE owner_user_id=?) +
         (SELECT count(*) FROM contacts WHERE owner_user_id=?) +
         (SELECT count(*) FROM consultation_requests WHERE requester_user_id=?) +
         (SELECT count(*) FROM consultation_bookings WHERE requester_user_id=?) +
         (SELECT count(*) FROM monitoring_preferences WHERE user_id=?) +
         (SELECT count(*) FROM notifications WHERE user_id=?) +
         (SELECT count(*) FROM user_memory_settings WHERE user_id=?) +
         (SELECT count(*) FROM user_memories WHERE user_id=?) +
         (SELECT count(*) FROM memory_sources WHERE memory_id IN (
           SELECT id FROM user_memories WHERE user_id=?
         )) +
         (SELECT count(*) FROM workspace_members WHERE user_id=?) +
         (SELECT count(*) FROM auth_sessions WHERE user_id=?) +
         (SELECT count(*) FROM auth_devices WHERE user_id=?) +
         (SELECT count(*) FROM auth_device_continuities WHERE user_id=?) +
         (SELECT count(*) FROM auth_totp_credentials WHERE user_id=?)
       ) AS d1DeleteCount,
       (SELECT count(*) FROM document_comments WHERE author_user_id=?) AS redactedCount,
       (SELECT count(*) FROM security_events WHERE user_id=?) AS retainedSecurityEvents,
       (SELECT count(*) FROM user_acceptances WHERE user_id=?) AS retainedPolicyAcceptances,
       (SELECT count(*) FROM consents WHERE user_id=?) AS retainedConsents,
       (SELECT count(*) FROM workspace_audit_events WHERE actor_user_id=?) AS retainedWorkspaceAuditEvents,
       (
         SELECT count(*) FROM payments
         WHERE workspace_id IN (
           SELECT workspace_id FROM workspace_members WHERE user_id=?
         )
       ) AS retainedFinancialRecords`,
  ).bind(
    ...Array.from({ length: 37 }, () => userId),
  ).first<Record<keyof PurgeInventory, number>>();
  if (!row) {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_D1_FAILED",
      true,
    );
  }
  return {
    d1DeleteCount: Number(row.d1DeleteCount ?? 0),
    redactedCount: Number(row.redactedCount ?? 0),
    retainedSecurityEvents: Number(row.retainedSecurityEvents ?? 0),
    retainedPolicyAcceptances: Number(row.retainedPolicyAcceptances ?? 0),
    retainedConsents: Number(row.retainedConsents ?? 0),
    retainedWorkspaceAuditEvents: Number(row.retainedWorkspaceAuditEvents ?? 0),
    retainedFinancialRecords: Number(row.retainedFinancialRecords ?? 0),
  };
}

function deletionStatements(
  db: D1Database,
  input: {
    request: DeletionRequestRow;
    tombstoneEmail: string;
    now: string;
  },
): D1PreparedStatement[] {
  const user = input.request.userId;
  const request = input.request.id;
  return [
    db.prepare(
      `DELETE FROM document_comparisons
       WHERE owner_user_id=?
          OR version_one_file_id IN (
            SELECT file.id FROM document_files file
            WHERE file.owner_user_id=?
               OR file.document_id IN (
                 SELECT id FROM documents WHERE owner_user_id=?
               )
          )
          OR version_two_file_id IN (
            SELECT file.id FROM document_files file
            WHERE file.owner_user_id=?
               OR file.document_id IN (
                 SELECT id FROM documents WHERE owner_user_id=?
               )
          )`,
    ).bind(user, user, user, user, user),
    db.prepare(`DELETE FROM document_analyses WHERE owner_user_id=?`).bind(user),
    db.prepare(`DELETE FROM document_suggestions WHERE author_user_id=?`).bind(user),
    db.prepare(`DELETE FROM document_change_proposals WHERE author_user_id=?`).bind(user),
    db.prepare(
      `UPDATE document_comments
       SET body='[deleted by account closure]',deleted_at=coalesce(deleted_at,?),
           updated_at=?
       WHERE author_user_id=?`,
    ).bind(input.now, input.now, user),
    db.prepare(`DELETE FROM document_approvals WHERE participant_user_id=?`).bind(user),
    db.prepare(`DELETE FROM signed_document_access WHERE collaborator_user_id=?`).bind(user),
    db.prepare(`DELETE FROM document_permissions WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM document_collaborators WHERE user_id=?`).bind(user),
    db.prepare(
      `DELETE FROM document_invitations
       WHERE invited_by_user_id=? OR target_user_id=?`,
    ).bind(user, user),
    db.prepare(`DELETE FROM document_share_links WHERE owner_user_id=?`).bind(user),
    db.prepare(`DELETE FROM standalone_signed_pdf_shares WHERE owner_user_id=?`).bind(user),
    db.prepare(`DELETE FROM documents WHERE owner_user_id=?`).bind(user),
    db.prepare(`DELETE FROM document_files WHERE owner_user_id=?`).bind(user),
    db.prepare(`DELETE FROM action_plans WHERE created_by_user_id=?`).bind(user),
    db.prepare(`DELETE FROM cases WHERE owner_user_id=?`).bind(user),
    db.prepare(`DELETE FROM conversations WHERE owner_user_id=?`).bind(user),
    db.prepare(`DELETE FROM consultation_requests WHERE requester_user_id=?`).bind(user),
    db.prepare(`DELETE FROM consultation_bookings WHERE requester_user_id=?`).bind(user),
    db.prepare(`DELETE FROM monitoring_preferences WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM notifications WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM user_memories WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM user_memory_settings WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM contacts WHERE owner_user_id=?`).bind(user),
    db.prepare(
      `DELETE FROM workspace_invitations
       WHERE invited_by_user_id=?
          OR email_hash IN (
            SELECT email_hash FROM account_deletion_challenges
            WHERE consumed_by_operation_id IS NOT NULL
              AND user_id=?
          )`,
    ).bind(user, user),
    db.prepare(
      `UPDATE workspaces
       SET name='Closed JURO workspace',updated_at=?
       WHERE id IN (
         SELECT member.workspace_id FROM workspace_members member
         WHERE member.user_id=?
           AND NOT EXISTS (
             SELECT 1 FROM workspace_members other
             WHERE other.workspace_id=member.workspace_id
               AND other.user_id<>member.user_id
               AND other.status='active'
           )
       )`,
    ).bind(input.now, user),
    db.prepare(`DELETE FROM workspace_members WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM email_change_challenges WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM security_email_jobs WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM security_notification_jobs WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM auth_totp_credentials WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM auth_sessions WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM auth_devices WHERE user_id=?`).bind(user),
    db.prepare(`DELETE FROM auth_device_continuities WHERE user_id=?`).bind(user),
    db.prepare(
      `DELETE FROM auth_otp_challenges
       WHERE email_hash IN (
         SELECT email_hash FROM account_deletion_challenges
         WHERE user_id=?
       )`,
    ).bind(user),
    db.prepare(
      `UPDATE account_deletion_requests
       SET verification_challenge_id=NULL,requested_session_id=NULL,
           status='completed',reason=NULL,completed_at=?,failure_code=NULL,
           purge_lease_owner=NULL,purge_lease_expires_at=NULL
       WHERE id=? AND user_id=? AND status='purging'`,
    ).bind(input.now, request, user),
    db.prepare(`DELETE FROM account_deletion_challenges WHERE user_id=?`).bind(user),
    db.prepare(
      `UPDATE user_profiles SET
         email=?,email_ciphertext=NULL,email_iv=NULL,email_key_version=NULL,
         email_lookup_hash=NULL,email_lookup_key_version=NULL,
         full_name=NULL,birth_date=NULL,id_document_type=NULL,
         id_document_number=NULL,id_issued_by=NULL,id_issue_date=NULL,
         pinfl=NULL,registered_address=NULL,phone=NULL,
         phone_ciphertext=NULL,phone_iv=NULL,phone_key_version=NULL,
         phone_lookup_hash=NULL,phone_lookup_key_version=NULL,
         last_name=NULL,first_name=NULL,middle_name=NULL,
         phone_verified=0,phone_verified_at=NULL,account_type='individual',
         company_name=NULL,organization_role=NULL,primary_goal=NULL,
         default_workspace_id=NULL,onboarding_completed_at=NULL,
         lifecycle_status='deleted',deletion_completed_at=?,updated_at=?
       WHERE id=? AND lifecycle_status='active'
         AND EXISTS (
           SELECT 1 FROM account_deletion_requests
           WHERE id=? AND user_id=? AND status='completed'
         )`,
    ).bind(
      input.tombstoneEmail,
      input.now,
      input.now,
      user,
      request,
      user,
    ),
  ];
}

export async function executeAccountDeletionPurge(
  env: PurgeEnv,
  requestId: string,
  options: { now?: () => Date } = {},
): Promise<AccountDeletionPurgeResult> {
  if (String(env.ACCOUNT_DELETION_PURGE_ENABLED) !== "true") {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_PURGE_DISABLED",
      false,
    );
  }
  const now = (options.now?.() ?? new Date()).toISOString();
  const initial = await loadRequest(env.DB, requestId);
  if (!initial) {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_REQUEST_INVALID",
      false,
    );
  }
  if (initial.status === "completed") {
    return { status: "already_completed", requestId };
  }
  if (initial.status === "cancelled") {
    return { status: "cancelled", requestId };
  }
  if (!initial.subjectHash || !initial.subjectKeyVersion) {
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_REQUEST_INVALID",
      false,
    );
  }

  const request = await claimRequest(env, initial, now);
  if (request.status === "completed") {
    return { status: "already_completed", requestId };
  }
  if (request.status === "cancelled") {
    return { status: "cancelled", requestId };
  }

  if (await ownershipTransferRequired(env.DB, request.userId)) {
    await appendBlockedEvent(
      env.DB,
      request,
      "WORKSPACE_OWNERSHIP_TRANSFER_REQUIRED",
      now,
    );
    throw new AccountDeletionPurgeError(
      "WORKSPACE_OWNERSHIP_TRANSFER_REQUIRED",
      false,
    );
  }
  if (await privilegedReviewRequired(env.DB, request.userId, now)) {
    await appendBlockedEvent(
      env.DB,
      request,
      "PRIVILEGED_ACCOUNT_REVIEW_REQUIRED",
      now,
    );
    throw new AccountDeletionPurgeError(
      "PRIVILEGED_ACCOUNT_REVIEW_REQUIRED",
      false,
    );
  }

  await markPurgeIrreversible(env.DB, request, now);
  const objectKeys = await userObjectKeys(env.DB, request.userId);
  const purgeInventory = await inventory(env.DB, request.userId);
  try {
    await deleteUserDocumentVectorsForOwner(env, request.userId, now);
  } catch (error) {
    if (error instanceof UserDocumentVectorError) {
      try {
        await releaseForRetry(env.DB, request, "ACCOUNT_DELETION_VECTOR_FAILED", now);
      } catch {
        // The bounded lease still makes the request recoverable.
      }
      throw new AccountDeletionPurgeError("ACCOUNT_DELETION_VECTOR_FAILED", true);
    }
    throw error;
  }
  try {
    await deleteR2Objects(env.BUCKET, objectKeys.primary);
    if (objectKeys.quarantine.length > 0) {
      if (!env.QUARANTINE_BUCKET) {
        throw new AccountDeletionPurgeError("ACCOUNT_DELETION_R2_FAILED", true);
      }
      await deleteR2Objects(env.QUARANTINE_BUCKET, objectKeys.quarantine);
    }
  } catch (error) {
    if (error instanceof AccountDeletionPurgeError) {
      try {
        await releaseForRetry(
          env.DB,
          request,
          "ACCOUNT_DELETION_R2_FAILED",
          now,
        );
      } catch {
        // The bounded lease still makes the request recoverable.
      }
    }
    throw error;
  }

  const retainedEvidence = [
    { kind: "security_events", count: purgeInventory.retainedSecurityEvents },
    { kind: "policy_acceptances", count: purgeInventory.retainedPolicyAcceptances },
    { kind: "consents", count: purgeInventory.retainedConsents },
    { kind: "workspace_audit", count: purgeInventory.retainedWorkspaceAuditEvents },
    { kind: "financial_records", count: purgeInventory.retainedFinancialRecords },
  ];
  const retainedEvidenceJson = JSON.stringify(retainedEvidence);
  const evidenceHash = await deletionPurgeEvidenceHash({
    requestId,
    subjectHash: request.subjectHash!,
    subjectKeyVersion: request.subjectKeyVersion!,
    deletionMode: request.deletionMode,
    requestedAt: request.requestedAt,
    completedAt: now,
    r2DeletedCount: objectKeys.primary.length + objectKeys.quarantine.length,
    d1DeletedCount: purgeInventory.d1DeleteCount,
    redactedCount: purgeInventory.redactedCount,
    retainedEvidenceJson,
  });
  const completedInput: AccountDeletionLifecycleInput = {
    requestId,
    subjectHash: request.subjectHash!,
    subjectKeyVersion: request.subjectKeyVersion!,
    eventType: "completed",
    deletionMode: request.deletionMode,
    summary: {
      d1DeletedCount: purgeInventory.d1DeleteCount,
      r2DeletedCount: objectKeys.primary.length + objectKeys.quarantine.length,
      redactedCount: purgeInventory.redactedCount,
      retainedKinds: retainedEvidence.map(item => item.kind),
    },
    createdAt: now,
  };
  const completedRecord = await createAccountDeletionLifecycleRecord(
    env.DB,
    completedInput,
  );
  const tombstoneDigest = await sha256(
    `juro-account-tombstone-v1\n${request.subjectHash}\n${requestId}`,
  );
  const statements = deletionStatements(env.DB, {
    request,
    tombstoneEmail: `deleted.${tombstoneDigest.slice(0, 32)}@invalid.juro`,
    now,
  });
  statements.push(
    env.DB.prepare(
      `INSERT INTO account_deletion_purge_evidence (
         request_id,subject_hash,subject_key_version,deletion_mode,
         policy_version,requested_at,completed_at,r2_deleted_count,
         d1_deleted_count,redacted_count,retained_evidence_json,evidence_hash
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      requestId,
      request.subjectHash,
      request.subjectKeyVersion,
      request.deletionMode,
      ACCOUNT_DELETION_POLICY_VERSION,
      request.requestedAt,
      now,
      objectKeys.primary.length + objectKeys.quarantine.length,
      purgeInventory.d1DeleteCount,
      purgeInventory.redactedCount,
      retainedEvidenceJson,
      evidenceHash,
    ),
    accountDeletionLifecycleStatement(
      env.DB,
      completedInput,
      completedRecord,
      {
        selectSql: `SELECT 1 FROM account_deletion_requests
          WHERE id=? AND user_id=? AND status='completed'
            AND completed_at=?`,
        bindings: [requestId, request.userId, now],
      },
    ),
  );

  try {
    const results = await env.DB.batch(statements);
    // The terminal request/profile guards are the fifth- and third-last
    // statements respectively. Relative positions avoid silently weakening
    // these checks when an additive domain adds an earlier purge statement.
    const requestUpdate = results.at(-5);
    const profileUpdate = results.at(-3);
    if (
      Number(requestUpdate?.meta?.changes ?? 0) !== 1
      || Number(profileUpdate?.meta?.changes ?? 0) !== 1
    ) {
      throw new Error("PURGE_GUARD_FAILED");
    }
  } catch (error) {
    if (error instanceof AccountDeletionPurgeError) throw error;
    try {
      await releaseForRetry(
        env.DB,
        request,
        "ACCOUNT_DELETION_D1_FAILED",
        now,
      );
    } catch {
      // The bounded lease still makes the request recoverable.
    }
    throw new AccountDeletionPurgeError(
      "ACCOUNT_DELETION_D1_FAILED",
      true,
    );
  }

  return {
    status: "completed",
    requestId,
    r2DeletedCount: objectKeys.primary.length + objectKeys.quarantine.length,
  };
}
