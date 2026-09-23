import { booleanInteger } from "./column-types";
import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  check,
  index,
  bigint,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name"),
    shortName: text("short_name"),
    createdByUserId: text("created_by_user_id"),
    creationRequestId: text("creation_request_id"),
    locale: text("locale").notNull().default("ru"),
    ...timestamps,
  },
  (table) => [
    index("workspaces_type_idx").on(table.type, table.createdAt),
    uniqueIndex("workspaces_creation_request_uidx")
      .on(table.creationRequestId)
      .where(sql`${table.creationRequestId} IS NOT NULL`),
  ],
);

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailCiphertext: text("email_ciphertext"),
    emailIv: text("email_iv"),
    emailKeyVersion: text("email_key_version"),
    emailLookupHash: text("email_lookup_hash"),
    emailLookupKeyVersion: text("email_lookup_key_version"),
    emailVerifiedAt: text("email_verified_at"),
    fullName: text("full_name"),
    birthDate: text("birth_date"),
    idDocumentType: text("id_document_type"),
    idDocumentNumber: text("id_document_number"),
    idIssuedBy: text("id_issued_by"),
    idIssueDate: text("id_issue_date"),
    pinfl: text("pinfl"),
    registeredAddress: text("registered_address"),
    phone: text("phone"),
    phoneCiphertext: text("phone_ciphertext"),
    phoneIv: text("phone_iv"),
    phoneKeyVersion: text("phone_key_version"),
    phoneLookupHash: text("phone_lookup_hash"),
    phoneLookupKeyVersion: text("phone_lookup_key_version"),
    lastName: text("last_name"),
    firstName: text("first_name"),
    middleName: text("middle_name"),
    phoneVerified: booleanInteger("phone_verified")
      .notNull()
      .default(false),
    phoneVerifiedAt: text("phone_verified_at"),
    locale: text("locale").notNull().default("ru"),
    accountType: text("account_type").notNull().default("individual"),
    companyName: text("company_name"),
    organizationRole: text("organization_role"),
    primaryGoal: text("primary_goal"),
    timezone: text("timezone").notNull().default("Asia/Tashkent"),
    themePreference: text("theme_preference").notNull().default("system"),
    defaultWorkspaceId: text("default_workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    onboardingCompletedAt: text("onboarding_completed_at"),
    lifecycleStatus: text("lifecycle_status").notNull().default("active"),
    deletionCompletedAt: text("deletion_completed_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_profiles_email_uidx").on(table.email),
    uniqueIndex("user_profiles_email_lookup_uidx")
      .on(table.emailLookupKeyVersion, table.emailLookupHash)
      .where(sql`${table.emailLookupHash} IS NOT NULL`),
    index("user_profiles_phone_lookup_idx")
      .on(table.phoneLookupKeyVersion, table.phoneLookupHash)
      .where(sql`${table.phoneLookupHash} IS NOT NULL`),
  ],
);

export const userPasswordCredentials = pgTable(
  "user_password_credentials",
  {
    userId: text("user_id").primaryKey().references(() => userProfiles.id, {
      onDelete: "cascade",
    }),
    algorithm: text("algorithm").notNull().default("PBKDF2-SHA256"),
    iterations: bigint("iterations", { mode: "number" }).notNull().default(600_000),
    saltBase64url: text("salt_base64url").notNull(),
    hashBase64url: text("hash_base64url").notNull(),
    passwordChangedAt: text("password_changed_at").notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      "user_password_algorithm_check",
      sql`${table.algorithm} = 'PBKDF2-SHA256'`,
    ),
    check(
      "user_password_iterations_check",
      sql`${table.iterations} BETWEEN 310000 AND 1000000`,
    ),
    check(
      "user_password_salt_check",
      sql`length(${table.saltBase64url}) BETWEEN 22 AND 64`,
    ),
    check(
      "user_password_hash_check",
      sql`length(${table.hashBase64url}) = 43`,
    ),
  ],
);

export const authPendingRegistrations = pgTable(
  "auth_pending_registrations",
  {
    userId: text("user_id").primaryKey().references(() => userProfiles.id, {
      onDelete: "cascade",
    }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "auth_pending_registrations_expiry_check",
      sql`${table.updatedAt} >= ${table.createdAt}
        AND ${table.expiresAt} > ${table.updatedAt}`,
    ),
    index("auth_pending_registrations_expiry_idx").on(
      table.expiresAt,
      table.userId,
    ),
  ],
);

export const authPasswordRateLimits = pgTable(
  "auth_password_rate_limits",
  {
    scopeKey: text("scope_key").primaryKey(),
    failureCount: bigint("failure_count", { mode: "number" }).notNull().default(0),
    windowStartedAt: text("window_started_at").notNull(),
    lockedUntil: text("locked_until"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "auth_password_rate_limit_count_check",
      sql`${table.failureCount} BETWEEN 0 AND 1000`,
    ),
    index("auth_password_rate_limits_updated_idx").on(table.updatedAt),
  ],
);

export const authPasswordAttemptReservations = pgTable(
  "auth_password_attempt_reservations",
  {
    id: text("id").primaryKey(),
    scopeKey: text("scope_key").notNull(),
    scopeKind: text("scope_kind").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "auth_password_attempt_scope_check",
      sql`${table.scopeKind} IN ('email','ip')`,
    ),
    check(
      "auth_password_attempt_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    index("auth_password_attempt_scope_expiry_idx").on(
      table.scopeKey,
      table.expiresAt,
    ),
    index("auth_password_attempt_expiry_idx").on(table.expiresAt),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    joinedAt: text("joined_at").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspace_members_uidx").on(table.workspaceId, table.userId),
    index("workspace_members_user_idx").on(table.userId, table.status),
  ],
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id").notNull().references(() => userProfiles.id),
    email: text("email"),
    emailHash: text("email_hash").notNull(),
    emailCiphertext: text("email_ciphertext"),
    emailIv: text("email_iv"),
    emailKeyVersion: text("email_key_version"),
    emailLookupHash: text("email_lookup_hash"),
    emailLookupKeyVersion: text("email_lookup_key_version"),
    tokenHash: text("token_hash").notNull(),
    role: text("role").notNull(),
    expiresAt: text("expires_at").notNull(),
    acceptedAt: text("accepted_at"),
    acceptanceClaimId: text("acceptance_claim_id"),
    revokedAt: text("revoked_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspace_invitations_token_uidx").on(table.tokenHash),
    uniqueIndex("workspace_invitations_acceptance_claim_uidx")
      .on(table.acceptanceClaimId)
      .where(sql`${table.acceptanceClaimId} IS NOT NULL`),
    index("workspace_invitations_workspace_idx").on(table.workspaceId, table.expiresAt),
    index("workspace_invitations_email_lookup_idx")
      .on(
        table.workspaceId,
        table.emailLookupKeyVersion,
        table.emailLookupHash,
      )
      .where(sql`${table.emailLookupHash} IS NOT NULL`),
  ],
);

export const workspaceAuditEvents = pgTable(
  "workspace_audit_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    metadataJson: text("metadata_json"),
    ipHash: text("ip_hash"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("workspace_audit_events_workspace_idx").on(table.workspaceId, table.createdAt),
    index("workspace_audit_events_entity_idx").on(table.entityType, table.entityId),
  ],
);

export const consents = pgTable(
  "consents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    version: text("version").notNull(),
    scopeJson: text("scope_json"),
    grantedAt: text("granted_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    index("consents_user_idx").on(table.userId, table.type, table.grantedAt),
    index("consents_workspace_idx").on(table.workspaceId, table.type),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    fullName: text("full_name").notNull(),
    birthDate: text("birth_date"),
    idDocumentType: text("id_document_type"),
    idDocumentNumber: text("id_document_number"),
    idIssuedBy: text("id_issued_by"),
    idIssueDate: text("id_issue_date"),
    pinfl: text("pinfl"),
    registeredAddress: text("registered_address"),
    phone: text("phone"),
    ...timestamps,
  },
  (table) => [index("contacts_owner_idx").on(table.ownerUserId)],
);

export const documentTemplates = pgTable("document_templates", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  category: text("category").notNull(),
  active: booleanInteger("active").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const documentTemplateLocales = pgTable(
  "document_template_locales",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull().references(() => documentTemplates.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    name: text("name").notNull(),
    sourceObjectKey: text("source_object_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("template_locales_uidx").on(table.templateId, table.language)],
);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    templateId: text("template_id").notNull().references(() => documentTemplates.id),
    templateCode: text("template_code"),
    templateVersion: text("template_version"),
    language: text("language").notNull(),
    participantMode: text("participant_mode").notNull(),
    actingSide: text("acting_side"),
    title: text("title").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull(),
    caseId: text("case_id"),
    planStepId: text("plan_step_id"),
    caseLinkRevision: bigint("case_link_revision", { mode: "number" }).notNull().default(0),
    caseLinkedByUserId: text("case_linked_by_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
    lenderName: text("lender_name"),
    borrowerName: text("borrower_name"),
    isFavorite: booleanInteger("is_favorite").notNull().default(false),
    archivedAt: text("archived_at"),
    generatedAt: text("generated_at"),
    signedFileId: text("signed_file_id"),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("documents_owner_idx").on(table.ownerUserId),
    index("documents_status_idx").on(table.status),
    index("documents_updated_idx").on(table.updatedAt),
    index("documents_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    index("documents_case_idx").on(table.caseId, table.updatedAt),
    index("documents_workspace_case_idx").on(table.workspaceId, table.caseId, table.updatedAt),
    index("documents_plan_step_idx").on(table.planStepId),
  ],
);

export const documentCaseLinkEvents = pgTable("document_case_link_events", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  // The document FK owns lifecycle. Tenant/user/case IDs are immutable evidence
  // proved by the insert guard; sibling FKs would make account cascades order-dependent.
  workspaceId: text("workspace_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  fromCaseId: text("from_case_id"),
  toCaseId: text("to_case_id"),
  mutationVersion: bigint("mutation_version", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("document_case_link_events_version_uidx").on(table.documentId, table.mutationVersion),
  uniqueIndex("document_case_link_events_idempotency_uidx").on(table.workspaceId, table.ownerUserId, table.idempotencyKey),
  index("document_case_link_events_case_idx").on(table.workspaceId, table.toCaseId, table.createdAt),
  check("document_case_link_events_change_check", sql`NOT (${table.fromCaseId} IS ${table.toCaseId})`),
  check("document_case_link_events_version_check", sql`${table.mutationVersion} >= 1`),
  check("document_case_link_events_hash_check", sql`length(${table.requestHash}) = 64`),
  check("document_case_link_events_idempotency_check", sql`length(${table.idempotencyKey}) BETWEEN 16 AND 180`),
]);

export const documentAnswers = pgTable("document_answers", {
  documentId: text("document_id").primaryKey().references(() => documents.id, { onDelete: "cascade" }),
  answersJson: text("answers_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const documentCurrentContent = pgTable("document_current_content", {
  documentId: text("document_id").primaryKey().references(() => documents.id, { onDelete: "cascade" }),
  autoContent: text("auto_content").notNull(),
  finalContent: text("final_content").notNull(),
  manuallyEdited: booleanInteger("manually_edited").notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

export const documentFiles = pgTable(
  "document_files",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    r2Key: text("r2_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("document_files_document_idx").on(table.documentId),
    index("document_files_owner_idx").on(table.ownerUserId),
    index("document_files_workspace_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const documentAttachments = pgTable(
  "document_attachments",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull().references(() => documentFiles.id, { onDelete: "cascade" }),
    visibleToCollaborator: booleanInteger("visible_to_collaborator").notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("document_attachments_document_idx").on(table.documentId)],
);

export const documentCollaborators = pgTable(
  "document_collaborators",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id").notNull().references(() => userProfiles.id),
    role: text("role").notNull(),
    partyNumber: bigint("party_number", { mode: "number" }),
    permissionSetJson: text("permission_set_json"),
    invitationStatus: text("invitation_status").notNull().default("accepted"),
    approvalStatus: text("approval_status").notNull().default("pending"),
    canView: booleanInteger("can_view").notNull().default(true),
    canDownload: booleanInteger("can_download").notNull().default(false),
    status: text("status").notNull(),
    openedAt: text("opened_at"),
    confirmedAt: text("confirmed_at"),
    joinedAt: text("joined_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("document_collaborators_uidx").on(table.documentId, table.userId),
    index("document_collaborators_user_idx").on(table.userId),
  ],
);

export const documentInvitations = pgTable(
  "document_invitations",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id").notNull().references(() => userProfiles.id),
    targetUserId: text("target_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
    targetIdentifierHash: text("target_identifier_hash"),
    targetIdentifierKind: text("target_identifier_kind"),
    targetIdentifierLookupHash: text("target_identifier_lookup_hash"),
    targetIdentifierLookupKeyVersion: text("target_identifier_lookup_key_version"),
    role: text("role").notNull(),
    partyNumber: bigint("party_number", { mode: "number" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    acceptedAt: text("accepted_at"),
    declinedAt: text("declined_at"),
    revokedAt: text("revoked_at"),
    ...timestamps,
  },
  (table) => [
    index("document_invitations_document_idx").on(table.documentId),
    index("document_invitations_target_idx").on(table.targetUserId),
    index("document_invitations_target_lookup_idx")
      .on(
        table.targetIdentifierKind,
        table.targetIdentifierLookupKeyVersion,
        table.targetIdentifierLookupHash,
      )
      .where(sql`${table.targetIdentifierLookupHash} IS NOT NULL`),
  ],
);

export const documentPermissions = pgTable(
  "document_permissions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    grantedByUserId: text("granted_by_user_id").notNull().references(() => userProfiles.id),
    revokedAt: text("revoked_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("document_permissions_uidx").on(table.documentId, table.userId, table.permission)],
);

export const documentCommentThreads = pgTable(
  "document_comment_threads",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    anchorType: text("anchor_type").notNull().default("document"),
    anchorKey: text("anchor_key"),
    createdByUserId: text("created_by_user_id").notNull().references(() => userProfiles.id),
    status: text("status").notNull().default("open"),
    resolvedByUserId: text("resolved_by_user_id").references(() => userProfiles.id),
    resolvedAt: text("resolved_at"),
    reopenedAt: text("reopened_at"),
    ...timestamps,
  },
  (table) => [index("document_comment_threads_document_idx").on(table.documentId, table.status)],
);

export const documentComments = pgTable(
  "document_comments",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").notNull().references(() => userProfiles.id),
    threadId: text("thread_id").references(() => documentCommentThreads.id, { onDelete: "set null" }),
    parentCommentId: text("parent_comment_id"),
    body: text("body").notNull(),
    anchor: text("anchor"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
  },
  (table) => [index("document_comments_document_idx").on(table.documentId)],
);

export const documentSuggestions = pgTable(
  "document_suggestions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").notNull().references(() => userProfiles.id),
    fieldKey: text("field_key"),
    originalJson: text("original_json").notNull(),
    proposedJson: text("proposed_json").notNull(),
    status: text("status").notNull().default("pending"),
    decidedByUserId: text("decided_by_user_id").references(() => userProfiles.id),
    decidedAt: text("decided_at"),
    ...timestamps,
  },
  (table) => [index("document_suggestions_document_idx").on(table.documentId, table.status)],
);

export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    revision: bigint("revision", { mode: "number" }).notNull(),
    actorUserId: text("actor_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    changesJson: text("changes_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("document_revisions_uidx").on(table.documentId, table.revision)],
);

export const builderDocumentVersions = pgTable(
  "builder_document_versions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    version: bigint("version", { mode: "number" }).notNull(),
    documentRevision: bigint("document_revision", { mode: "number" }).notNull(),
    source: text("source").notNull(),
    r2Key: text("r2_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    idempotencyKeySha256: text("idempotency_key_sha256").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("builder_document_versions_number_uidx").on(table.documentId, table.version),
    uniqueIndex("builder_document_versions_revision_uidx").on(table.documentId, table.documentRevision),
    uniqueIndex("builder_document_versions_r2_uidx").on(table.r2Key),
    uniqueIndex("builder_document_versions_request_uidx").on(table.workspaceId, table.ownerUserId, table.idempotencyKeySha256),
    index("builder_document_versions_list_idx").on(table.documentId, table.status, table.version),
  ],
);

export const builderDocumentVersionRestoreEvents = pgTable(
  "builder_document_version_restore_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    sourceVersionId: text("source_version_id").notNull().references(() => builderDocumentVersions.id, { onDelete: "restrict" }),
    fromRevision: bigint("from_revision", { mode: "number" }).notNull(),
    toRevision: bigint("to_revision", { mode: "number" }).notNull(),
    contentSha256: text("content_sha256").notNull(),
    idempotencyKeySha256: text("idempotency_key_sha256").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("builder_document_version_restore_request_uidx").on(table.workspaceId, table.ownerUserId, table.idempotencyKeySha256),
    uniqueIndex("builder_document_version_restore_revision_uidx").on(table.documentId, table.toRevision),
    index("builder_document_version_restore_document_idx").on(table.documentId, table.createdAt),
  ],
);

export const documentApprovals = pgTable(
  "document_approvals",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    participantUserId: text("participant_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    revision: bigint("revision", { mode: "number" }).notNull(),
    approvedAt: text("approved_at"),
    revokedAt: text("revoked_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("document_approvals_uidx").on(table.documentId, table.participantUserId, table.revision)],
);

export const documentChangeProposals = pgTable(
  "document_change_proposals",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").notNull().references(() => userProfiles.id),
    oldText: text("old_text").notNull(),
    newText: text("new_text").notNull(),
    anchor: text("anchor"),
    ownerAccepted: booleanInteger("owner_accepted").notNull().default(false),
    collaboratorAccepted: booleanInteger("collaborator_accepted").notNull().default(false),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("document_change_proposals_document_idx").on(table.documentId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("notifications_user_idx").on(table.userId, table.createdAt)],
);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("activity_events_document_idx").on(table.documentId, table.createdAt)],
);

export const documentShareLinks = pgTable(
  "document_share_links",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    publicToken: text("public_token").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("document_share_links_document_idx").on(table.documentId)],
);

export const signedDocumentAccess = pgTable(
  "signed_document_access",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    collaboratorUserId: text("collaborator_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    viewAllowed: booleanInteger("view_allowed").notNull().default(false),
    downloadAllowed: booleanInteger("download_allowed").notNull().default(false),
    opened: booleanInteger("opened").notNull().default(false),
    restoredViewOnly: booleanInteger("restored_view_only").notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("signed_document_access_uidx").on(table.documentId, table.collaboratorUserId)],
);

export const standaloneSignedPdfShares = pgTable(
  "standalone_signed_pdf_shares",
  {
    id: text("id").primaryKey(),
    fileId: text("file_id").notNull().references(() => documentFiles.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    publicToken: text("public_token").notNull(),
    accessCode: text("access_code").notNull(),
    accessCodeHash: text("access_code_hash").notNull(),
    accessCodeDigits: bigint("access_code_digits", { mode: "number" }).notNull().default(4),
    verificationAttemptCount: bigint("verification_attempt_count", { mode: "number" }).notNull().default(0),
    verificationWindowStartedAt: text("verification_window_started_at"),
    verificationLockedUntil: text("verification_locked_until"),
    expiresAt: text("expires_at").notNull(),
    deactivatedAt: text("deactivated_at"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("standalone_signed_pdf_shares_file_idx").on(table.fileId)],
);

export const signedShareSessions = pgTable(
  "signed_share_sessions",
  {
    id: text("id").primaryKey(),
    shareId: text("share_id").notNull().references(() => standaloneSignedPdfShares.id, { onDelete: "cascade" }),
    sessionHash: text("session_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("signed_share_sessions_share_idx").on(table.shareId),
    index("signed_share_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const consultationRequests = pgTable(
  "consultation_requests",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    consultationType: text("consultation_type").notNull(),
    contextJson: text("context_json").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("consultation_requests_user_idx").on(table.requesterUserId)],
);

export const authOtpChallenges = pgTable("auth_otp_challenges", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  emailHash: text("email_hash").notNull(),
  emailLookupHash: text("email_lookup_hash"),
  emailLookupKeyVersion: text("email_lookup_key_version"),
  purpose: text("purpose").notNull(),
  locale: text("locale").notNull().default("ru"),
  accountType: text("account_type").notNull().default("individual"),
  codeSalt: text("code_salt").notNull(),
  codeHash: text("code_hash").notNull(),
  codeHmac: text("code_hmac"),
  codeKeyVersion: text("code_key_version"),
  attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
  maxAttempts: bigint("max_attempts", { mode: "number" }).notNull().default(5),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  invalidatedAt: text("invalidated_at"),
  verificationLockedUntil: text("verification_locked_until"),
  requestIpHash: text("request_ip_hash"),
  requestIpLookupHash: text("request_ip_lookup_hash"),
  requestIpLookupKeyVersion: text("request_ip_lookup_key_version"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("auth_otp_email_idx").on(table.emailHash, table.createdAt),
  index("auth_otp_email_lookup_idx").on(
    table.emailLookupKeyVersion,
    table.emailLookupHash,
    table.createdAt,
  ),
  index("auth_otp_email_verification_lock_idx").on(
    table.emailHash,
    table.verificationLockedUntil,
  ),
  index("auth_otp_keyed_email_verification_lock_idx").on(
    table.emailLookupKeyVersion,
    table.emailLookupHash,
    table.verificationLockedUntil,
  ),
  index("auth_otp_ip_created_idx").on(table.requestIpHash, table.createdAt),
  index("auth_otp_ip_lookup_created_idx").on(
    table.requestIpLookupKeyVersion,
    table.requestIpLookupHash,
    table.createdAt,
  ),
  index("auth_otp_expiry_idx").on(table.expiresAt),
]);

export const authDeviceContinuities = pgTable(
  "auth_device_continuities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => userProfiles.id, {
      onDelete: "cascade",
    }),
    tokenHmac: text("token_hmac").notNull(),
    keyVersion: text("key_version").notNull(),
    firstCountryCode: text("first_country_code"),
    firstRegionCode: text("first_region_code"),
    lastCountryCode: text("last_country_code"),
    lastRegionCode: text("last_region_code"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    check(
      "auth_device_continuities_hmac_check",
      sql`length(${table.tokenHmac}) = 43
        AND ${table.tokenHmac} NOT GLOB '*[^A-Za-z0-9_-]*'`,
    ),
    check(
      "auth_device_continuities_country_check",
      sql`(${table.firstCountryCode} IS NULL OR (
          length(${table.firstCountryCode}) = 2
          AND ${table.firstCountryCode} NOT GLOB '*[^A-Z0-9]*'
        )) AND (${table.lastCountryCode} IS NULL OR (
          length(${table.lastCountryCode}) = 2
          AND ${table.lastCountryCode} NOT GLOB '*[^A-Z0-9]*'
        ))`,
    ),
    check(
      "auth_device_continuities_region_check",
      sql`(${table.firstRegionCode} IS NULL OR (
          length(${table.firstRegionCode}) BETWEEN 1 AND 12
          AND ${table.firstRegionCode} NOT GLOB '*[^A-Z0-9-]*'
        )) AND (${table.lastRegionCode} IS NULL OR (
          length(${table.lastRegionCode}) BETWEEN 1 AND 12
          AND ${table.lastRegionCode} NOT GLOB '*[^A-Z0-9-]*'
        ))`,
    ),
    uniqueIndex("auth_device_continuities_lookup_uidx").on(
      table.userId,
      table.keyVersion,
      table.tokenHmac,
    ),
    index("auth_device_continuities_user_idx").on(
      table.userId,
      table.lastSeenAt,
    ),
  ],
);

export const authDevices = pgTable("auth_devices", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  userAgentHash: text("user_agent_hash"),
  continuityId: text("continuity_id").references(
    () => authDeviceContinuities.id,
    { onDelete: "set null" },
  ),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  revokedAt: text("revoked_at"),
}, (table) => [
  index("auth_devices_user_idx").on(table.userId, table.lastSeenAt),
  index("auth_devices_continuity_idx").on(table.continuityId),
]);

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  deviceId: text("device_id").references(() => authDevices.id, { onDelete: "set null" }),
  tokenHash: text("token_hash").notNull(),
  authMethod: text("auth_method").notNull().default("email_otp"),
  assuranceLevel: text("assurance_level").notNull().default("primary"),
  authenticatedAt: text("authenticated_at"),
  mfaVerifiedAt: text("mfa_verified_at"),
  expiresAt: text("expires_at").notNull(),
  idleExpiresAt: text("idle_expires_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
}, (table) => [
  uniqueIndex("auth_sessions_token_uidx").on(table.tokenHash),
  index("auth_sessions_user_idx").on(table.userId, table.expiresAt),
  index("auth_sessions_device_idx").on(table.deviceId, table.expiresAt),
]);

export const authSessionHandoffs = pgTable(
  "auth_session_handoffs",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id").notNull().references(() => userProfiles.id, {
      onDelete: "cascade",
    }),
    sourceSessionId: text("source_session_id").notNull().references(
      () => authSessions.id,
      { onDelete: "cascade" },
    ),
    sourceHost: text("source_host").notNull(),
    destinationHost: text("destination_host").notNull(),
    redirectPath: text("redirect_path").notNull(),
    rememberMe: bigint("remember_me", { mode: "number" }).notNull().default(0),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    consumedBySessionId: text("consumed_by_session_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "auth_session_handoffs_hash_check",
      sql`length(${table.tokenHash}) = 64 AND ${table.tokenHash} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "auth_session_handoffs_hosts_check",
      sql`${table.sourceHost} IN ('app.juro.uz','lawyer.juro.uz')
        AND ${table.destinationHost} IN ('app.juro.uz','lawyer.juro.uz')
        AND ${table.sourceHost} <> ${table.destinationHost}`,
    ),
    check(
      "auth_session_handoffs_redirect_check",
      sql`substr(${table.redirectPath}, 1, 1) = '/'
        AND substr(${table.redirectPath}, 1, 2) <> '//'`,
    ),
    check(
      "auth_session_handoffs_remember_check",
      sql`${table.rememberMe} IN (0,1)`,
    ),
    check(
      "auth_session_handoffs_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "auth_session_handoffs_consumed_check",
      sql`(${table.consumedAt} IS NULL AND ${table.consumedBySessionId} IS NULL)
        OR (${table.consumedAt} IS NOT NULL AND ${table.consumedBySessionId} IS NOT NULL)`,
    ),
    uniqueIndex("auth_session_handoffs_token_uidx").on(table.tokenHash),
    index("auth_session_handoffs_source_idx").on(
      table.sourceSessionId,
      table.expiresAt,
    ),
  ],
);

export const authSessionTokenHistory = pgTable(
  "auth_session_token_history",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => authSessions.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull().references(() => userProfiles.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(),
    rotationReason: text("rotation_reason").notNull(),
    rotatedAt: text("rotated_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    check(
      "auth_session_token_history_reason_check",
      sql`${table.rotationReason} IN ('mfa_elevation','email_change','mfa_disabled','manual','periodic')`,
    ),
    check(
      "auth_session_token_history_expiry_check",
      sql`${table.expiresAt} >= ${table.rotatedAt}`,
    ),
    uniqueIndex("auth_session_token_history_hash_uidx").on(table.tokenHash),
    index("auth_session_token_history_session_idx").on(
      table.sessionId,
      table.rotatedAt,
    ),
    index("auth_session_token_history_user_idx").on(
      table.userId,
      table.rotatedAt,
    ),
    index("auth_session_token_history_expiry_idx").on(table.expiresAt),
  ],
);

export const authSessionTokenReplays = pgTable(
  "auth_session_token_replays",
  {
    id: text("id").primaryKey(),
    tokenHistoryId: text("token_history_id").notNull().references(
      () => authSessionTokenHistory.id,
      { onDelete: "cascade" },
    ),
    sessionId: text("session_id").notNull().references(() => authSessions.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").notNull().references(() => userProfiles.id, {
      onDelete: "cascade",
    }),
    detectedAt: text("detected_at").notNull(),
    action: text("action").notNull(),
  },
  (table) => [
    check(
      "auth_session_token_replays_action_check",
      sql`${table.action} = 'session_and_device_revoked'`,
    ),
    uniqueIndex("auth_session_token_replays_history_uidx").on(
      table.tokenHistoryId,
    ),
    index("auth_session_token_replays_user_idx").on(
      table.userId,
      table.detectedAt,
    ),
    index("auth_session_token_replays_session_idx").on(
      table.sessionId,
      table.detectedAt,
    ),
  ],
);

export const emailChangeChallenges = pgTable(
  "email_change_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => userProfiles.id, {
      onDelete: "cascade",
    }),
    sessionId: text("session_id").references(() => authSessions.id, {
      onDelete: "set null",
    }),
    currentEmailHash: text("current_email_hash").notNull(),
    currentEmailLookupHash: text("current_email_lookup_hash"),
    currentEmailLookupKeyVersion: text(
      "current_email_lookup_key_version",
    ),
    newEmail: text("new_email").notNull(),
    newEmailCiphertext: text("new_email_ciphertext"),
    newEmailIv: text("new_email_iv"),
    newEmailKeyVersion: text("new_email_key_version"),
    newEmailLookupHash: text("new_email_lookup_hash"),
    newEmailLookupKeyVersion: text("new_email_lookup_key_version"),
    currentCodeSalt: text("current_code_salt").notNull(),
    currentCodeHash: text("current_code_hash").notNull(),
    currentCodeHmac: text("current_code_hmac"),
    currentCodeKeyVersion: text("current_code_key_version"),
    newCodeSalt: text("new_code_salt").notNull(),
    newCodeHash: text("new_code_hash").notNull(),
    newCodeHmac: text("new_code_hmac"),
    newCodeKeyVersion: text("new_code_key_version"),
    locale: text("locale").notNull(),
    attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
    maxAttempts: bigint("max_attempts", { mode: "number" }).notNull().default(5),
    expiresAt: text("expires_at").notNull(),
    codesQueuedAt: text("codes_queued_at"),
    consumedAt: text("consumed_at"),
    consumedByOperationId: text("consumed_by_operation_id"),
    invalidatedAt: text("invalidated_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "email_change_challenges_locale_check",
      sql`${table.locale} IN ('ru','uz','en')`,
    ),
    check(
      "email_change_challenges_attempts_check",
      sql`${table.attemptCount} >= 0 AND ${table.attemptCount} <= ${table.maxAttempts} AND ${table.maxAttempts} BETWEEN 1 AND 10`,
    ),
    uniqueIndex("email_change_challenges_operation_uidx").on(
      table.consumedByOperationId,
    ),
    uniqueIndex("email_change_challenges_active_user_uidx")
      .on(table.userId)
      .where(
        sql`${table.consumedAt} IS NULL AND ${table.invalidatedAt} IS NULL`,
      ),
    index("email_change_challenges_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("email_change_challenges_new_email_lookup_idx").on(
      table.newEmailLookupKeyVersion,
      table.newEmailLookupHash,
      table.createdAt,
    ),
    index("email_change_challenges_expiry_idx").on(table.expiresAt),
  ],
);

export const securityEmailJobs = pgTable(
  "security_email_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => userProfiles.id, {
      onDelete: "cascade",
    }),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    challengeId: text("challenge_id").references(
      () => emailChangeChallenges.id,
      { onDelete: "cascade" },
    ),
    authOtpChallengeId: text("auth_otp_challenge_id").references(
      () => authOtpChallenges.id,
      { onDelete: "cascade" },
    ),
    eventType: text("event_type").notNull(),
    locale: text("locale").notNull(),
    recipientCiphertext: text("recipient_ciphertext").notNull(),
    recipientIv: text("recipient_iv").notNull(),
    recipientKeyVersion: text("recipient_key_version").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
    providerMessageId: text("provider_message_id"),
    sentAt: text("sent_at"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "security_email_jobs_event_check",
      sql`${table.eventType} IN ('email_changed_previous_address','password_changed')`,
    ),
    check(
      "security_email_jobs_locale_check",
      sql`${table.locale} IN ('ru','uz','en')`,
    ),
    check(
      "security_email_jobs_context_check",
      sql`(
        (${table.eventType} = 'email_changed_previous_address' AND ${table.challengeId} IS NOT NULL AND ${table.authOtpChallengeId} IS NULL)
        OR (${table.eventType} = 'password_changed' AND ${table.challengeId} IS NULL AND ${table.authOtpChallengeId} IS NOT NULL)
      )`,
    ),
    check(
      "security_email_jobs_status_check",
      sql`${table.status} IN ('pending','sending','retrying','sent','failed')`,
    ),
    check(
      "security_email_jobs_attempts_check",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "security_email_jobs_recipient_check",
      sql`length(${table.recipientCiphertext}) >= 22 AND length(${table.recipientIv}) = 16 AND length(${table.recipientKeyVersion}) BETWEEN 1 AND 32`,
    ),
    check(
      "security_email_jobs_evidence_check",
      sql`(
        (${table.status} IN ('pending','sending') AND ${table.providerMessageId} IS NULL AND ${table.sentAt} IS NULL AND ${table.errorCode} IS NULL)
        OR (${table.status} IN ('retrying','failed') AND ${table.providerMessageId} IS NULL AND ${table.sentAt} IS NULL AND ${table.errorCode} IS NOT NULL)
        OR (${table.status} = 'sent' AND ${table.providerMessageId} IS NOT NULL AND ${table.sentAt} IS NOT NULL AND ${table.errorCode} IS NULL)
      )`,
    ),
    uniqueIndex("security_email_jobs_challenge_event_uidx").on(
      table.challengeId,
      table.eventType,
    ),
    uniqueIndex("security_email_jobs_auth_otp_event_uidx").on(
      table.authOtpChallengeId,
      table.eventType,
    ),
    index("security_email_jobs_status_idx").on(
      table.status,
      table.updatedAt,
    ),
    index("security_email_jobs_user_idx").on(table.userId, table.createdAt),
  ],
);

export const securityNotificationJobs = pgTable(
  "security_notification_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => userProfiles.id, {
      onDelete: "cascade",
    }),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id").notNull(),
    eventType: text("event_type").notNull(),
    deliveryChannel: text("delivery_channel").notNull().default("email"),
    locale: text("locale").notNull(),
    recipientCiphertext: text("recipient_ciphertext").notNull(),
    recipientIv: text("recipient_iv").notNull(),
    recipientKeyVersion: text("recipient_key_version").notNull(),
    deviceName: text("device_name").notNull(),
    countryCode: text("country_code"),
    regionCode: text("region_code"),
    status: text("status").notNull().default("pending"),
    attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
    providerMessageId: text("provider_message_id"),
    sentAt: text("sent_at"),
    errorCode: text("error_code"),
    occurredAt: text("occurred_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "security_notification_jobs_event_check",
      sql`${table.eventType} IN ('login_new_device','login_new_region')`,
    ),
    check(
      "security_notification_jobs_channel_check",
      sql`${table.deliveryChannel} = 'email'`,
    ),
    check(
      "security_notification_jobs_locale_check",
      sql`${table.locale} IN ('ru','uz','en')`,
    ),
    check(
      "security_notification_jobs_status_check",
      sql`${table.status} IN ('pending','sending','retrying','sent','failed')`,
    ),
    check(
      "security_notification_jobs_attempts_check",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "security_notification_jobs_context_check",
      sql`length(${table.sessionId}) BETWEEN 1 AND 128
        AND length(${table.deviceName}) BETWEEN 1 AND 80
        AND (${table.countryCode} IS NULL OR (
          length(${table.countryCode}) = 2
          AND ${table.countryCode} NOT GLOB '*[^A-Z0-9]*'
        ))
        AND (${table.regionCode} IS NULL OR (
          length(${table.regionCode}) BETWEEN 1 AND 12
          AND ${table.regionCode} NOT GLOB '*[^A-Z0-9-]*'
        ))`,
    ),
    check(
      "security_notification_jobs_recipient_check",
      sql`length(${table.recipientCiphertext}) >= 22
        AND length(${table.recipientIv}) = 16
        AND length(${table.recipientKeyVersion}) BETWEEN 1 AND 32`,
    ),
    check(
      "security_notification_jobs_evidence_check",
      sql`(
        (${table.status} IN ('pending','sending') AND ${table.providerMessageId} IS NULL AND ${table.sentAt} IS NULL AND ${table.errorCode} IS NULL)
        OR (${table.status} IN ('retrying','failed') AND ${table.providerMessageId} IS NULL AND ${table.sentAt} IS NULL AND ${table.errorCode} IS NOT NULL)
        OR (${table.status} = 'sent' AND ${table.providerMessageId} IS NOT NULL AND ${table.sentAt} IS NOT NULL AND ${table.errorCode} IS NULL)
      )`,
    ),
    uniqueIndex("security_notification_jobs_session_event_uidx").on(
      table.sessionId,
      table.eventType,
      table.deliveryChannel,
    ),
    index("security_notification_jobs_status_idx").on(
      table.status,
      table.updatedAt,
    ),
    index("security_notification_jobs_user_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);
export const authTotpCredentials = pgTable("auth_totp_credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  secretCiphertext: text("secret_ciphertext").notNull(),
  secretIv: text("secret_iv").notNull(),
  keyVersion: text("key_version").notNull(),
  algorithm: text("algorithm").notNull().default("SHA1"),
  digits: bigint("digits", { mode: "number" }).notNull().default(6),
  periodSeconds: bigint("period_seconds", { mode: "number" }).notNull().default(30),
  verificationAttemptCount: bigint("verification_attempt_count", { mode: "number" }).notNull().default(0),
  verificationMaxAttempts: bigint("verification_max_attempts", { mode: "number" }).notNull().default(5),
  lastUsedStep: bigint("last_used_step", { mode: "number" }),
  backupBatchId: text("backup_batch_id"),
  backupKeyVersion: text("backup_key_version"),
  enrollmentExpiresAt: text("enrollment_expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  verifiedAt: text("verified_at"),
  disabledAt: text("disabled_at"),
}, (table) => [
  check(
    "auth_totp_status_check",
    sql`${table.status} IN ('pending','active','disabled')`,
  ),
  check("auth_totp_algorithm_check", sql`${table.algorithm} = 'SHA1'`),
  check("auth_totp_digits_check", sql`${table.digits} = 6`),
  check("auth_totp_period_check", sql`${table.periodSeconds} = 30`),
  check(
    "auth_totp_attempts_check",
    sql`${table.verificationAttemptCount} >= 0 AND ${table.verificationMaxAttempts} BETWEEN 1 AND 10`,
  ),
  index("auth_totp_user_status_idx").on(table.userId, table.status),
  uniqueIndex("auth_totp_live_user_uidx")
    .on(table.userId)
    .where(sql`${table.status} IN ('pending','active')`),
]);

export const authBackupCodes = pgTable("auth_backup_codes", {
  id: text("id").primaryKey(),
  credentialId: text("credential_id").notNull().references(() => authTotpCredentials.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  batchId: text("batch_id").notNull(),
  codeHmac: text("code_hmac").notNull(),
  keyVersion: text("key_version").notNull(),
  usedAt: text("used_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("auth_backup_codes_hmac_uidx").on(table.codeHmac),
  index("auth_backup_codes_user_batch_idx").on(
    table.userId,
    table.batchId,
    table.usedAt,
  ),
  index("auth_backup_codes_credential_idx").on(
    table.credentialId,
    table.createdAt,
  ),
]);

export const authMfaChallenges = pgTable("auth_mfa_challenges", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().references(() => authTotpCredentials.id, { onDelete: "cascade" }),
  emailOtpChallengeId: text("email_otp_challenge_id").notNull().references(() => authOtpChallenges.id, { onDelete: "cascade" }),
  primaryAuthMethod: text("primary_auth_method").notNull().default("email_otp"),
  purpose: text("purpose").notNull().default("login"),
  attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
  maxAttempts: bigint("max_attempts", { mode: "number" }).notNull().default(5),
  requestUserAgentHmac: text("request_user_agent_hmac"),
  evidenceKeyVersion: text("evidence_key_version"),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  invalidatedAt: text("invalidated_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check(
    "auth_mfa_challenges_purpose_check",
    sql`${table.purpose} IN ('login')`,
  ),
  check(
    "auth_mfa_challenges_attempts_check",
    sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 10`,
  ),
  uniqueIndex("auth_mfa_challenges_token_uidx").on(table.tokenHash),
  uniqueIndex("auth_mfa_challenges_email_otp_uidx").on(
    table.emailOtpChallengeId,
  ),
  uniqueIndex("auth_mfa_challenges_active_user_uidx")
    .on(table.userId, table.purpose)
    .where(sql`${table.consumedAt} IS NULL AND ${table.invalidatedAt} IS NULL`),
  index("auth_mfa_challenges_expiry_idx").on(table.expiresAt),
]);

export const authMfaAttemptReservations = pgTable(
  "auth_mfa_attempt_reservations",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id").notNull().references(
      () => authMfaChallenges.id,
      { onDelete: "cascade" },
    ),
    userScopeKey: text("user_scope_key").notNull(),
    ipScopeKey: text("ip_scope_key"),
    expiresAt: text("expires_at").notNull(),
    failureClaimNonce: text("failure_claim_nonce"),
    failureClaimedAt: text("failure_claimed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "auth_mfa_attempt_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "auth_mfa_attempt_claim_check",
      sql`(${table.failureClaimNonce} IS NULL AND ${table.failureClaimedAt} IS NULL)
        OR (${table.failureClaimNonce} IS NOT NULL AND ${table.failureClaimedAt} >= ${table.createdAt})`,
    ),
    index("auth_mfa_attempt_challenge_expiry_idx").on(
      table.challengeId,
      table.expiresAt,
    ),
    index("auth_mfa_attempt_user_expiry_idx").on(
      table.userScopeKey,
      table.expiresAt,
    ),
    index("auth_mfa_attempt_ip_expiry_idx").on(
      table.ipScopeKey,
      table.expiresAt,
    ),
    index("auth_mfa_attempt_expiry_idx").on(table.expiresAt),
  ],
);

export const authMfaFactorClaims = pgTable("auth_mfa_factor_claims", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  credentialId: text("credential_id").notNull().references(() => authTotpCredentials.id, { onDelete: "cascade" }),
  factorType: text("factor_type").notNull(),
  factorKey: text("factor_key").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check(
    "auth_mfa_claims_factor_type_check",
    sql`${table.factorType} IN ('totp','backup_code')`,
  ),
  uniqueIndex("auth_mfa_claims_operation_uidx").on(table.operationId),
  uniqueIndex("auth_mfa_claims_factor_uidx").on(
    table.credentialId,
    table.factorType,
    table.factorKey,
  ),
  index("auth_mfa_claims_created_idx").on(table.createdAt),
]);

export const securityEvents = pgTable("security_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id"),
  deviceId: text("device_id"),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull().default("info"),
  authSource: text("auth_source"),
  assuranceLevel: text("assurance_level"),
  ipHash: text("ip_hash"),
  userAgentHash: text("user_agent_hash"),
  metadataJson: text("metadata_json"),
  previousHash: text("previous_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("security_events_hash_uidx").on(table.eventHash),
  uniqueIndex("security_events_chain_uidx").on(table.userId, table.previousHash),
  index("security_events_user_idx").on(table.userId, table.createdAt),
  index("security_events_type_idx").on(table.eventType, table.createdAt),
]);

export const platformStaffAssignments = pgTable(
  "platform_staff_assignments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => userProfiles.id),
    role: text("role").notNull(),
    grantSource: text("grant_source").notNull(),
    grantedByUserId: text("granted_by_user_id").references(
      () => userProfiles.id,
    ),
    grantReason: text("grant_reason").notNull(),
    grantedAt: text("granted_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    revocationSource: text("revocation_source"),
    revokedByUserId: text("revoked_by_user_id").references(
      () => userProfiles.id,
    ),
    revocationReason: text("revocation_reason"),
    ...timestamps,
  },
  (table) => [
    check(
      "platform_staff_assignments_role_check",
      sql`${table.role} IN ('administrator','support','legal_reviewer')`,
    ),
    check(
      "platform_staff_assignments_grant_source_check",
      sql`${table.grantSource} IN ('operator_bootstrap','administrator')`,
    ),
    check(
      "platform_staff_assignments_grant_actor_check",
      sql`(
        (${table.grantSource} = 'operator_bootstrap'
          AND ${table.grantedByUserId} IS NULL)
        OR
        (${table.grantSource} = 'administrator'
          AND ${table.grantedByUserId} IS NOT NULL
          AND ${table.grantedByUserId} <> ${table.userId})
      )`,
    ),
    check(
      "platform_staff_assignments_grant_reason_check",
      sql`length(trim(${table.grantReason})) BETWEEN 1 AND 500`,
    ),
    check(
      "platform_staff_assignments_time_check",
      sql`${table.expiresAt} > ${table.grantedAt}
        AND ${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      "platform_staff_assignments_revocation_check",
      sql`(
        ${table.revokedAt} IS NULL
        AND ${table.revocationSource} IS NULL
        AND ${table.revokedByUserId} IS NULL
        AND ${table.revocationReason} IS NULL
      ) OR (
        ${table.revokedAt} IS NOT NULL
        AND ${table.revocationSource} IN ('operator','administrator')
        AND (
          (${table.revocationSource} = 'operator'
            AND ${table.revokedByUserId} IS NULL)
          OR
          (${table.revocationSource} = 'administrator'
            AND ${table.revokedByUserId} IS NOT NULL)
        )
        AND length(trim(${table.revocationReason})) BETWEEN 1 AND 500
        AND ${table.revokedAt} >= ${table.grantedAt}
      )`,
    ),
    uniqueIndex("platform_staff_assignments_active_uidx")
      .on(table.userId, table.role)
      .where(sql`${table.revokedAt} IS NULL`),
    index("platform_staff_assignments_user_idx").on(
      table.userId,
      table.expiresAt,
    ),
    index("platform_staff_assignments_role_idx").on(
      table.role,
      table.expiresAt,
    ),
  ],
);

export const platformStaffRoleEvents = pgTable(
  "platform_staff_role_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull().references(
      () => userProfiles.id,
    ),
    actorSessionId: text("actor_session_id").notNull(),
    actorAssignmentId: text("actor_assignment_id").notNull().references(
      () => platformStaffAssignments.id,
    ),
    subjectUserId: text("subject_user_id").notNull().references(
      () => userProfiles.id,
    ),
    subjectAssignmentId: text("subject_assignment_id").notNull().references(
      () => platformStaffAssignments.id,
    ),
    eventType: text("event_type").notNull(),
    capability: text("capability").notNull(),
    role: text("role").notNull(),
    reason: text("reason").notNull(),
    actorMfaVerifiedAt: text("actor_mfa_verified_at").notNull(),
    previousHash: text("previous_hash").notNull(),
    eventHash: text("event_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "platform_staff_role_events_type_check",
      sql`${table.eventType} IN ('staff.role.granted','staff.role.revoked')`,
    ),
    check(
      "platform_staff_role_events_capability_check",
      sql`${table.capability} = 'staff.roles.manage'`,
    ),
    check(
      "platform_staff_role_events_role_check",
      sql`${table.role} IN ('administrator','support','legal_reviewer')`,
    ),
    check(
      "platform_staff_role_events_reason_check",
      sql`length(trim(${table.reason})) BETWEEN 1 AND 500`,
    ),
    check(
      "platform_staff_role_events_hash_check",
      sql`length(${table.previousHash}) = 64
        AND length(${table.eventHash}) = 64`,
    ),
    check(
      "platform_staff_role_events_mfa_time_check",
      sql`${table.actorMfaVerifiedAt} <= ${table.createdAt}`,
    ),
    uniqueIndex("platform_staff_role_events_hash_uidx").on(
      table.eventHash,
    ),
    uniqueIndex("platform_staff_role_events_chain_uidx").on(
      table.actorUserId,
      table.previousHash,
    ),
    uniqueIndex("platform_staff_role_events_assignment_type_uidx").on(
      table.subjectAssignmentId,
      table.eventType,
    ),
    index("platform_staff_role_events_actor_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
    index("platform_staff_role_events_subject_idx").on(
      table.subjectUserId,
      table.createdAt,
    ),
  ],
);

export const policyDocuments = pgTable("policy_documents", {
  id: text("id").primaryKey(),
  documentKey: text("document_key").notNull(),
  documentVersion: text("document_version").notNull(),
  locale: text("locale").notNull(),
  contentSha256: text("content_sha256").notNull(),
  status: text("status").notNull(),
  effectiveAt: text("effective_at"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("policy_documents_locale_check", sql`${table.locale} IN ('ru','uz','en')`),
  check(
    "policy_documents_status_check",
    sql`${table.status} IN ('draft','approved','superseded')`,
  ),
  check(
    "policy_documents_sha256_check",
    sql`length(${table.contentSha256}) = 64`,
  ),
  uniqueIndex("policy_documents_version_uidx").on(
    table.documentKey,
    table.documentVersion,
    table.locale,
  ),
  index("policy_documents_status_idx").on(
    table.status,
    table.documentKey,
  ),
]);

export const userAcceptances = pgTable("user_acceptances", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  policyDocumentId: text("policy_document_id").references(() => policyDocuments.id, { onDelete: "restrict" }),
  documentKey: text("document_key").notNull(),
  documentVersion: text("document_version").notNull(),
  locale: text("locale"),
  contentSha256: text("content_sha256"),
  acceptanceMethod: text("acceptance_method"),
  authSource: text("auth_source"),
  sessionId: text("session_id").references(() => authSessions.id, { onDelete: "set null" }),
  evidenceJson: text("evidence_json"),
  acceptedAt: text("accepted_at").notNull(),
}, (table) => [
  uniqueIndex("user_acceptances_uidx").on(
    table.userId,
    table.documentKey,
    table.documentVersion,
  ),
  index("user_acceptances_policy_idx").on(
    table.policyDocumentId,
    table.acceptedAt,
  ),
]);

export const cases = pgTable("cases", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }), ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  accountType: text("account_type").notNull(), locale: text("locale").notNull(), title: text("title").notNull(), description: text("description"), legalArea: text("legal_area").notNull(),
  status: text("status").notNull().default("open"), currentRevision: bigint("current_revision", { mode: "number" }).notNull().default(1), nextDeadlineAt: text("next_deadline_at"), archivedAt: text("archived_at"),
  lifecycleRevision: bigint("lifecycle_revision", { mode: "number" }).notNull().default(0), completedAt: text("completed_at"), completedByUserId: text("completed_by_user_id"), archivedByUserId: text("archived_by_user_id"), ...timestamps,
}, (table) => [index("cases_owner_idx").on(table.ownerUserId, table.updatedAt), index("cases_workspace_idx").on(table.workspaceId, table.updatedAt)]);

export const caseEvents = pgTable("case_events", {
  id: text("id").primaryKey(), caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }), actorUserId: text("actor_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(), metadataJson: text("metadata_json"), createdAt: text("created_at").notNull(),
}, (table) => [index("case_events_case_idx").on(table.caseId, table.createdAt)]);

export const caseLifecycleEvents = pgTable("case_lifecycle_events", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  action: text("action").notNull(), fromStatus: text("from_status").notNull(), toStatus: text("to_status").notNull(),
  fromArchivedAt: text("from_archived_at"), toArchivedAt: text("to_archived_at"),
  unresolvedTaskCount: bigint("unresolved_task_count", { mode: "number" }).notNull(), unresolvedPlanStepCount: bigint("unresolved_plan_step_count", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(), lifecycleRevision: bigint("lifecycle_revision", { mode: "number" }).notNull(),
  previousHash: text("previous_hash").notNull(), eventHash: text("event_hash").notNull(), createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("case_lifecycle_event_hash_uidx").on(table.eventHash),
  uniqueIndex("case_lifecycle_idempotency_uidx").on(table.caseId, table.idempotencyKey),
  uniqueIndex("case_lifecycle_revision_uidx").on(table.caseId, table.lifecycleRevision),
  uniqueIndex("case_lifecycle_chain_uidx").on(table.caseId, table.previousHash),
  index("case_lifecycle_workspace_created_idx").on(table.workspaceId, table.createdAt),
]);

export const actionPlans = pgTable("action_plans", {
  id: text("id").primaryKey(), caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }), createdByUserId: text("created_by_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  title: text("title").notNull(), status: text("status").notNull().default("in_progress"), progressPercent: bigint("progress_percent", { mode: "number" }).notNull().default(0), currentRevision: bigint("current_revision", { mode: "number" }).notNull().default(1), ...timestamps,
}, (table) => [uniqueIndex("action_plans_case_uidx").on(table.caseId)]);

// Append-only evidence of user-confirmed action-plan changes. Current editable
// state remains in action_plans/action_plan_steps; history reads this table.
export const actionPlanVersions = pgTable("action_plan_versions", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull().references(() => actionPlans.id, { onDelete: "cascade" }),
  version: bigint("version", { mode: "number" }).notNull(),
  createdByUserId: text("created_by_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("action_plan_versions_plan_version_uidx").on(table.planId, table.version),
  index("action_plan_versions_plan_created_idx").on(table.planId, table.createdAt),
]);
export const actionPlanSteps = pgTable("action_plan_steps", {
  id: text("id").primaryKey(), planId: text("plan_id").notNull().references(() => actionPlans.id, { onDelete: "cascade" }), ordinal: bigint("ordinal", { mode: "number" }).notNull(), title: text("title").notNull(),
  description: text("description"), status: text("status").notNull().default("not_started"), deadlineType: text("deadline_type").notNull().default("calendar_days"), dueAt: text("due_at"),
  assigneeUserId: text("assignee_user_id").references(() => userProfiles.id, { onDelete: "set null" }), actionType: text("action_type"), templateCode: text("template_code"), completedAt: text("completed_at"),
  revision: bigint("revision", { mode: "number" }).notNull().default(1), ...timestamps,
}, (table) => [uniqueIndex("action_plan_steps_order_uidx").on(table.planId, table.ordinal), index("action_plan_steps_due_idx").on(table.dueAt, table.status)]);

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }), planStepId: text("plan_step_id").references(() => actionPlanSteps.id, { onDelete: "set null" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }), title: text("title").notNull(), description: text("description"), legalBasis: text("legal_basis"), sourceDate: text("source_date"),
  dueAt: text("due_at"), safeDueAt: text("safe_due_at"), calculationMethod: text("calculation_method"), deadlineType: text("deadline_type").notNull().default("calendar_days"), status: text("status").notNull().default("planned"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), completedAt: text("completed_at"),
}, (table) => [uniqueIndex("tasks_plan_step_uidx").on(table.planStepId), index("tasks_workspace_due_idx").on(table.workspaceId, table.dueAt, table.status), index("tasks_case_idx").on(table.caseId, table.updatedAt)]);

export const taskReminders = pgTable("task_reminders", {
  id: text("id").primaryKey(), taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }), channel: text("channel").notNull().default("in_app"), reminderAt: text("reminder_at").notNull(),
  status: text("status").notNull().default("pending"), idempotencyKey: text("idempotency_key").notNull(), sentAt: text("sent_at"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("task_reminders_idempotency_uidx").on(table.idempotencyKey), index("task_reminders_due_idx").on(table.status, table.reminderAt)]);
export const lawyerProfiles = pgTable("lawyer_profiles", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }), displayName: text("display_name").notNull(), specialtiesJson: text("specialties_json").notNull().default("[]"), languagesJson: text("languages_json").notNull().default("[]"), status: text("status").notNull().default("pending"), marketplaceStatus: text("marketplace_status").notNull().default("profile_incomplete"), publicApprovedAt: text("public_approved_at"), juroApprovalStatus: text("juro_approval_status").notNull().default("not_approved"), juroApprovedAt: text("juro_approved_at"), juroApprovedByUserId: text("juro_approved_by_user_id"), topLawyerStatus: text("top_lawyer_status").notNull().default("not_featured"), topLawyerCriteria: text("top_lawyer_criteria"), topLawyerAt: text("top_lawyer_at"), experienceYears: bigint("experience_years", { mode: "number" }), priceDescription: text("price_description"), consultationDurationMinutes: bigint("consultation_duration_minutes", { mode: "number" }).notNull().default(60), additionalServicesJson: text("additional_services_json").notNull().default("[]"), availabilityStatus: text("availability_status").notNull().default("unknown"), nextAvailableAt: text("next_available_at"), advocateStatus: text("advocate_status").notNull().default("not_declared"), firmName: text("firm_name"), bio: text("bio"), profileRevision: bigint("profile_revision", { mode: "number" }).notNull().default(1), city: text("city"), region: text("region"), education: text("education"), consultationFormatsJson: text("consultation_formats_json").notNull().default("[]"), profilePhotoKey: text("profile_photo_key"), profilePhotoMime: text("profile_photo_mime"), profilePhotoSha256: text("profile_photo_sha256"), profilePhotoSizeBytes: bigint("profile_photo_size_bytes", { mode: "number" }), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("lawyer_profiles_user_uidx").on(table.userId), index("lawyer_profiles_status_idx").on(table.status, table.updatedAt), index("lawyer_profiles_trust_designations_idx").on(table.juroApprovalStatus, table.topLawyerStatus, table.marketplaceStatus), check("lawyer_profiles_consultation_duration_check", sql`${table.consultationDurationMinutes} BETWEEN 15 AND 480`)]);

export const lawyerAvailabilityRules = pgTable("lawyer_availability_rules", {
  id: text("id").primaryKey(),
  lawyerProfileId: text("lawyer_profile_id").notNull().references(() => lawyerProfiles.id, { onDelete: "cascade" }),
  weekday: bigint("weekday", { mode: "number" }).notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  timezone: text("timezone").notNull().default("Asia/Tashkent"),
  status: text("status").notNull().default("active"),
  ...timestamps,
}, (table) => [
  uniqueIndex("lawyer_availability_rules_slot_uidx").on(table.lawyerProfileId, table.weekday, table.startsAt, table.endsAt),
  index("lawyer_availability_rules_profile_idx").on(table.lawyerProfileId, table.status, table.weekday),
  check("lawyer_availability_rules_weekday_check", sql`${table.weekday} BETWEEN 1 AND 7`),
  check("lawyer_availability_rules_time_check", sql`${table.startsAt} < ${table.endsAt}`),
]);

export const lawyerUnavailabilityPeriods = pgTable("lawyer_unavailability_periods", {
  id: text("id").primaryKey(),
  lawyerProfileId: text("lawyer_profile_id").notNull().references(() => lawyerProfiles.id, { onDelete: "cascade" }),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  reason: text("reason"),
  ...timestamps,
}, (table) => [
  index("lawyer_unavailability_periods_profile_idx").on(table.lawyerProfileId, table.startsAt, table.endsAt),
  check("lawyer_unavailability_periods_time_check", sql`${table.startsAt} < ${table.endsAt}`),
]);

export const lawyerProfileTrustDesignations = pgTable("lawyer_profile_trust_designations", {
  id: text("id").primaryKey(), lawyerProfileId: text("lawyer_profile_id").notNull().references(() => lawyerProfiles.id, { onDelete: "cascade" }), moderatorUserId: text("moderator_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }), designation: text("designation").notNull(), decision: text("decision").notNull(), reason: text("reason").notNull(), criteria: text("criteria"), createdAt: text("created_at").notNull(),
}, (table) => [index("lawyer_profile_trust_designations_profile_idx").on(table.lawyerProfileId, table.createdAt)]);

/** Immutable operational decisions that restrict marketplace publication/work. */
export const lawyerProfileLifecycleEvents = pgTable("lawyer_profile_lifecycle_events", {
  id: text("id").primaryKey(),
  lawyerProfileId: text("lawyer_profile_id").notNull().references(() => lawyerProfiles.id, { onDelete: "cascade" }),
  fromProfileRevision: bigint("from_profile_revision", { mode: "number" }).notNull(),
  toProfileRevision: bigint("to_profile_revision", { mode: "number" }).notNull(),
  actorUserId: text("actor_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  fromProfileStatus: text("from_profile_status").notNull(),
  toProfileStatus: text("to_profile_status").notNull(),
  fromMarketplaceStatus: text("from_marketplace_status").notNull(),
  toMarketplaceStatus: text("to_marketplace_status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("lawyer_profile_lifecycle_profile_idx").on(table.lawyerProfileId, table.createdAt),
  index("lawyer_profile_lifecycle_actor_idx").on(table.actorUserId, table.createdAt),
]);

export const lawyerRequests = pgTable("lawyer_requests", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }), requesterUserId: text("requester_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }), lawyerProfileId: text("lawyer_profile_id").references(() => lawyerProfiles.id, { onDelete: "set null" }), status: text("status").notNull().default("requested"), anonymizedSummary: text("anonymized_summary").notNull(), requestedScopeJson: text("requested_scope_json").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [index("lawyer_requests_workspace_idx").on(table.workspaceId, table.updatedAt), index("lawyer_requests_lawyer_idx").on(table.lawyerProfileId, table.status)]);

export const lawyerConsultations = pgTable("lawyer_consultations", {
  id: text("id").primaryKey(),
  lawyerRequestId: text("lawyer_request_id").notNull().references(() => lawyerRequests.id, { onDelete: "cascade" }),
  lawyerProfileId: text("lawyer_profile_id").notNull().references(() => lawyerProfiles.id, { onDelete: "cascade" }),
  clientUserId: text("client_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  timezone: text("timezone").notNull().default("Asia/Tashkent"),
  format: text("format").notNull().default("video"),
  status: text("status").notNull().default("proposed"),
  internalNote: text("internal_note"),
  resultNote: text("result_note"),
  ...timestamps,
}, (table) => [
  uniqueIndex("lawyer_consultations_request_uidx").on(table.lawyerRequestId),
  index("lawyer_consultations_lawyer_time_idx").on(table.lawyerProfileId, table.startsAt, table.status),
  index("lawyer_consultations_client_time_idx").on(table.clientUserId, table.startsAt, table.status),
  check("lawyer_consultations_time_check", sql`${table.startsAt} < ${table.endsAt}`),
]);

export const conflictChecks = pgTable("conflict_checks", {
  id: text("id").primaryKey(), lawyerRequestId: text("lawyer_request_id").notNull().references(() => lawyerRequests.id, { onDelete: "cascade" }), lawyerProfileId: text("lawyer_profile_id").notNull().references(() => lawyerProfiles.id, { onDelete: "cascade" }), status: text("status").notNull().default("pending"), reviewedAt: text("reviewed_at"), reviewedByUserId: text("reviewed_by_user_id").references(() => userProfiles.id, { onDelete: "set null" }), createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("conflict_checks_request_lawyer_uidx").on(table.lawyerRequestId, table.lawyerProfileId)]);

export const lawyerAccessGrants = pgTable("lawyer_access_grants", {
  id: text("id").primaryKey(), lawyerRequestId: text("lawyer_request_id").notNull().references(() => lawyerRequests.id, { onDelete: "cascade" }), caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }), lawyerUserId: text("lawyer_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }), grantedByUserId: text("granted_by_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }), expiresAt: text("expires_at"), revokedAt: text("revoked_at"), revokeReason: text("revoke_reason"), createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("lawyer_access_grants_request_uidx").on(table.lawyerRequestId), index("lawyer_access_grants_case_idx").on(table.caseId, table.revokedAt), index("lawyer_access_grants_lawyer_idx").on(table.lawyerUserId, table.revokedAt)]);

// This is a voluntary, version-specific marker by a lawyer granted access to
// the client's case. It is not a publication gate for the AI result.
export const documentAnalysisLawyerVerifications = pgTable("document_analysis_lawyer_verifications", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  documentVersionId: text("document_version_id").notNull().references(() => analysisDocumentVersions.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  lawyerUserId: text("lawyer_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("verified"),
  comment: text("comment"),
  verifiedAt: text("verified_at").notNull(),
  invalidatedAt: text("invalidated_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("document_analysis_lawyer_verification_version_uidx").on(table.analysisId, table.documentVersionId, table.lawyerUserId),
  index("document_analysis_lawyer_verification_analysis_idx").on(table.analysisId, table.status, table.verifiedAt),
]);
export const lawyerOffers = pgTable("lawyer_offers", {
  id: text("id").primaryKey(),
  lawyerRequestId: text("lawyer_request_id").notNull().references(() => lawyerRequests.id, { onDelete: "cascade" }),
  version: bigint("version", { mode: "number" }).notNull(),
  status: text("status").notNull().default("proposed"),
  scopeDescription: text("scope_description").notNull(),
  priceDescription: text("price_description").notNull(),
  durationDescription: text("duration_description").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  respondedByUserId: text("responded_by_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
  respondedAt: text("responded_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("lawyer_offers_request_version_uidx").on(table.lawyerRequestId, table.version),
  index("lawyer_offers_request_status_idx").on(table.lawyerRequestId, table.status, table.updatedAt),
]);
export const lawyerRequestMessages = pgTable("lawyer_request_messages", {
  id: text("id").primaryKey(),
  lawyerRequestId: text("lawyer_request_id").notNull().references(() => lawyerRequests.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  authorRole: text("author_role").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("lawyer_request_messages_request_idx").on(table.lawyerRequestId, table.createdAt),
  index("lawyer_request_messages_author_idx").on(table.authorUserId, table.createdAt),
]);
export const lawyerReviews = pgTable("lawyer_reviews", {
  id: text("id").primaryKey(),
  lawyerRequestId: text("lawyer_request_id").notNull().references(() => lawyerRequests.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  lawyerProfileId: text("lawyer_profile_id").notNull().references(() => lawyerProfiles.id, { onDelete: "cascade" }),
  requesterUserId: text("requester_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  overallRating: bigint("overall_rating", { mode: "number" }).notNull(), speedRating: bigint("speed_rating", { mode: "number" }).notNull(), qualityRating: bigint("quality_rating", { mode: "number" }).notNull(), communicationRating: bigint("communication_rating", { mode: "number" }).notNull(),
  body: text("body"), status: text("status").notNull().default("pending"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("lawyer_reviews_request_uidx").on(table.lawyerRequestId), index("lawyer_reviews_lawyer_status_idx").on(table.lawyerProfileId, table.status, table.createdAt)]);
export const lawyerReviewReplies = pgTable("lawyer_review_replies", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => lawyerReviews.id, { onDelete: "cascade" }),
  version: bigint("version", { mode: "number" }).notNull(),
  lawyerProfileId: text("lawyer_profile_id").notNull().references(() => lawyerProfiles.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  clientRequestId: text("client_request_id").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("lawyer_review_replies_review_version_uidx").on(table.reviewId, table.version),
  uniqueIndex("lawyer_review_replies_author_request_uidx").on(table.authorUserId, table.clientRequestId),
  uniqueIndex("lawyer_review_replies_one_open_uidx").on(table.reviewId).where(sql`${table.status} IN ('pending','approved')`),
  index("lawyer_review_replies_profile_status_idx").on(table.lawyerProfileId, table.status, table.createdAt),
]);
export const lawyerReviewReplyModeration = pgTable("lawyer_review_reply_moderation", {
  id: text("id").primaryKey(),
  replyId: text("reply_id").notNull().references(() => lawyerReviewReplies.id, { onDelete: "cascade" }),
  moderatorUserId: text("moderator_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  decision: text("decision").notNull(),
  moderatedBody: text("moderated_body"),
  reason: text("reason").notNull(),
  originalBodySha256: text("original_body_sha256").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("lawyer_review_reply_moderation_reply_uidx").on(table.replyId),
  index("lawyer_review_reply_moderation_moderator_idx").on(table.moderatorUserId, table.createdAt),
  check("lawyer_review_reply_moderation_decision_check", sql`${table.decision} IN ('approved','rejected')`),
  check("lawyer_review_reply_moderation_sha_check", sql`length(${table.originalBodySha256}) = 64`),
]);
export const lawyerReviewModeration = pgTable("lawyer_review_moderation", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => lawyerReviews.id, { onDelete: "cascade" }),
  moderatorUserId: text("moderator_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  decision: text("decision").notNull(),
  moderatedBody: text("moderated_body"),
  reason: text("reason").notNull(),
  originalBodySha256: text("original_body_sha256").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("lawyer_review_moderation_review_uidx").on(table.reviewId),
  index("lawyer_review_moderation_review_idx").on(table.reviewId, table.createdAt),
  index("lawyer_review_moderation_moderator_idx").on(table.moderatorUserId, table.createdAt),
  check("lawyer_review_moderation_decision_check", sql`${table.decision} IN ('approved','rejected')`),
  check("lawyer_review_moderation_sha_check", sql`length(${table.originalBodySha256}) = 64`),
]);
export const supportTickets = pgTable("support_tickets", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), requesterUserId: text("requester_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }), category: text("category").notNull(), severity: text("severity").notNull().default("normal"), status: text("status").notNull().default("open"), subject: text("subject").notNull(), linkedEntityType: text("linked_entity_type"), linkedEntityId: text("linked_entity_id"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), closedAt: text("closed_at"),
}, (table) => [index("support_tickets_workspace_idx").on(table.workspaceId, table.updatedAt), index("support_tickets_status_idx").on(table.status, table.updatedAt), index("support_tickets_requester_idx").on(table.requesterUserId, table.updatedAt)]);

export const supportMessages = pgTable("support_messages", {
  id: text("id").primaryKey(), ticketId: text("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }), authorUserId: text("author_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }), authorType: text("author_type").notNull(), body: text("body").notNull(), createdAt: text("created_at").notNull(),
}, (table) => [index("support_messages_ticket_idx").on(table.ticketId, table.createdAt)]);
export const knowledgeBaseArticles = pgTable("knowledge_base_articles", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  publishedAt: text("published_at"),
  createdByUserId: text("created_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  updatedByUserId: text("updated_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  statusChangedByUserId: text("status_changed_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  statusChangedAt: text("status_changed_at"),
}, (table) => [
  uniqueIndex("knowledge_base_articles_slug_uidx").on(table.slug),
  index("knowledge_base_articles_status_idx").on(table.status, table.updatedAt),
  check("knowledge_base_articles_status_check", sql`${table.status} IN ('draft','published','archived')`),
]);
export const knowledgeBaseArticleVersions = pgTable("knowledge_base_article_versions", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => knowledgeBaseArticles.id, { onDelete: "cascade" }),
  versionNumber: bigint("version_number", { mode: "number" }).notNull(),
  titleRu: text("title_ru").notNull(),
  titleUz: text("title_uz").notNull(),
  titleEn: text("title_en"),
  summaryRu: text("summary_ru").notNull(),
  summaryUz: text("summary_uz").notNull(),
  summaryEn: text("summary_en"),
  bodyRuJson: text("body_ru_json").notNull(),
  bodyUzJson: text("body_uz_json").notNull(),
  bodyEnJson: text("body_en_json"),
  relatedSlugsJson: text("related_slugs_json").notNull().default("[]"),
  contentSha256: text("content_sha256").notNull(),
  createdAt: text("created_at").notNull(),
  publishedAt: text("published_at"),
  createdByUserId: text("created_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  updatedByUserId: text("updated_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  publishedByUserId: text("published_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  updatedAt: text("updated_at"),
  contentHashVersion: text("content_hash_version").notNull().default("body-v1"),
}, (table) => [
  uniqueIndex("knowledge_base_article_versions_number_uidx").on(table.articleId, table.versionNumber),
  index("knowledge_base_article_versions_published_idx").on(table.articleId, table.publishedAt, table.versionNumber),
  check("knowledge_base_article_versions_number_check", sql`${table.versionNumber} >= 1`),
  check("knowledge_base_article_versions_hash_check", sql`length(${table.contentSha256}) = 64`),
  check("knowledge_base_article_versions_body_ru_check", sql`json_valid(${table.bodyRuJson})`),
  check("knowledge_base_article_versions_body_uz_check", sql`json_valid(${table.bodyUzJson})`),
  check("knowledge_base_article_versions_body_en_check", sql`${table.bodyEnJson} IS NULL OR json_valid(${table.bodyEnJson})`),
  check("knowledge_base_article_versions_related_check", sql`json_valid(${table.relatedSlugsJson})`),
]);
export const knowledgeBaseFeedback = pgTable("knowledge_base_feedback", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => knowledgeBaseArticles.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull().references(() => knowledgeBaseArticleVersions.id, { onDelete: "restrict" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  helpful: bigint("helpful", { mode: "number" }).notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("knowledge_base_feedback_scope_uidx").on(table.articleId, table.versionId, table.workspaceId, table.userId),
  index("knowledge_base_feedback_article_idx").on(table.articleId, table.versionId, table.updatedAt),
  check("knowledge_base_feedback_helpful_check", sql`${table.helpful} IN (0,1)`),
  check("knowledge_base_feedback_revision_check", sql`${table.revision} >= 1`),
]);
export const knowledgeBaseFeedbackEvents = pgTable("knowledge_base_feedback_events", {
  id: text("id").primaryKey(),
  feedbackId: text("feedback_id").notNull().references(() => knowledgeBaseFeedback.id, { onDelete: "cascade" }),
  articleId: text("article_id").notNull(),
  versionId: text("version_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  helpful: bigint("helpful", { mode: "number" }).notNull(),
  revision: bigint("revision", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("knowledge_base_feedback_events_revision_uidx").on(table.feedbackId, table.revision),
  uniqueIndex("knowledge_base_feedback_events_idempotency_uidx").on(table.workspaceId, table.userId, table.idempotencyKey),
  check("knowledge_base_feedback_events_helpful_check", sql`${table.helpful} IN (0,1)`),
  check("knowledge_base_feedback_events_revision_check", sql`${table.revision} >= 1`),
]);
export const knowledgeBaseAuthoringEvents = pgTable("knowledge_base_authoring_events", {
  id: text("id").primaryKey(),
  articleId: text("article_id").notNull().references(() => knowledgeBaseArticles.id, { onDelete: "restrict" }),
  versionId: text("version_id").references(() => knowledgeBaseArticleVersions.id, { onDelete: "restrict" }),
  actorUserId: text("actor_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  contentSha256: text("content_sha256"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("knowledge_base_authoring_events_article_idx").on(table.articleId, table.createdAt),
  index("knowledge_base_authoring_events_actor_idx").on(table.actorUserId, table.createdAt),
  check("knowledge_base_authoring_events_hash_check", sql`${table.contentSha256} IS NULL OR length(${table.contentSha256}) = 64`),
]);
export const consultationSlots = pgTable("consultation_slots", {
  id: text("id").primaryKey(), specialistType: text("specialist_type").notNull(), startsAt: text("starts_at").notNull(), endsAt: text("ends_at").notNull(), timezone: text("timezone").notNull().default("Asia/Tashkent"),
  status: text("status").notNull().default("available"), ...timestamps,
}, (table) => [uniqueIndex("consultation_slots_time_uidx").on(table.specialistType, table.startsAt, table.endsAt)]);

export const consultationBookings = pgTable("consultation_bookings", {
  id: text("id").primaryKey(), slotId: text("slot_id").notNull().references(() => consultationSlots.id), requesterUserId: text("requester_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }), caseId: text("case_id").references(() => cases.id, { onDelete: "set null" }), planStepId: text("plan_step_id").references(() => actionPlanSteps.id, { onDelete: "set null" }),
  status: text("status").notNull().default("confirmed"), contextJson: text("context_json").notNull(), ...timestamps,
}, (table) => [uniqueIndex("consultation_bookings_slot_uidx").on(table.slotId), index("consultation_bookings_user_idx").on(table.requesterUserId, table.createdAt)]);

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  caseId: text("case_id").references(() => cases.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  locale: text("locale").notNull(),
  status: text("status").notNull().default("active"),
  ...timestamps,
}, (table) => [index("conversations_workspace_idx").on(table.workspaceId, table.updatedAt)]);

export const conversationMessages = pgTable("conversation_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  authorType: text("author_type").notNull(),
  content: text("content").notNull(),
  structuredJson: text("structured_json"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("conversation_messages_conversation_idx").on(table.conversationId, table.createdAt)]);

export const aiDocumentPrefillHandoffs = pgTable("ai_document_prefill_handoffs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  assistantMessageId: text("assistant_message_id").notNull().references(() => conversationMessages.id, { onDelete: "cascade" }),
  templateCode: text("template_code").notNull(),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  locale: text("locale").notNull(),
  selectedFieldIdsJson: text("selected_field_ids_json").notNull(),
  selectionSha256: text("selection_sha256").notNull(),
  idempotencyKeySha256: text("idempotency_key_sha256").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("ai_document_prefill_handoffs_locale_check", sql`${table.locale} IN ('ru','uz','en')`),
  check(
    "ai_document_prefill_handoffs_fields_check",
    sql`json_valid(${table.selectedFieldIdsJson}) AND json_type(${table.selectedFieldIdsJson}) = 'array' AND length(${table.selectedFieldIdsJson}) BETWEEN 2 AND 10000`,
  ),
  check("ai_document_prefill_handoffs_hash_check", sql`length(${table.selectionSha256}) = 64 AND length(${table.idempotencyKeySha256}) = 64`),
  uniqueIndex("ai_document_prefill_handoffs_request_uidx").on(table.workspaceId, table.userId, table.idempotencyKeySha256),
  uniqueIndex("ai_document_prefill_handoffs_document_uidx").on(table.documentId),
  index("ai_document_prefill_handoffs_source_idx").on(table.assistantMessageId, table.createdAt),
]);

export const aiQuestionIntakes = pgTable("ai_question_intakes", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  questionCiphertext: text("question_ciphertext"),
  questionIv: text("question_iv"),
  questionKeyVersion: text("question_key_version"),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("ai_question_intakes_hash_check", sql`length(${table.tokenHash}) = 64`),
  check("ai_question_intakes_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  check("ai_question_intakes_payload_check", sql`(${table.consumedAt} IS NULL AND ${table.questionCiphertext} IS NOT NULL AND ${table.questionIv} IS NOT NULL AND ${table.questionKeyVersion} IS NOT NULL) OR (${table.consumedAt} IS NOT NULL AND ${table.questionCiphertext} IS NULL AND ${table.questionIv} IS NULL AND ${table.questionKeyVersion} IS NULL)`),
  uniqueIndex("ai_question_intakes_token_uidx").on(table.tokenHash),
  index("ai_question_intakes_expiry_idx").on(table.expiresAt, table.consumedAt),
  index("ai_question_intakes_owner_idx").on(table.workspaceId, table.userId, table.createdAt),
]);

export const messageBranches = pgTable("message_branches", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  parentBranchId: text("parent_branch_id"),
  forkedFromMessageId: text("forked_from_message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
  requestMessageId: text("request_message_id").notNull().references(() => conversationMessages.id, { onDelete: "cascade" }),
  responseMessageId: text("response_message_id").notNull().references(() => conversationMessages.id, { onDelete: "cascade" }),
  operation: text("operation").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("message_branches_operation_check", sql`${table.operation} IN ('new','follow_up','edit','regenerate')`),
  uniqueIndex("message_branches_request_uidx").on(table.requestMessageId),
  uniqueIndex("message_branches_response_uidx").on(table.responseMessageId),
  index("message_branches_conversation_idx").on(table.conversationId, table.createdAt),
  index("message_branches_parent_idx").on(table.parentBranchId),
]);

export const messageVersions = pgTable("message_versions", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  branchId: text("branch_id").notNull().references(() => messageBranches.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull().references(() => conversationMessages.id, { onDelete: "cascade" }),
  sourceMessageId: text("source_message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  operation: text("operation").notNull(),
  versionNumber: bigint("version_number", { mode: "number" }).notNull().default(1),
  contentSha256: text("content_sha256").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("message_versions_operation_check", sql`${table.operation} IN ('new','follow_up','edit','regenerate')`),
  check("message_versions_number_check", sql`${table.versionNumber} >= 1`),
  uniqueIndex("message_versions_message_uidx").on(table.messageId),
  index("message_versions_conversation_idx").on(table.conversationId, table.createdAt),
  index("message_versions_source_idx").on(table.sourceMessageId, table.versionNumber),
]);
export const aiRuns = pgTable("ai_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  requestMessageId: text("request_message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
  responseMessageId: text("response_message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key").notNull(),
  correlationId: text("correlation_id").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  providerResponseId: text("provider_response_id"),
  fallbackFromProvider: text("fallback_from_provider"),
  answerMode: text("answer_mode").notNull(),
  reasoningMode: text("reasoning_mode").notNull(),
  status: text("status").notNull(),
  legalDatabaseAsOf: text("legal_database_as_of").notNull(),
  instructionHash: text("instruction_hash").notNull(),
  sourceVersionHash: text("source_version_hash").notNull(),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull().default(0),
  estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }),
  attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
  latencyMs: bigint("latency_ms", { mode: "number" }),
  errorCode: text("error_code"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("ai_runs_idempotency_uidx").on(table.workspaceId, table.userId, table.idempotencyKey),
  index("ai_runs_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
  index("ai_runs_conversation_idx").on(table.conversationId, table.createdAt),
]);

export const aiFeedback = pgTable("ai_feedback", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  assistantMessageId: text("assistant_message_id").notNull().references(() => conversationMessages.id, { onDelete: "cascade" }),
  aiRunId: text("ai_run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  feedbackType: text("feedback_type").notNull(),
  comment: text("comment"),
  ...timestamps,
}, (table) => [
  check("ai_feedback_type_check", sql`${table.feedbackType} IN ('helpful','not_helpful','wrong_norm','broken_link','outdated','incomplete','language','unsafe','ignored_facts')`),
  uniqueIndex("ai_feedback_response_type_uidx").on(table.workspaceId, table.userId, table.assistantMessageId, table.feedbackType),
  index("ai_feedback_workspace_created_idx").on(table.workspaceId, table.createdAt),
  index("ai_feedback_ai_run_idx").on(table.aiRunId, table.createdAt),
]);

export const aiUsageLedger = pgTable("ai_usage_ledger", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  aiRunId: text("ai_run_id").notNull().references(() => aiRuns.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  feature: text("feature").notNull().default("legal_chat"),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  units: bigint("units", { mode: "number" }).notNull().default(1),
  status: text("status").notNull().default("reserved"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull().default(0),
  estimatedCostMicrousd: bigint("estimated_cost_microusd", { mode: "number" }),
  releasedAt: text("released_at"),
  consumedAt: text("consumed_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("ai_usage_ledger_run_uidx").on(table.aiRunId),
  uniqueIndex("ai_usage_ledger_idempotency_uidx").on(table.workspaceId, table.userId, table.idempotencyKey),
  index("ai_usage_ledger_period_idx").on(table.workspaceId, table.userId, table.feature, table.periodStart, table.status),
]);

export const guestAiSessions = pgTable("guest_ai_sessions", {
  id: text("id").primaryKey(),
  tokenHmac: text("token_hmac").notNull(),
  tokenKeyVersion: text("token_key_version").notNull(),
  ipHmac: text("ip_hmac").notNull(),
  locale: text("locale").notNull(),
  state: text("state").notNull().default("available"),
  requestCount: bigint("request_count", { mode: "number" }).notNull().default(0),
  answerCount: bigint("answer_count", { mode: "number" }).notNull().default(0),
  reservedRunId: text("reserved_run_id"),
  reservationExpiresAt: text("reservation_expires_at"),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  ...timestamps,
}, (table) => [
  check("guest_ai_sessions_locale_check", sql`${table.locale} IN ('ru','uz','en')`),
  check("guest_ai_sessions_state_check", sql`${table.state} IN ('available','reserved','consumed')`),
  check("guest_ai_sessions_request_count_check", sql`${table.requestCount} BETWEEN 0 AND 5`),
  check("guest_ai_sessions_answer_count_check", sql`${table.answerCount} BETWEEN 0 AND 1`),
  check("guest_ai_sessions_reservation_check", sql`(${table.state}='reserved' AND ${table.reservedRunId} IS NOT NULL AND ${table.reservationExpiresAt} IS NOT NULL) OR (${table.state} IN ('available','consumed') AND ${table.reservedRunId} IS NULL AND ${table.reservationExpiresAt} IS NULL)`),
  check("guest_ai_sessions_consumed_check", sql`(${table.state}='consumed' AND ${table.answerCount}=1 AND ${table.consumedAt} IS NOT NULL) OR (${table.state}<>'consumed' AND ${table.answerCount}=0 AND ${table.consumedAt} IS NULL)`),
  uniqueIndex("guest_ai_sessions_token_uidx").on(table.tokenHmac),
  index("guest_ai_sessions_ip_created_idx").on(table.ipHmac, table.createdAt),
  index("guest_ai_sessions_expiry_idx").on(table.expiresAt, table.state),
]);

export const guestAiRuns = pgTable("guest_ai_runs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => guestAiSessions.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  correlationId: text("correlation_id").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  providerResponseId: text("provider_response_id"),
  fallbackFromProvider: text("fallback_from_provider"),
  status: text("status").notNull().default("processing"),
  responseKind: text("response_kind"),
  requestCiphertext: text("request_ciphertext").notNull(),
  requestIv: text("request_iv").notNull(),
  requestKeyVersion: text("request_key_version").notNull(),
  resultCiphertext: text("result_ciphertext"),
  resultIv: text("result_iv"),
  resultKeyVersion: text("result_key_version"),
  legalDatabaseAsOf: text("legal_database_as_of").notNull(),
  instructionHash: text("instruction_hash").notNull(),
  sourceVersionHash: text("source_version_hash").notNull(),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull().default(0),
  attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
  latencyMs: bigint("latency_ms", { mode: "number" }),
  errorCode: text("error_code"),
  expiresAt: text("expires_at").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => [
  check("guest_ai_runs_status_check", sql`${table.status} IN ('processing','completed','failed','expired')`),
  check("guest_ai_runs_response_kind_check", sql`${table.responseKind} IS NULL OR ${table.responseKind} IN ('answer','clarification_required')`),
  check("guest_ai_runs_request_hash_check", sql`length(${table.requestHash})=64`),
  check("guest_ai_runs_result_check", sql`(${table.status}='completed' AND ${table.responseKind} IS NOT NULL AND ${table.resultCiphertext} IS NOT NULL AND ${table.resultIv} IS NOT NULL AND ${table.resultKeyVersion} IS NOT NULL AND ${table.completedAt} IS NOT NULL) OR (${table.status}<>'completed' AND ${table.responseKind} IS NULL AND ${table.resultCiphertext} IS NULL AND ${table.resultIv} IS NULL AND ${table.resultKeyVersion} IS NULL)`),
  uniqueIndex("guest_ai_runs_session_idempotency_uidx").on(table.sessionId, table.idempotencyKey),
  index("guest_ai_runs_session_created_idx").on(table.sessionId, table.createdAt),
  index("guest_ai_runs_expiry_idx").on(table.expiresAt, table.status),
]);


export const confirmedFacts = pgTable("confirmed_facts", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  caseId: text("case_id").references(() => cases.id, { onDelete: "cascade" }),
  statement: text("statement").notNull(),
  status: text("status").notNull().default("proposed"),
  confirmedByUserId: text("confirmed_by_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
  confirmedAt: text("confirmed_at"),
  ...timestamps,
}, (table) => [index("confirmed_facts_case_idx").on(table.caseId, table.status)]);

export const userMemorySettings = pgTable("user_memory_settings", {
  userId: text("user_id").primaryKey().references(() => userProfiles.id, { onDelete: "cascade" }),
  automaticEnabled: booleanInteger("automatic_enabled").notNull().default(true),
  ...timestamps,
});

export const userMemories = pgTable("user_memories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  scope: text("scope").notNull().default("global"),
  scopeKey: text("scope_key").notNull(),
  category: text("category").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  keyVersion: text("key_version").notNull(),
  contentSha256: text("content_sha256").notNull(),
  sourceKind: text("source_kind").notNull(),
  status: text("status").notNull().default("active"),
  deletedAt: text("deleted_at"),
  ...timestamps,
}, (table) => [
  check("user_memories_scope_check", sql`${table.scope} IN ('global','workspace')`),
  check("user_memories_scope_key_check", sql`(${table.scope}='global' AND ${table.workspaceId} IS NULL AND ${table.scopeKey}='global') OR (${table.scope}='workspace' AND ${table.workspaceId} IS NOT NULL AND ${table.scopeKey}='workspace:' || ${table.workspaceId})`),
  check("user_memories_category_check", sql`${table.category} IN ('profile_name','language','company','answer_style','user_instruction','counterparty','legal_context','typical_requisite')`),
  check("user_memories_source_kind_check", sql`${table.sourceKind} IN ('manual','automatic','profile')`),
  check("user_memories_status_check", sql`${table.status} IN ('active','deleted')`),
  check("user_memories_hash_check", sql`length(${table.contentSha256}) = 64`),
  uniqueIndex("user_memories_identity_uidx")
    .on(table.userId, table.scopeKey, table.contentSha256)
    .where(sql`${table.status} = 'active'`),
  index("user_memories_user_status_idx").on(table.userId, table.status, table.updatedAt),
  index("user_memories_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
]);

export const memorySources = pgTable("memory_sources", {
  id: text("id").primaryKey(),
  memoryId: text("memory_id").notNull().references(() => userMemories.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  messageId: text("message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
  sourceType: text("source_type").notNull(),
  sourceRef: text("source_ref"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  check("memory_sources_type_check", sql`${table.sourceType} IN ('manual','chat','profile')`),
  index("memory_sources_memory_idx").on(table.memoryId, table.createdAt),
  index("memory_sources_conversation_idx").on(table.conversationId, table.createdAt),
]);

export const legalSources = pgTable("legal_sources", {
  id: text("id").primaryKey(),
  canonicalId: text("canonical_id"),
  officialUrl: text("official_url").notNull(),
  actTitle: text("act_title").notNull(),
  actIdentifier: text("act_identifier"),
  publishedAt: text("published_at"),
  revisionDate: text("revision_date"),
  locale: text("locale").notNull(),
  sourceType: text("source_type").notNull(),
  status: text("status").notNull().default("verified"),
  verificationState: text("verification_state").notNull().default("draft"),
  contentSha256: text("content_sha256"),
  fetchedAt: text("fetched_at"),
  verifiedAt: text("verified_at"),
  verifiedByUserId: text("verified_by_user_id"),
  verificationNotes: text("verification_notes"),
  effectiveAt: text("effective_at"),
  expiresAt: text("expires_at"),
  lastCheckedAt: text("last_checked_at").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("legal_sources_url_locale_uidx").on(table.officialUrl, table.locale),
  uniqueIndex("legal_sources_canonical_locale_uidx").on(table.canonicalId, table.locale),
  index("legal_sources_verification_idx").on(table.verificationState, table.locale, table.lastCheckedAt),
]);

export const legalSourceVersions = pgTable("legal_source_versions", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => legalSources.id, { onDelete: "restrict" }),
  externalVersionId: text("external_version_id"),
  language: text("language").notNull(),
  status: text("status").notNull().default("pending_review"),
  contentSha256: text("content_sha256").notNull(),
  rawObjectKey: text("raw_object_key").notNull(),
  parsedObjectKey: text("parsed_object_key"),
  publishedAt: text("published_at"),
  effectiveAt: text("effective_at"),
  expiresAt: text("expires_at"),
  fetchedAt: text("fetched_at").notNull(),
  verifiedAt: text("verified_at"),
  verifiedByUserId: text("verified_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  metadataJson: text("metadata_json").notNull().default("{}"),
  ...timestamps,
}, (table) => [
  uniqueIndex("legal_source_versions_hash_uidx").on(table.sourceId, table.language, table.contentSha256),
  index("legal_source_versions_status_idx").on(table.sourceId, table.status, table.effectiveAt),
]);

export const legalSourceSections = pgTable("legal_source_sections", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull().references(() => legalSourceVersions.id, { onDelete: "cascade" }),
  canonicalRef: text("canonical_ref"),
  article: text("article"),
  part: text("part"),
  clause: text("clause"),
  heading: text("heading"),
  bodyText: text("body_text").notNull(),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  contentSha256: text("content_sha256").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("legal_source_sections_ref_uidx").on(table.versionId, table.canonicalRef),
  index("legal_source_sections_order_idx").on(table.versionId, table.sequence),
]);

export const legalSourceChunks = pgTable("legal_source_chunks", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull().references(() => legalSourceVersions.id, { onDelete: "cascade" }),
  sectionId: text("section_id").references(() => legalSourceSections.id, { onDelete: "cascade" }),
  chunkIndex: bigint("chunk_index", { mode: "number" }).notNull(),
  language: text("language").notNull(),
  contentText: text("content_text").notNull(),
  contentSha256: text("content_sha256").notNull(),
  vectorId: text("vector_id"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  indexedAt: text("indexed_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("legal_source_chunks_order_uidx").on(table.versionId, table.chunkIndex),
  uniqueIndex("legal_source_chunks_vector_uidx").on(table.vectorId),
  index("legal_source_chunks_section_idx").on(table.sectionId, table.chunkIndex),
]);

export const sourceSyncRuns = pgTable("source_sync_runs", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull(),
  sourceKind: text("source_kind").notNull(),
  runType: text("run_type").notNull(),
  status: text("status").notNull().default("running"),
  lockKey: text("lock_key").notNull(),
  discoveredCount: bigint("discovered_count", { mode: "number" }).notNull().default(0),
  fetchedCount: bigint("fetched_count", { mode: "number" }).notNull().default(0),
  changedCount: bigint("changed_count", { mode: "number" }).notNull().default(0),
  verifiedCount: bigint("verified_count", { mode: "number" }).notNull().default(0),
  errorCount: bigint("error_count", { mode: "number" }).notNull().default(0),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  errorSummary: text("error_summary"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("source_sync_runs_status_idx").on(table.sourceKind, table.status, table.startedAt),
  uniqueIndex("source_sync_runs_lock_uidx").on(table.lockKey, table.startedAt),
]);

export const sourceSyncErrors = pgTable("source_sync_errors", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => sourceSyncRuns.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url"),
  externalId: text("external_id"),
  errorCode: text("error_code").notNull(),
  retryable: booleanInteger("retryable").notNull().default(false),
  safeSummary: text("safe_summary").notNull(),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [index("source_sync_errors_run_idx").on(table.runId, table.occurredAt)]);

// Metadata-only Lex monitoring. This table is intentionally independent from
// the retired local legal corpus: it never contains act text, sections,
// embeddings, a publication state or a reviewer decision.
export const legalMonitoringMetadata = pgTable("legal_monitoring_metadata", {
  id: text("id").primaryKey(),
  canonicalUrl: text("canonical_url").notNull(),
  canonicalId: text("canonical_id"),
  locale: text("locale").notNull(),
  actTitle: text("act_title").notNull(),
  revisionDate: text("revision_date"),
  effectiveAt: text("effective_at"),
  fingerprint: text("fingerprint").notNull(),
  httpStatus: bigint("http_status", { mode: "number" }).notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  lastCheckedAt: text("last_checked_at").notNull(),
  lastErrorCode: text("last_error_code"),
  ...timestamps,
}, (table) => [
  uniqueIndex("legal_monitoring_metadata_url_uidx").on(table.canonicalUrl),
  index("legal_monitoring_metadata_checked_idx").on(table.lastCheckedAt),
]);

export const legalMonitoringChangeEvents = pgTable("legal_monitoring_change_events", {
  id: text("id").primaryKey(),
  metadataId: text("metadata_id").notNull().references(() => legalMonitoringMetadata.id, { onDelete: "cascade" }),
  canonicalUrl: text("canonical_url").notNull(),
  actTitle: text("act_title").notNull(),
  changeType: text("change_type").notNull(),
  fingerprint: text("fingerprint").notNull(),
  detectedAt: text("detected_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("legal_monitoring_change_fingerprint_uidx").on(table.metadataId, table.fingerprint),
  index("legal_monitoring_change_detected_idx").on(table.detectedAt),
]);

export const legalSourceFetchRequests = pgTable("legal_source_fetch_requests", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull(),
  sourceKind: text("source_kind").notNull(),
  locale: text("locale").notNull(),
  requestedUrl: text("requested_url").notNull(),
  canonicalId: text("canonical_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("queued"),
  attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
  requestedByUserId: text("requested_by_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
  sourceId: text("source_id").references(() => legalSources.id, { onDelete: "restrict" }),
  versionId: text("version_id").references(() => legalSourceVersions.id, { onDelete: "restrict" }),
  errorCode: text("error_code"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("legal_source_fetch_requests_idempotency_uidx").on(table.idempotencyKey),
  index("legal_source_fetch_requests_status_idx").on(table.environment, table.status, table.createdAt),
  index("legal_source_fetch_requests_source_idx").on(table.sourceId, table.versionId),
]);

export const legalReviewQueue = pgTable("legal_review_queue", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => legalSources.id, { onDelete: "restrict" }),
  versionId: text("version_id").references(() => legalSourceVersions.id, { onDelete: "restrict" }),
  reasonCode: text("reason_code").notNull(),
  confidence: text("confidence").notNull(),
  status: text("status").notNull().default("pending"),
  assignedToUserId: text("assigned_to_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
  decision: text("decision"),
  decisionNotes: text("decision_notes"),
  reviewedParsedSha256: text("reviewed_parsed_sha256"),
  decidedByUserId: text("decided_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  decisionEvidenceJson: text("decision_evidence_json"),
  decisionEvidenceSha256: text("decision_evidence_sha256"),
  decidedAt: text("decided_at"),
  ...timestamps,
}, (table) => [
  index("legal_review_queue_status_idx").on(table.status, table.createdAt),
  index("legal_review_queue_source_idx").on(table.sourceId, table.versionId),
  index("legal_review_queue_decider_idx").on(table.decidedByUserId, table.decidedAt),
  uniqueIndex("legal_review_queue_version_reason_uidx").on(table.versionId, table.reasonCode),
]);

export const legalSourceApplicabilityRecords = pgTable("legal_source_applicability_records", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => legalReviewQueue.id, { onDelete: "restrict" }),
  sourceId: text("source_id").notNull().references(() => legalSources.id, { onDelete: "restrict" }),
  versionId: text("version_id").notNull().references(() => legalSourceVersions.id, { onDelete: "restrict" }),
  effectiveAt: text("effective_at").notNull(),
  expiresAt: text("expires_at"),
  reviewedByUserId: text("reviewed_by_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  reviewerSessionId: text("reviewer_session_id").notNull(),
  mfaVerifiedAt: text("mfa_verified_at").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  evidenceSha256: text("evidence_sha256").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("legal_source_applicability_review_uidx").on(table.reviewId),
  uniqueIndex("legal_source_applicability_version_uidx").on(table.versionId),
  index("legal_source_applicability_interval_idx").on(table.effectiveAt, table.expiresAt),
]);

export const legalSourcePublications = pgTable("legal_source_publications", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => legalReviewQueue.id, { onDelete: "restrict" }),
  sourceId: text("source_id").notNull().references(() => legalSources.id, { onDelete: "restrict" }),
  versionId: text("version_id").notNull().references(() => legalSourceVersions.id, { onDelete: "restrict" }),
  reviewEvidenceSha256: text("review_evidence_sha256").notNull(),
  rawContentSha256: text("raw_content_sha256").notNull(),
  parsedContentSha256: text("parsed_content_sha256").notNull(),
  publishedByUserId: text("published_by_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  publicationEvidenceJson: text("publication_evidence_json").notNull(),
  publicationEvidenceSha256: text("publication_evidence_sha256").notNull(),
  publishedAt: text("published_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("legal_source_publications_review_uidx").on(table.reviewId),
  uniqueIndex("legal_source_publications_version_uidx").on(table.versionId),
  index("legal_source_publications_source_idx").on(table.sourceId, table.publishedAt),
  index("legal_source_publications_publisher_idx").on(table.publishedByUserId, table.publishedAt),
]);

export const legalSourceCurrentActivations = pgTable("legal_source_current_activations", {
  sourceId: text("source_id").primaryKey().references(() => legalSources.id, { onDelete: "restrict" }),
  publicationId: text("publication_id").notNull().references(() => legalSourcePublications.id, { onDelete: "restrict" }),
  versionId: text("version_id").notNull().references(() => legalSourceVersions.id, { onDelete: "restrict" }),
  activatedByUserId: text("activated_by_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  activatedAt: text("activated_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("legal_source_current_activations_publication_uidx").on(table.publicationId),
  uniqueIndex("legal_source_current_activations_version_uidx").on(table.versionId),
  index("legal_source_current_activations_actor_idx").on(table.activatedByUserId, table.activatedAt),
]);

export const userLegalBookmarks = pgTable("user_legal_bookmarks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull().references(() => legalSources.id, { onDelete: "restrict" }),
  versionId: text("version_id").notNull().references(() => legalSourceVersions.id, { onDelete: "restrict" }),
  caseId: text("case_id").references(() => cases.id, { onDelete: "set null" }),
  comment: text("comment"),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  archivedAt: text("archived_at"),
  ...timestamps,
}, (table) => [
  index("user_legal_bookmarks_user_idx").on(table.workspaceId, table.userId, table.updatedAt),
  index("user_legal_bookmarks_case_idx").on(table.workspaceId, table.caseId, table.updatedAt),
  index("user_legal_bookmarks_source_idx").on(table.sourceId, table.versionId),
]);

export const userLegalBookmarkEvents = pgTable("user_legal_bookmark_events", {
  id: text("id").primaryKey(),
  bookmarkId: text("bookmark_id").notNull().references(() => userLegalBookmarks.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  sourceId: text("source_id").notNull(),
  versionId: text("version_id").notNull(),
  caseId: text("case_id"),
  eventType: text("event_type").notNull(),
  revision: bigint("revision", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  commentSha256: text("comment_sha256"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("user_legal_bookmark_events_revision_uidx").on(table.bookmarkId, table.revision),
  uniqueIndex("user_legal_bookmark_events_idempotency_uidx").on(table.workspaceId, table.userId, table.idempotencyKey),
  index("user_legal_bookmark_events_case_idx").on(table.workspaceId, table.caseId, table.createdAt),
]);

export const legalSourceLifecycleEvents = pgTable("legal_source_lifecycle_events", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => legalSources.id, { onDelete: "restrict" }),
  publicationId: text("publication_id").notNull().references(() => legalSourcePublications.id, { onDelete: "restrict" }),
  versionId: text("version_id").notNull().references(() => legalSourceVersions.id, { onDelete: "restrict" }),
  previousPublicationId: text("previous_publication_id").references(() => legalSourcePublications.id, { onDelete: "restrict" }),
  previousVersionId: text("previous_version_id").references(() => legalSourceVersions.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(),
  reasonNotes: text("reason_notes"),
  actedByUserId: text("acted_by_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  actorSessionId: text("actor_session_id").notNull(),
  actorAssignmentIdsJson: text("actor_assignment_ids_json").notNull(),
  mfaVerifiedAt: text("mfa_verified_at").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  evidenceSha256: text("evidence_sha256").notNull(),
  occurredAt: text("occurred_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("legal_source_lifecycle_events_source_idx").on(table.sourceId, table.occurredAt),
  index("legal_source_lifecycle_events_publication_idx").on(table.publicationId, table.eventType),
  index("legal_source_lifecycle_events_actor_idx").on(table.actedByUserId, table.occurredAt),
]);

export const conversationSources = pgTable("conversation_sources", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  messageId: text("message_id").references(() => conversationMessages.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull().references(() => legalSources.id, { onDelete: "restrict" }),
  citationLabel: text("citation_label"),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("conversation_sources_uidx").on(table.conversationId, table.messageId, table.sourceId)]);

// Query-scoped metadata only. Do not use this table as an owned Lex/Advice corpus.
export const legalSourceReferences = pgTable("legal_source_references", {
  evidenceReceiptJson: text("evidence_receipt_json"),
  id: text("id").primaryKey(),
  aiRunId: text("ai_run_id").references(() => aiRuns.id, { onDelete: "cascade" }),
  guestRunId: text("guest_run_id").references(() => guestAiRuns.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  messageId: text("message_id").references(() => conversationMessages.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull(),
  sourceLocale: text("source_locale").notNull(),
  canonicalId: text("canonical_id"),
  sourceUrl: text("source_url").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  title: text("title").notNull(),
  actIdentifier: text("act_identifier"),
  articleReference: text("article_reference"),
  excerpt: text("excerpt"),
  documentStatus: text("document_status"),
  effectiveDate: text("effective_date"),
  retrievedAt: text("retrieved_at").notNull(),
  validatedAt: text("validated_at").notNull(),
  contentSha256: text("content_sha256").notNull(),
  fetchStatus: text("fetch_status").notNull(),
  citationValidationStatus: text("citation_validation_status").notNull(),
  sourceAccessMode: text("source_access_mode").notNull().default("direct"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("legal_source_references_run_url_uidx").on(table.aiRunId, table.guestRunId, table.canonicalUrl),
  index("legal_source_references_conversation_idx").on(table.conversationId, table.createdAt),
  index("legal_source_references_guest_idx").on(table.guestRunId, table.createdAt),
]);

// Operational metadata for direct Lex/Advice availability only. It never holds
// a source document, a legal excerpt, or a materialized corpus.
export const legalSourceHealthChecks = pgTable("legal_source_health_checks", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull(),
  sourceKind: text("source_kind").notNull(),
  status: text("status").notNull(),
  checkedAt: text("checked_at").notNull(),
  latencyMs: bigint("latency_ms", { mode: "number" }).notNull(),
  errorCode: text("error_code"),
  endpointUrl: text("endpoint_url").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("legal_source_health_checks_lookup_idx").on(table.environment, table.sourceKind, table.checkedAt),
]);

// Content-free evidence for platform dependency health. Source content, user
// data, provider payloads, credentials and stack traces are intentionally not
// represented in this operational table.
export const dependencyHealthChecks = pgTable("dependency_health_checks", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull(),
  dependencyKey: text("dependency_key").notNull(),
  state: text("state").notNull(),
  checkedAt: text("checked_at").notNull(),
  latencyMs: bigint("latency_ms", { mode: "number" }),
  safeErrorCode: text("safe_error_code"),
  evidenceKind: text("evidence_kind").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("dependency_health_checks_latest_idx")
    .on(table.environment, table.dependencyKey, table.checkedAt, table.id),
]);

// Append-only operational latency evidence. It intentionally has no account,
// user, workspace, prompt, answer, document, URL, provider payload, or secret
// column; correlationHash is a one-way hash of an opaque request UUID.
export const aiSloTelemetryEvents = pgTable("ai_slo_telemetry_events", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull(),
  correlationHash: text("correlation_hash").notNull(),
  requestKind: text("request_kind").notNull(),
  authKind: text("auth_kind").notNull(),
  answerMode: text("answer_mode").notNull(),
  reasoningMode: text("reasoning_mode").notNull(),
  provider: text("provider").notNull(),
  model: text("model"),
  outcome: text("outcome").notNull(),
  fallback: text("fallback").notNull(),
  authLatencyMs: bigint("auth_latency_ms", { mode: "number" }),
  contextLatencyMs: bigint("context_latency_ms", { mode: "number" }),
  retrievalLatencyMs: bigint("retrieval_latency_ms", { mode: "number" }),
  providerTtftMs: bigint("provider_ttft_ms", { mode: "number" }),
  providerTotalMs: bigint("provider_total_ms", { mode: "number" }),
  validationLatencyMs: bigint("validation_latency_ms", { mode: "number" }),
  persistenceLatencyMs: bigint("persistence_latency_ms", { mode: "number" }),
  endToEndMs: bigint("end_to_end_ms", { mode: "number" }).notNull(),
  firstUsefulStage: text("first_useful_stage").notNull(),
  firstUsefulLatencyMs: bigint("first_useful_latency_ms", { mode: "number" }),
  firstUsefulPass: booleanInteger("first_useful_pass").notNull(),
  fullResponsePass: booleanInteger("full_response_pass").notNull(),
  safeErrorCode: text("safe_error_code"),
  occurredAt: text("occurred_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("ai_slo_telemetry_correlation_uidx").on(table.environment, table.correlationHash),
  index("ai_slo_telemetry_window_idx").on(table.environment, table.requestKind, table.occurredAt, table.id),
  index("ai_slo_telemetry_outcome_idx").on(table.environment, table.outcome, table.occurredAt, table.id),
]);

export const legislationUpdates = pgTable("legislation_updates", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => legalSources.id, { onDelete: "restrict" }),
  externalId: text("external_id").notNull(),
  titleOriginal: text("title_original").notNull(),
  originalLanguage: text("original_language").notNull(),
  titleRu: text("title_ru"),
  titleUz: text("title_uz"),
  summaryRu: text("summary_ru"),
  summaryUz: text("summary_uz"),
  changeSummaryRu: text("change_summary_ru"),
  changeSummaryUz: text("change_summary_uz"),
  recommendedActionRu: text("recommended_action_ru"),
  recommendedActionUz: text("recommended_action_uz"),
  topicsJson: text("topics_json").notNull().default("[]"),
  affectedAudiencesJson: text("affected_audiences_json").notNull().default("[]"),
  adoptedAt: text("adopted_at"),
  effectiveAt: text("effective_at"),
  publishedAt: text("published_at").notNull(),
  status: text("status").notNull().default("draft"),
  verifiedAt: text("verified_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("legislation_updates_source_uidx").on(table.sourceId, table.externalId),
  index("legislation_updates_status_idx").on(table.status, table.publishedAt),
]);

export const monitoringPreferences = pgTable("monitoring_preferences", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  audience: text("audience").notNull(),
  topicsJson: text("topics_json").notNull().default("[]"),
  channelsJson: text("channels_json").notNull().default("[\"in_app\"]"),
  frequency: text("frequency").notNull().default("weekly"),
  locale: text("locale").notNull().default("ru"),
  documentImpactConsent: booleanInteger("document_impact_consent").notNull().default(false),
  lastDeliveredAt: text("last_delivered_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("monitoring_preferences_user_workspace_uidx").on(table.workspaceId, table.userId),
  index("monitoring_preferences_delivery_idx").on(table.frequency, table.lastDeliveredAt),
]);

export const pricingPolicies = pgTable("pricing_policies", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  ...timestamps,
}, (table) => [
  uniqueIndex("pricing_policies_code_uidx").on(table.code),
  index("pricing_policies_status_idx").on(table.status, table.updatedAt),
]);

export const pricingPolicyVersions = pgTable("pricing_policy_versions", {
  id: text("id").primaryKey(),
  policyId: text("policy_id").notNull().references(() => pricingPolicies.id, { onDelete: "restrict" }),
  version: bigint("version", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("UZS"),
  providerCommissionRateBasisPoints: bigint("provider_commission_rate_basis_points", { mode: "number" }).notNull(),
  vatRateBasisPoints: bigint("vat_rate_basis_points", { mode: "number" }).notNull(),
  providerFeeBearer: text("provider_fee_bearer").notNull(),
  basis: text("basis").notNull(),
  contractNumber: text("contract_number"),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  approvalStatus: text("approval_status").notNull().default("draft"),
  approvedByUserId: text("approved_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  approvedAt: text("approved_at"),
  createdByUserId: text("created_by_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("pricing_policy_versions_policy_version_uidx").on(table.policyId, table.version),
  index("pricing_policy_versions_effective_idx").on(table.approvalStatus, table.effectiveFrom, table.effectiveTo),
  check("pricing_policy_versions_currency_check", sql`${table.currency} = 'UZS'`),
  check("pricing_policy_versions_commission_rate_check", sql`${table.providerCommissionRateBasisPoints} BETWEEN 0 AND 10000`),
  check("pricing_policy_versions_vat_rate_check", sql`${table.vatRateBasisPoints} BETWEEN 0 AND 10000`),
]);

export const taxProfiles = pgTable("tax_profiles", {
  id: text("id").primaryKey(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  serviceType: text("service_type").notNull(),
  payerStatus: text("payer_status").notNull(),
  taxModel: text("tax_model").notNull(),
  vatRateBasisPoints: bigint("vat_rate_basis_points", { mode: "number" }).notNull().default(0),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  approvalStatus: text("approval_status").notNull().default("draft"),
  approvedByUserId: text("approved_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  approvedAt: text("approved_at"),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("tax_profiles_subject_service_version_uidx").on(table.subjectType, table.subjectId, table.serviceType, table.version),
  index("tax_profiles_effective_idx").on(table.subjectType, table.subjectId, table.serviceType, table.approvalStatus, table.effectiveFrom),
  check("tax_profiles_vat_rate_check", sql`${table.vatRateBasisPoints} BETWEEN 0 AND 10000`),
]);

export const subscriptionPlans = pgTable("subscription_plans", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  status: text("status").notNull().default("draft"),
  ...timestamps,
}, (table) => [
  uniqueIndex("subscription_plans_code_uidx").on(table.code),
  index("subscription_plans_status_idx").on(table.status, table.updatedAt),
]);

export const subscriptionPlanVersions = pgTable("subscription_plan_versions", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull().references(() => subscriptionPlans.id, { onDelete: "restrict" }),
  version: bigint("version", { mode: "number" }).notNull(),
  nameRu: text("name_ru").notNull(),
  nameUz: text("name_uz").notNull(),
  billingPeriod: text("billing_period").notNull(),
  priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("UZS"),
  entitlementsJson: text("entitlements_json").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  approvalStatus: text("approval_status").notNull().default("draft"),
  approvedByUserId: text("approved_by_user_id").references(() => userProfiles.id, { onDelete: "restrict" }),
  approvedAt: text("approved_at"),
  createdByUserId: text("created_by_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull(),
  nameEn: text("name_en"),
}, (table) => [
  uniqueIndex("subscription_plan_versions_plan_version_uidx").on(table.planId, table.version),
  index("subscription_plan_versions_effective_idx").on(table.approvalStatus, table.effectiveFrom, table.effectiveTo),
  check("subscription_plan_versions_price_check", sql`${table.priceMinor} >= 0`),
  check("subscription_plan_versions_currency_check", sql`${table.currency} = 'UZS'`),
]);

export const marketplaceOrders = pgTable("marketplace_orders", {
  id: text("id").primaryKey(),
  externalId: text("external_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  customerUserId: text("customer_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  orderType: text("order_type").notNull(),
  status: text("status").notNull().default("DRAFT"),
  currency: text("currency").notNull().default("UZS"),
  totalAmountMinor: bigint("total_amount_minor", { mode: "number" }).notNull().default(0),
  acceptedPricingSnapshotId: text("accepted_pricing_snapshot_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  provider: text("provider"),
  providerStatus: text("provider_status"),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  expiresAt: text("expires_at"),
  settledAt: text("settled_at"),
  failedAt: text("failed_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("marketplace_orders_external_uidx").on(table.externalId),
  uniqueIndex("marketplace_orders_workspace_idempotency_uidx").on(table.workspaceId, table.idempotencyKey),
  index("marketplace_orders_workspace_status_idx").on(table.workspaceId, table.status, table.updatedAt),
  index("marketplace_orders_customer_idx").on(table.customerUserId, table.updatedAt),
  check("marketplace_orders_amount_check", sql`${table.totalAmountMinor} >= 0`),
  check("marketplace_orders_currency_check", sql`${table.currency} = 'UZS'`),
]);

export const orderItems = pgTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => marketplaceOrders.id, { onDelete: "restrict" }),
  itemType: text("item_type").notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  titleRu: text("title_ru").notNull(),
  titleUz: text("title_uz").notNull(),
  quantity: bigint("quantity", { mode: "number" }).notNull().default(1),
  unitAmountMinor: bigint("unit_amount_minor", { mode: "number" }).notNull(),
  baseAmountMinor: bigint("base_amount_minor", { mode: "number" }).notNull(),
  taxAmountMinor: bigint("tax_amount_minor", { mode: "number" }).notNull().default(0),
  totalAmountMinor: bigint("total_amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("UZS"),
  createdAt: text("created_at").notNull(),
  titleEn: text("title_en"),
}, (table) => [
  index("order_items_order_idx").on(table.orderId, table.createdAt),
  check("order_items_quantity_check", sql`${table.quantity} > 0`),
  check("order_items_amounts_check", sql`${table.unitAmountMinor} >= 0 AND ${table.baseAmountMinor} >= 0 AND ${table.taxAmountMinor} >= 0 AND ${table.totalAmountMinor} >= 0`),
  check("order_items_currency_check", sql`${table.currency} = 'UZS'`),
]);

export const pricingSnapshots = pgTable("pricing_snapshots", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => marketplaceOrders.id, { onDelete: "restrict" }),
  version: bigint("version", { mode: "number" }).notNull(),
  lawyerBaseAmountMinor: bigint("lawyer_base_amount_minor", { mode: "number" }).notNull(),
  lawyerVatAmountMinor: bigint("lawyer_vat_amount_minor", { mode: "number" }).notNull(),
  lawyerGrossAmountMinor: bigint("lawyer_gross_amount_minor", { mode: "number" }).notNull(),
  juroBaseAmountMinor: bigint("juro_base_amount_minor", { mode: "number" }).notNull(),
  juroVatAmountMinor: bigint("juro_vat_amount_minor", { mode: "number" }).notNull(),
  juroGrossAmountMinor: bigint("juro_gross_amount_minor", { mode: "number" }).notNull(),
  subscriptionCreditMinor: bigint("subscription_credit_minor", { mode: "number" }).notNull().default(0),
  discountAmountMinor: bigint("discount_amount_minor", { mode: "number" }).notNull().default(0),
  providerCommissionRateBasisPoints: bigint("provider_commission_rate_basis_points", { mode: "number" }).notNull().default(0),
  providerCommissionBaseMinor: bigint("provider_commission_base_minor", { mode: "number" }).notNull().default(0),
  providerCommissionAmountMinor: bigint("provider_commission_amount_minor", { mode: "number" }).notNull().default(0),
  providerCommissionAllocationJson: text("provider_commission_allocation_json").notNull(),
  clientTotalMinor: bigint("client_total_minor", { mode: "number" }).notNull(),
  expectedProviderSettlementMinor: bigint("expected_provider_settlement_minor", { mode: "number" }).notNull(),
  lawyerExpectedPayoutMinor: bigint("lawyer_expected_payout_minor", { mode: "number" }).notNull(),
  juroExpectedRevenueMinor: bigint("juro_expected_revenue_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("UZS"),
  taxPolicyVersionId: text("tax_policy_version_id").notNull(),
  pricingPolicyVersionId: text("pricing_policy_version_id").notNull().references(() => pricingPolicyVersions.id, { onDelete: "restrict" }),
  calculationHash: text("calculation_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("pricing_snapshots_order_version_uidx").on(table.orderId, table.version),
  uniqueIndex("pricing_snapshots_calculation_hash_uidx").on(table.calculationHash),
  index("pricing_snapshots_policy_idx").on(table.pricingPolicyVersionId, table.createdAt),
  check("pricing_snapshots_nonnegative_check", sql`${table.lawyerBaseAmountMinor} >= 0 AND ${table.lawyerVatAmountMinor} >= 0 AND ${table.lawyerGrossAmountMinor} >= 0 AND ${table.juroBaseAmountMinor} >= 0 AND ${table.juroVatAmountMinor} >= 0 AND ${table.juroGrossAmountMinor} >= 0 AND ${table.subscriptionCreditMinor} >= 0 AND ${table.discountAmountMinor} >= 0 AND ${table.providerCommissionAmountMinor} >= 0 AND ${table.clientTotalMinor} >= 0 AND ${table.expectedProviderSettlementMinor} >= 0 AND ${table.lawyerExpectedPayoutMinor} >= 0 AND ${table.juroExpectedRevenueMinor} >= 0`),
  check("pricing_snapshots_currency_check", sql`${table.currency} = 'UZS'`),
]);

export const taxComponents = pgTable("tax_components", {
  id: text("id").primaryKey(),
  pricingSnapshotId: text("pricing_snapshot_id").notNull().references(() => pricingSnapshots.id, { onDelete: "restrict" }),
  providerType: text("provider_type").notNull(),
  providerId: text("provider_id").notNull(),
  taxProfileId: text("tax_profile_id").notNull().references(() => taxProfiles.id, { onDelete: "restrict" }),
  taxableBaseMinor: bigint("taxable_base_minor", { mode: "number" }).notNull(),
  rateBasisPoints: bigint("rate_basis_points", { mode: "number" }).notNull(),
  taxAmountMinor: bigint("tax_amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("UZS"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("tax_components_snapshot_idx").on(table.pricingSnapshotId, table.createdAt),
  check("tax_components_amounts_check", sql`${table.taxableBaseMinor} >= 0 AND ${table.taxAmountMinor} >= 0 AND ${table.rateBasisPoints} BETWEEN 0 AND 10000`),
]);

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  planCode: text("plan_code").notNull(),
  planVersionId: text("plan_version_id").references(() => subscriptionPlanVersions.id, { onDelete: "restrict" }),
  orderId: text("order_id").references(() => marketplaceOrders.id, { onDelete: "restrict" }),
  status: text("status").notNull(),
  billingPeriod: text("billing_period"),
  autoRenewConsentAt: text("auto_renew_consent_at"),
  startedAt: text("started_at"),
  currentPeriodEndsAt: text("current_period_ends_at"),
  cancelAtPeriodEnd: booleanInteger("cancel_at_period_end").notNull().default(false),
  gracePeriodEndsAt: text("grace_period_ends_at"),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  ...timestamps,
}, (table) => [uniqueIndex("subscriptions_workspace_uidx").on(table.workspaceId), index("subscriptions_status_idx").on(table.status, table.updatedAt)]);

export const subscriptionEntitlements = pgTable("subscription_entitlements", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "restrict" }),
  entitlementCode: text("entitlement_code").notNull(),
  limitValue: bigint("limit_value", { mode: "number" }),
  unit: text("unit").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  rolloverAllowed: booleanInteger("rollover_allowed").notNull().default(false),
  metadataJson: text("metadata_json").notNull().default("{}"),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("subscription_entitlements_period_uidx").on(table.subscriptionId, table.entitlementCode, table.periodStart),
  index("subscription_entitlements_active_idx").on(table.subscriptionId, table.periodEnd),
  check("subscription_entitlements_limit_check", sql`${table.limitValue} IS NULL OR ${table.limitValue} >= 0`),
]);

export const entitlementUsage = pgTable("entitlement_usage", {
  id: text("id").primaryKey(),
  entitlementId: text("entitlement_id").notNull().references(() => subscriptionEntitlements.id, { onDelete: "restrict" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
  orderId: text("order_id").references(() => marketplaceOrders.id, { onDelete: "restrict" }),
  quantity: bigint("quantity", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("reserved"),
  consumedAt: text("consumed_at"),
  releasedAt: text("released_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("entitlement_usage_workspace_idempotency_uidx").on(table.workspaceId, table.idempotencyKey),
  index("entitlement_usage_entitlement_status_idx").on(table.entitlementId, table.status, table.createdAt),
  check("entitlement_usage_quantity_check", sql`${table.quantity} > 0`),
]);

export const subscriptionInvoices = pgTable("subscription_invoices", {
  id: text("id").primaryKey(),
  externalId: text("external_id").notNull(),
  subscriptionId: text("subscription_id").references(() => subscriptions.id, { onDelete: "restrict" }),
  orderId: text("order_id").notNull().references(() => marketplaceOrders.id, { onDelete: "restrict" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  invoiceNumber: text("invoice_number").notNull(),
  status: text("status").notNull().default("draft"),
  subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
  taxAmountMinor: bigint("tax_amount_minor", { mode: "number" }).notNull(),
  totalAmountMinor: bigint("total_amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("UZS"),
  dueAt: text("due_at"),
  issuedAt: text("issued_at"),
  paidAt: text("paid_at"),
  voidedAt: text("voided_at"),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("subscription_invoices_external_uidx").on(table.externalId),
  uniqueIndex("subscription_invoices_number_uidx").on(table.invoiceNumber),
  uniqueIndex("subscription_invoices_order_uidx").on(table.orderId),
  index("subscription_invoices_workspace_status_idx").on(table.workspaceId, table.status, table.createdAt),
  check("subscription_invoices_amounts_check", sql`${table.subtotalMinor} >= 0 AND ${table.taxAmountMinor} >= 0 AND ${table.totalAmountMinor} >= 0`),
]);

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  subscriptionId: text("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  providerPaymentId: text("provider_payment_id"),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("UZS"),
  status: text("status").notNull(),
  receiptObjectKey: text("receipt_object_key"),
  ...timestamps,
}, (table) => [index("payments_workspace_idx").on(table.workspaceId, table.createdAt)]);

export const paymentAttempts = pgTable("payment_attempts", {
  id: text("id").primaryKey(),
  externalId: text("external_id").notNull(),
  orderId: text("order_id").notNull().references(() => marketplaceOrders.id, { onDelete: "restrict" }),
  paymentId: text("payment_id").references(() => payments.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  providerAttemptId: text("provider_attempt_id"),
  providerStatus: text("provider_status"),
  internalStatus: text("internal_status").notNull().default("created"),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("UZS"),
  idempotencyKey: text("idempotency_key").notNull(),
  checkoutUrl: text("checkout_url"),
  expiresAt: text("expires_at"),
  settledAt: text("settled_at"),
  failedAt: text("failed_at"),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("payment_attempts_external_uidx").on(table.externalId),
  uniqueIndex("payment_attempts_order_idempotency_uidx").on(table.orderId, table.idempotencyKey),
  uniqueIndex("payment_attempts_provider_uidx").on(table.provider, table.providerAttemptId).where(sql`${table.providerAttemptId} IS NOT NULL`),
  index("payment_attempts_order_status_idx").on(table.orderId, table.internalStatus, table.updatedAt),
  check("payment_attempts_amount_check", sql`${table.amountMinor} >= 0`),
]);

export const paymentProviderEvents = pgTable("payment_provider_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  eventType: text("event_type").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  signatureVerified: booleanInteger("signature_verified").notNull().default(false),
  internalStatus: text("internal_status").notNull().default("received"),
  orderId: text("order_id").references(() => marketplaceOrders.id, { onDelete: "restrict" }),
  paymentAttemptId: text("payment_attempt_id").references(() => paymentAttempts.id, { onDelete: "restrict" }),
  receivedAt: text("received_at").notNull(),
  processedAt: text("processed_at"),
  failedAt: text("failed_at"),
  failureCode: text("failure_code"),
}, (table) => [
  uniqueIndex("payment_provider_events_provider_event_uidx").on(table.provider, table.providerEventId),
  index("payment_provider_events_status_idx").on(table.internalStatus, table.receivedAt),
  check("payment_provider_events_sha_check", sql`length(${table.payloadSha256}) = 64`),
]);

export const ledgerAccounts = pgTable("ledger_accounts", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type").notNull(),
  ownerId: text("owner_id").notNull(),
  code: text("code").notNull(),
  currency: text("currency").notNull().default("UZS"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("ledger_accounts_owner_code_uidx").on(table.ownerType, table.ownerId, table.code, table.currency),
  index("ledger_accounts_code_idx").on(table.code, table.status),
  check("ledger_accounts_currency_check", sql`${table.currency} = 'UZS'`),
]);

export const ledgerTransactions = pgTable("ledger_transactions", {
  id: text("id").primaryKey(),
  externalId: text("external_id").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  orderId: text("order_id").references(() => marketplaceOrders.id, { onDelete: "restrict" }),
  paymentId: text("payment_id").references(() => payments.id, { onDelete: "restrict" }),
  transactionType: text("transaction_type").notNull(),
  status: text("status").notNull().default("draft"),
  idempotencyKey: text("idempotency_key").notNull(),
  currency: text("currency").notNull().default("UZS"),
  debitTotalMinor: bigint("debit_total_minor", { mode: "number" }).notNull().default(0),
  creditTotalMinor: bigint("credit_total_minor", { mode: "number" }).notNull().default(0),
  occurredAt: text("occurred_at").notNull(),
  postedAt: text("posted_at"),
  failedAt: text("failed_at"),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("ledger_transactions_external_uidx").on(table.externalId),
  uniqueIndex("ledger_transactions_workspace_idempotency_uidx").on(table.workspaceId, table.idempotencyKey),
  index("ledger_transactions_order_idx").on(table.orderId, table.createdAt),
  check("ledger_transactions_totals_check", sql`${table.debitTotalMinor} >= 0 AND ${table.creditTotalMinor} >= 0`),
  check("ledger_transactions_posted_balance_check", sql`${table.status} != 'posted' OR ${table.debitTotalMinor} = ${table.creditTotalMinor}`),
]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull().references(() => ledgerTransactions.id, { onDelete: "restrict" }),
  accountId: text("account_id").notNull().references(() => ledgerAccounts.id, { onDelete: "restrict" }),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  side: text("side").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("UZS"),
  memo: text("memo").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("ledger_entries_transaction_sequence_uidx").on(table.transactionId, table.sequence),
  index("ledger_entries_account_idx").on(table.accountId, table.createdAt),
  check("ledger_entries_side_check", sql`${table.side} IN ('DEBIT','CREDIT')`),
  check("ledger_entries_amount_check", sql`${table.amountMinor} > 0`),
  check("ledger_entries_currency_check", sql`${table.currency} = 'UZS'`),
]);

export const accountDeletionChallenges = pgTable(
  "account_deletion_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => authSessions.id, { onDelete: "set null" }),
    emailHash: text("email_hash").notNull(),
    locale: text("locale").notNull(),
    codeSalt: text("code_salt").notNull(),
    codeHash: text("code_hash").notNull(),
    attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
    maxAttempts: bigint("max_attempts", { mode: "number" }).notNull().default(5),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    consumedByOperationId: text("consumed_by_operation_id"),
    invalidatedAt: text("invalidated_at"),
    createdAt: text("created_at").notNull(),
    emailLookupHash: text("email_lookup_hash"),
    emailLookupKeyVersion: text("email_lookup_key_version"),
    codeHmac: text("code_hmac"),
    codeKeyVersion: text("code_key_version"),
  },
  (table) => [
    check(
      "account_deletion_challenges_locale_check",
      sql`${table.locale} IN ('ru','uz','en')`,
    ),
    check(
      "account_deletion_challenges_attempts_check",
      sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 10`,
    ),
    uniqueIndex("account_deletion_challenges_operation_uidx").on(
      table.consumedByOperationId,
    ),
    uniqueIndex("account_deletion_challenges_active_user_uidx")
      .on(table.userId)
      .where(sql`${table.consumedAt} IS NULL AND ${table.invalidatedAt} IS NULL`),
    index("account_deletion_challenges_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("account_deletion_challenges_expiry_idx").on(table.expiresAt),
  ],
);

export const accountDeletionRequests = pgTable("account_deletion_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  verificationChallengeId: text("verification_challenge_id").references(() => accountDeletionChallenges.id, { onDelete: "restrict" }),
  requestedSessionId: text("requested_session_id").references(() => authSessions.id, { onDelete: "set null" }),
  status: text("status").notNull().default("requested"),
  deletionMode: text("deletion_mode").notNull().default("recoverable_30d"),
  subjectHash: text("subject_hash"),
  subjectKeyVersion: text("subject_key_version"),
  reason: text("reason"),
  verificationMethod: text("verification_method"),
  verifiedAt: text("verified_at"),
  requestedAt: text("requested_at").notNull(),
  scheduledPurgeAt: text("scheduled_purge_at"),
  cancelledAt: text("cancelled_at"),
  purgeStartedAt: text("purge_started_at"),
  purgeIrreversibleAt: text("purge_irreversible_at"),
  purgeLeaseOwner: text("purge_lease_owner"),
  purgeLeaseExpiresAt: text("purge_lease_expires_at"),
  failureCode: text("failure_code"),
  completedAt: text("completed_at"),
}, (table) => [
  index("account_deletion_requests_user_idx").on(
    table.userId,
    table.requestedAt,
  ),
  uniqueIndex("account_deletion_requests_challenge_uidx").on(
    table.verificationChallengeId,
  ),
  uniqueIndex("account_deletion_requests_active_user_uidx")
    .on(table.userId)
    .where(sql`${table.status} IN ('requested','reviewing','scheduled','purging','blocked')`),
  index("account_deletion_requests_schedule_idx").on(
    table.status,
    table.scheduledPurgeAt,
  ),
]);

export const accountDeletionLifecycleEvents = pgTable(
  "account_deletion_lifecycle_events",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    subjectHash: text("subject_hash").notNull(),
    subjectKeyVersion: text("subject_key_version").notNull(),
    eventType: text("event_type").notNull(),
    deletionMode: text("deletion_mode").notNull(),
    policyVersion: text("policy_version").notNull(),
    summaryJson: text("summary_json").notNull().default("{}"),
    previousHash: text("previous_hash").notNull(),
    eventHash: text("event_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "account_deletion_lifecycle_event_type_check",
      sql`${table.eventType} IN ('scheduled','cancelled','purge_started','blocked','completed','failed')`,
    ),
    check(
      "account_deletion_lifecycle_mode_check",
      sql`${table.deletionMode} IN ('immediate','recoverable_30d')`,
    ),
    check(
      "account_deletion_lifecycle_hash_check",
      sql`length(${table.subjectHash}) = 64 AND length(${table.previousHash}) = 64 AND length(${table.eventHash}) = 64`,
    ),
    uniqueIndex("account_deletion_lifecycle_hash_uidx").on(table.eventHash),
    uniqueIndex("account_deletion_lifecycle_chain_uidx").on(
      table.requestId,
      table.previousHash,
    ),
    index("account_deletion_lifecycle_request_idx").on(
      table.requestId,
      table.createdAt,
    ),
    index("account_deletion_lifecycle_subject_idx").on(
      table.subjectHash,
      table.createdAt,
    ),
  ],
);

export const accountDeletionPurgeEvidence = pgTable(
  "account_deletion_purge_evidence",
  {
    requestId: text("request_id").primaryKey(),
    subjectHash: text("subject_hash").notNull(),
    subjectKeyVersion: text("subject_key_version").notNull(),
    deletionMode: text("deletion_mode").notNull(),
    policyVersion: text("policy_version").notNull(),
    requestedAt: text("requested_at").notNull(),
    completedAt: text("completed_at").notNull(),
    r2DeletedCount: bigint("r2_deleted_count", { mode: "number" }).notNull().default(0),
    d1DeletedCount: bigint("d1_deleted_count", { mode: "number" }).notNull().default(0),
    redactedCount: bigint("redacted_count", { mode: "number" }).notNull().default(0),
    retainedEvidenceJson: text("retained_evidence_json").notNull().default("[]"),
    evidenceHash: text("evidence_hash").notNull(),
  },
  (table) => [
    check(
      "account_deletion_purge_mode_check",
      sql`${table.deletionMode} IN ('immediate','recoverable_30d')`,
    ),
    check(
      "account_deletion_purge_counts_check",
      sql`${table.r2DeletedCount} >= 0 AND ${table.d1DeletedCount} >= 0 AND ${table.redactedCount} >= 0`,
    ),
    check(
      "account_deletion_purge_hash_check",
      sql`length(${table.subjectHash}) = 64 AND length(${table.evidenceHash}) = 64`,
    ),
    uniqueIndex("account_deletion_purge_hash_uidx").on(table.evidenceHash),
    index("account_deletion_purge_subject_idx").on(
      table.subjectHash,
      table.completedAt,
    ),
  ],
);

export const documentAnalyses = pgTable("document_analyses", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  uploadedFileId: text("uploaded_file_id").notNull().references(() => documentFiles.id, { onDelete: "cascade" }),
  caseId: text("case_id").references(() => cases.id, { onDelete: "set null" }),
  caseLinkRevision: bigint("case_link_revision", { mode: "number" }).notNull().default(0),
  caseLinkedByUserId: text("case_linked_by_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  summaryJson: text("summary_json"),
  resultSha256: text("result_sha256"),
  errorCode: text("error_code"),
  consentVersion: text("consent_version").notNull(),
  resourceScope: text("resource_scope"),
  abandonedAfter: text("abandoned_after"),
  deletionRequestedAt: text("deletion_requested_at"),
  deletionReason: text("deletion_reason"),
  purgeAttemptCount: bigint("purge_attempt_count", { mode: "number" }).notNull().default(0),
  lastPurgeError: text("last_purge_error"),
  ...timestamps,
}, (table) => [
  index("document_analyses_workspace_idx").on(table.workspaceId, table.createdAt),
  index("document_analyses_case_idx").on(table.workspaceId, table.caseId, table.updatedAt),
  index("document_analyses_resource_quota_idx").on(table.workspaceId, table.ownerUserId, table.resourceScope, table.deletionRequestedAt),
  index("document_analyses_abandoned_idx").on(table.resourceScope, table.deletionRequestedAt, table.abandonedAfter, table.updatedAt, table.id),
  index("document_analyses_purge_retry_idx").on(table.deletionRequestedAt, table.updatedAt, table.id),
  uniqueIndex("document_analyses_file_uidx").on(table.uploadedFileId),
  check("document_analyses_resource_scope_check", sql`${table.resourceScope} IS NULL OR ${table.resourceScope} = 'interactive_analysis'`),
  check("document_analyses_deletion_reason_check", sql`${table.deletionReason} IS NULL OR ${table.deletionReason} IN ('owner_request','abandoned_upload')`),
  check("document_analyses_purge_attempt_check", sql`${table.purgeAttemptCount} >= 0`),
]);

export const builderDocumentAnalysisHandoffs = pgTable("builder_document_analysis_handoffs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  documentRevision: bigint("document_revision", { mode: "number" }).notNull(),
  documentContentSha256: text("document_content_sha256").notNull(),
  fileId: text("file_id").notNull().references(() => documentFiles.id, { onDelete: "cascade" }),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  locale: text("locale").notNull(),
  idempotencyKeySha256: text("idempotency_key_sha256").notNull(),
  status: text("status").notNull().default("pending"),
  attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
  lastErrorCode: text("last_error_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("builder_analysis_request_uidx").on(table.workspaceId, table.userId, table.idempotencyKeySha256),
  uniqueIndex("builder_analysis_file_uidx").on(table.fileId),
  uniqueIndex("builder_analysis_analysis_uidx").on(table.analysisId),
  index("builder_analysis_document_idx").on(table.documentId, table.createdAt),
  check("builder_analysis_revision_check", sql`${table.documentRevision}>0`),
  check("builder_analysis_mode_check", sql`${table.mode} IN ('quick','full','expert')`),
  check("builder_analysis_locale_check", sql`${table.locale} IN ('ru','uz','en')`),
  check("builder_analysis_status_check", sql`${table.status} IN ('pending','ready')`),
  check("builder_analysis_attempt_check", sql`${table.attemptCount}>=0`),
  check(
    "builder_analysis_hash_check",
    sql`length(${table.documentContentSha256}) = 64 AND length(${table.idempotencyKeySha256}) = 64`,
  ),
  check(
    "builder_analysis_state_check",
    sql`${table.status} = 'pending' OR (${table.status} = 'ready' AND ${table.lastErrorCode} IS NULL)`,
  ),
]);

export const analysisCaseLinkEvents = pgTable("analysis_case_link_events", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  // The analysis FK owns lifecycle. Tenant/user/case IDs are immutable evidence
  // proved by the insert guard; extra sibling FKs would make account cascades
  // order-dependent in SQLite.
  workspaceId: text("workspace_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  fromCaseId: text("from_case_id"),
  toCaseId: text("to_case_id"),
  mutationVersion: bigint("mutation_version", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("analysis_case_link_events_version_uidx").on(table.analysisId, table.mutationVersion),
  uniqueIndex("analysis_case_link_events_idempotency_uidx").on(table.workspaceId, table.ownerUserId, table.idempotencyKey),
  index("analysis_case_link_events_case_idx").on(table.workspaceId, table.toCaseId, table.createdAt),
  check("analysis_case_link_events_change_check", sql`NOT (${table.fromCaseId} IS ${table.toCaseId})`),
  check("analysis_case_link_events_version_check", sql`${table.mutationVersion} >= 1`),
  check("analysis_case_link_events_hash_check", sql`length(${table.requestHash}) = 64`),
  check("analysis_case_link_events_idempotency_check", sql`length(${table.idempotencyKey}) BETWEEN 16 AND 180`),
]);

export const analysisDocumentVersions = pgTable("analysis_document_versions", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  version: bigint("version", { mode: "number" }).notNull(),
  parentVersionId: text("parent_version_id").references(
    (): AnyPgColumn => analysisDocumentVersions.id,
  ),
  sourceKind: text("source_kind").notNull(),
  r2Key: text("r2_key").notNull(),
  objectWriteId: text("object_write_id"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  idempotencyKey: text("idempotency_key"),
  selectionSha256: text("selection_sha256"),
  revisionIdsJson: text("revision_ids_json").notNull().default("[]"),
  createdByUserId: text("created_by_user_id").references(() => userProfiles.id),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("analysis_document_versions_number_uidx").on(table.analysisId, table.version),
  uniqueIndex("analysis_document_versions_r2_key_uidx").on(table.r2Key),
  uniqueIndex("analysis_document_versions_object_write_uidx")
    .on(table.objectWriteId)
    .where(sql`${table.objectWriteId} IS NOT NULL`),
  uniqueIndex("analysis_document_versions_idempotency_uidx")
    .on(table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  index("analysis_document_versions_workspace_idx").on(table.workspaceId, table.createdAt),
  check("analysis_document_versions_version_check", sql`${table.version} >= 1`),
  check("analysis_document_versions_kind_check", sql`${table.sourceKind} IN ('extracted','corrected')`),
  check("analysis_document_versions_mime_check", sql`${table.mimeType} = 'text/markdown; charset=utf-8'`),
  check("analysis_document_versions_size_check", sql`${table.sizeBytes} > 0`),
  check("analysis_document_versions_sha_check", sql`length(${table.sha256}) = 64`),
  check("analysis_document_versions_selection_check", sql`${table.selectionSha256} IS NULL OR length(${table.selectionSha256}) = 64`),
  check("analysis_document_versions_revisions_check", sql`json_valid(${table.revisionIdsJson}) AND json_type(${table.revisionIdsJson}) = 'array'`),
]);

export const analysisVersionObjectWrites = pgTable("analysis_version_object_writes", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  targetVersion: bigint("target_version", { mode: "number" }).notNull(),
  sourceKind: text("source_kind").notNull(),
  r2Key: text("r2_key").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  status: text("status").notNull().default("pending"),
  versionId: text("version_id"),
  attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
  lastErrorCode: text("last_error_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  reconciledAt: text("reconciled_at"),
}, (table) => [
  uniqueIndex("analysis_version_object_writes_r2_uidx").on(table.r2Key),
  uniqueIndex("analysis_version_object_writes_version_uidx")
    .on(table.versionId)
    .where(sql`${table.versionId} IS NOT NULL`),
  index("analysis_version_object_writes_reconcile_idx").on(table.status, table.updatedAt, table.id),
  index("analysis_version_object_writes_owner_idx").on(table.ownerUserId, table.createdAt),
  check("analysis_version_object_writes_version_check", sql`${table.targetVersion} >= 1`),
  check("analysis_version_object_writes_kind_check", sql`${table.sourceKind} IN ('extracted','corrected')`),
  check("analysis_version_object_writes_size_check", sql`${table.sizeBytes} > 0`),
  check("analysis_version_object_writes_sha_check", sql`length(${table.sha256}) = 64`),
  check("analysis_version_object_writes_attempt_check", sql`${table.attemptCount} >= 0`),
  check("analysis_version_object_writes_status_check", sql`${table.status} IN ('pending','attaching','attached','deleting','deleted')`),
]);

export const fileScanResults = pgTable("file_scan_results", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  fileId: text("file_id").notNull().references(() => documentFiles.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  verdict: text("verdict").notNull(),
  provider: text("provider").notNull(),
  engine: text("engine").notNull(),
  engineVersion: text("engine_version").notNull(),
  signatureVersion: text("signature_version").notNull(),
  providerScanId: text("provider_scan_id").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  responseSha256: text("response_sha256").notNull(),
  threatsJson: text("threats_json").notNull(),
  completedAt: text("completed_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("file_scan_results_analysis_uidx").on(table.analysisId),
  uniqueIndex("file_scan_results_file_uidx").on(table.fileId),
  index("file_scan_results_workspace_created_idx").on(table.workspaceId, table.createdAt),
  check("file_scan_results_verdict_check", sql`${table.verdict} IN ('clean','infected')`),
  check("file_scan_results_source_sha_check", sql`length(${table.sourceSha256}) = 64`),
  check("file_scan_results_response_sha_check", sql`length(${table.responseSha256}) = 64`),
]);

export const fileExtractions = pgTable("file_extractions", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  fileId: text("file_id").notNull().references(() => documentFiles.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  method: text("method").notNull(),
  provider: text("provider").notNull(),
  model: text("model"),
  sourceSha256: text("source_sha256").notNull(),
  r2Key: text("r2_key"),
  textSha256: text("text_sha256"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  tokenEstimate: bigint("token_estimate", { mode: "number" }),
  detectedMimeType: text("detected_mime_type"),
  detectedLanguage: text("detected_language"),
  textQuality: text("text_quality"),
  warningsJson: text("warnings_json").notNull().default("[]"),
  errorCode: text("error_code"),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("file_extractions_analysis_uidx").on(table.analysisId),
  uniqueIndex("file_extractions_r2_key_uidx").on(table.r2Key),
  index("file_extractions_workspace_idx").on(table.workspaceId, table.createdAt),
  index("file_extractions_status_idx").on(table.status, table.updatedAt),
  check("file_extractions_status_check", sql`${table.status} IN ('queued','processing','retrying','completed','failed')`),
  check("file_extractions_method_check", sql`${table.method} IN ('workers_ai_markdown','local_document_conversion')`),
  check("file_extractions_source_sha_check", sql`length(${table.sourceSha256}) = 64`),
  check("file_extractions_text_sha_check", sql`${table.textSha256} IS NULL OR length(${table.textSha256}) = 64`),
  check("file_extractions_size_check", sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`),
  check("file_extractions_token_check", sql`${table.tokenEstimate} IS NULL OR ${table.tokenEstimate} >= 0`),
]);

export const documentRisks = pgTable("document_risks", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  level: text("level").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  excerpt: text("excerpt"),
  confidencePercent: bigint("confidence_percent", { mode: "number" }),
  createdAt: text("created_at").notNull(),
  riskType: text("risk_type").notNull().default("document_internal"),
  clause: text("clause"),
  page: bigint("page", { mode: "number" }),
  recommendation: text("recommendation"),
  proposedWording: text("proposed_wording"),
  legalBasisSourceIdsJson: text("legal_basis_source_ids_json").notNull().default("[]"),
}, (table) => [
  index("document_risks_analysis_idx").on(table.analysisId, table.level),
  check("document_risks_type_check", sql`${table.riskType} IN ('document_internal','legal_compliance')`),
  check("document_risks_page_check", sql`${table.page} IS NULL OR ${table.page} > 0`),
]);

export const suggestedRevisions = pgTable("suggested_revisions", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  riskId: text("risk_id").notNull().references(() => documentRisks.id, { onDelete: "cascade" }),
  sourceVersionId: text("source_version_id").notNull().references(() => analysisDocumentVersions.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  originalText: text("original_text").notNull(),
  proposedText: text("proposed_text").notNull(),
  status: text("status").notNull().default("pending"),
  decidedByUserId: text("decided_by_user_id").references(() => userProfiles.id),
  decidedAt: text("decided_at"),
  appliedVersionId: text("applied_version_id").references(() => analysisDocumentVersions.id),
  ...timestamps,
}, (table) => [
  uniqueIndex("suggested_revisions_risk_uidx").on(table.riskId),
  index("suggested_revisions_analysis_status_idx").on(table.analysisId, table.status, table.createdAt),
  index("suggested_revisions_workspace_idx").on(table.workspaceId, table.updatedAt),
  check("suggested_revisions_status_check", sql`${table.status} IN ('pending','accepted','rejected','applied','stale','ambiguous')`),
  check("suggested_revisions_original_check", sql`length(trim(${table.originalText})) > 0`),
  check("suggested_revisions_proposed_check", sql`length(trim(${table.proposedText})) > 0`),
  check("suggested_revisions_decision_check", sql`
    (${table.status} = 'pending' AND ${table.decidedByUserId} IS NULL AND ${table.decidedAt} IS NULL AND ${table.appliedVersionId} IS NULL)
    OR (${table.status} IN ('accepted','rejected') AND ${table.decidedByUserId} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND ${table.appliedVersionId} IS NULL)
    OR (${table.status} = 'applied' AND ${table.decidedByUserId} IS NOT NULL AND ${table.decidedAt} IS NOT NULL AND ${table.appliedVersionId} IS NOT NULL)
    OR (${table.status} IN ('stale','ambiguous') AND ${table.decidedByUserId} IS NULL AND ${table.decidedAt} IS NOT NULL AND ${table.appliedVersionId} IS NULL)
  `),
]);

export const analysisExports = pgTable("analysis_exports", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  status: text("status").notNull(),
  r2Key: text("r2_key"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  sha256: text("sha256"),
  idempotencyKey: text("idempotency_key").notNull(),
  errorCode: text("error_code"),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("analysis_exports_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("analysis_exports_r2_key_uidx").on(table.r2Key),
  index("analysis_exports_analysis_idx").on(table.analysisId, table.createdAt),
  index("analysis_exports_workspace_idx").on(table.workspaceId, table.createdAt),
  index("analysis_exports_status_idx").on(table.status, table.updatedAt),
  check("analysis_exports_format_check", sql`${table.format} = 'json'`),
  check("analysis_exports_status_check", sql`${table.status} IN ('queued','processing','retrying','completed','failed')`),
  check("analysis_exports_size_check", sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`),
  check("analysis_exports_sha_check", sql`${table.sha256} IS NULL OR length(${table.sha256}) = 64`),
  check("analysis_exports_completion_check", sql`
    (${table.status} = 'completed'
      AND ${table.r2Key} IS NOT NULL AND ${table.sizeBytes} IS NOT NULL
      AND ${table.sha256} IS NOT NULL AND ${table.completedAt} IS NOT NULL
      AND ${table.errorCode} IS NULL)
    OR (${table.status} <> 'completed' AND ${table.completedAt} IS NULL)
  `),
]);

export const analysisReportExports = pgTable("analysis_report_exports", {
  id: text("id").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  variant: text("variant").notNull().default("analysis_report"),
  sourceVersionId: text("source_version_id").references(() => analysisDocumentVersions.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  r2Key: text("r2_key"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  sha256: text("sha256"),
  idempotencyKey: text("idempotency_key").notNull(),
  errorCode: text("error_code"),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("analysis_report_exports_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("analysis_report_exports_r2_key_uidx").on(table.r2Key),
  index("analysis_report_exports_analysis_idx").on(table.analysisId, table.createdAt),
  index("analysis_report_exports_workspace_idx").on(table.workspaceId, table.createdAt),
  index("analysis_report_exports_status_idx").on(table.status, table.updatedAt),
  index("analysis_report_exports_source_version_idx").on(table.sourceVersionId, table.variant, table.createdAt),
  check("analysis_report_exports_format_check", sql`${table.format} IN ('pdf','docx')`),
  check("analysis_report_exports_status_check", sql`${table.status} IN ('queued','processing','retrying','completed','failed')`),
  check("analysis_report_exports_mime_check", sql`
    (${table.format} = 'pdf' AND ${table.mimeType} = 'application/pdf')
    OR (${table.format} = 'docx' AND ${table.mimeType} = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  `),
  check("analysis_report_exports_size_check", sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`),
  check("analysis_report_exports_sha_check", sql`${table.sha256} IS NULL OR length(${table.sha256}) = 64`),
  check("analysis_report_exports_completion_check", sql`
    (${table.status} = 'completed'
      AND ${table.r2Key} IS NOT NULL AND ${table.sizeBytes} IS NOT NULL
      AND ${table.sha256} IS NOT NULL AND ${table.completedAt} IS NOT NULL
      AND ${table.errorCode} IS NULL)
    OR (${table.status} <> 'completed' AND ${table.completedAt} IS NULL)
  `),
]);

export const analysisExportIdempotencyRegistry = pgTable("analysis_export_idempotency_registry", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  analysisId: text("analysis_id").notNull().references(() => documentAnalyses.id, { onDelete: "cascade" }),
  exportKind: text("export_kind").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("analysis_export_idempotency_registry_analysis_idx").on(table.analysisId, table.createdAt),
  check("analysis_export_idempotency_registry_kind_check", sql`${table.exportKind} IN ('json','report')`),
]);

export const documentComparisons = pgTable("document_comparisons", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  versionOneFileId: text("version_one_file_id").notNull().references(() => documentFiles.id, { onDelete: "restrict" }),
  versionTwoFileId: text("version_two_file_id").notNull().references(() => documentFiles.id, { onDelete: "restrict" }),
  caseId: text("case_id").references(() => cases.id, { onDelete: "set null" }),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  locale: text("locale").notNull(),
  summaryJson: text("summary_json"),
  versionOneJsonKey: text("version_one_json_key"),
  versionTwoJsonKey: text("version_two_json_key"),
  similarityPercent: bigint("similarity_percent", { mode: "number" }),
  overallRisk: text("overall_risk"),
  aiStatus: text("ai_status"),
  modelName: text("model_name"),
  modelVersion: text("model_version"),
  errorCode: text("error_code"),
  deletedAt: text("deleted_at"),
  ...timestamps,
}, (table) => [
  index("document_comparisons_workspace_idx").on(table.workspaceId, table.createdAt),
  index("document_comparisons_owner_idx").on(table.ownerUserId, table.createdAt),
  index("document_comparisons_status_idx").on(table.status, table.updatedAt),
]);

export const comparisonChanges = pgTable("comparison_changes", {
  id: text("id").primaryKey(),
  comparisonId: text("comparison_id").notNull().references(() => documentComparisons.id, { onDelete: "cascade" }),
  ordinal: bigint("ordinal", { mode: "number" }).notNull(),
  changeType: text("change_type").notNull(),
  beforeSectionId: text("before_section_id"),
  afterSectionId: text("after_section_id"),
  beforeLabel: text("before_label"),
  afterLabel: text("after_label"),
  beforeHeading: text("before_heading"),
  afterHeading: text("after_heading"),
  beforeText: text("before_text"),
  afterText: text("after_text"),
  wordDiffJson: text("word_diff_json").notNull(),
  summary: text("summary").notNull(),
  legalEffect: text("legal_effect").notNull(),
  affectedParty: text("affected_party").notNull(),
  riskEffect: text("risk_effect").notNull(),
  riskLevel: text("risk_level").notNull(),
  recommendation: text("recommendation").notNull(),
  sourceIdsJson: text("source_ids_json").notNull().default("[]"),
  confidencePercent: bigint("confidence_percent", { mode: "number" }),
  reviewedAt: text("reviewed_at"),
  reviewDecision: text("review_decision"),
  decidedByUserId: text("decided_by_user_id").references(() => userProfiles.id, { onDelete: "set null" }),
  decidedAt: text("decided_at"),
  reviewDecisionVersion: bigint("review_decision_version", { mode: "number" }).notNull().default(0),
  reviewDecisionEventId: text("review_decision_event_id"),
  extractionWarning: booleanInteger("extraction_warning").notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("comparison_changes_order_uidx").on(table.comparisonId, table.ordinal),
  uniqueIndex("comparison_changes_decision_event_uidx")
    .on(table.reviewDecisionEventId)
    .where(sql`${table.reviewDecisionEventId} IS NOT NULL`),
  index("comparison_changes_type_idx").on(table.comparisonId, table.changeType),
  index("comparison_changes_risk_idx").on(table.comparisonId, table.riskLevel, table.riskEffect),
  index("comparison_changes_decision_idx").on(table.comparisonId, table.reviewDecision, table.ordinal),
]);

export const comparisonExports = pgTable("comparison_exports", {
  id: text("id").primaryKey(),
  comparisonId: text("comparison_id").notNull().references(() => documentComparisons.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => userProfiles.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  status: text("status").notNull(),
  r2Key: text("r2_key"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  sha256: text("sha256"),
  idempotencyKey: text("idempotency_key").notNull(),
  errorCode: text("error_code"),
  completedAt: text("completed_at"),
  ...timestamps,
}, (table) => [
  uniqueIndex("comparison_exports_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("comparison_exports_r2_key_uidx").on(table.r2Key),
  index("comparison_exports_comparison_idx").on(table.comparisonId, table.createdAt),
  index("comparison_exports_workspace_idx").on(table.workspaceId, table.createdAt),
  index("comparison_exports_status_idx").on(table.status, table.updatedAt),
  check("comparison_exports_format_check", sql`${table.format} IN ('pdf','docx')`),
  check("comparison_exports_status_check", sql`${table.status} IN ('queued','processing','retrying','completed','failed')`),
  check("comparison_exports_mime_check", sql`
    (${table.format}='pdf' AND ${table.mimeType}='application/pdf')
    OR (${table.format}='docx' AND ${table.mimeType}='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  `),
  check("comparison_exports_size_check", sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`),
  check("comparison_exports_sha_check", sql`${table.sha256} IS NULL OR length(${table.sha256})=64`),
  check("comparison_exports_completion_check", sql`
    (${table.status}='completed' AND ${table.r2Key} IS NOT NULL AND ${table.sizeBytes} IS NOT NULL
      AND ${table.sha256} IS NOT NULL AND ${table.completedAt} IS NOT NULL AND ${table.errorCode} IS NULL)
    OR (${table.status}<>'completed' AND ${table.completedAt} IS NULL)
  `),
]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  scope: text("scope").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull().default("started"),
  resultRef: text("result_ref"),
  expiresAt: text("expires_at").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idempotency_keys_expiry_idx").on(table.expiresAt),
  index("idempotency_keys_status_idx").on(table.status, table.updatedAt),
]);

export const jobOutbox = pgTable("job_outbox", {
  id: text("id").primaryKey(),
  queueBinding: text("queue_binding").notNull(),
  jobType: text("job_type").notNull(),
  schemaVersion: bigint("schema_version", { mode: "number" }).notNull().default(1),
  idempotencyKey: text("idempotency_key").notNull(),
  subjectId: text("subject_id").notNull(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  correlationId: text("correlation_id").notNull(),
  enqueuedAt: text("enqueued_at").notNull(),
  availableAt: text("available_at").notNull(),
  status: text("status").notNull().default("pending"),
  dispatchAttempts: bigint("dispatch_attempts", { mode: "number" }).notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  nextAttemptAt: text("next_attempt_at"),
  dispatchedAt: text("dispatched_at"),
  errorCode: text("error_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("job_outbox_idempotency_uidx").on(table.idempotencyKey),
  index("job_outbox_status_idx").on(table.status, table.availableAt),
  index("job_outbox_lease_idx").on(table.status, table.leaseExpiresAt),
  index("job_outbox_workspace_idx").on(table.workspaceId, table.createdAt),
]);

export const jobRuns = pgTable("job_runs", {
  id: text("id").primaryKey(),
  queueName: text("queue_name").notNull(),
  messageId: text("message_id").notNull(),
  jobType: text("job_type").notNull(),
  schemaVersion: bigint("schema_version", { mode: "number" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  subjectId: text("subject_id").notNull(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  correlationId: text("correlation_id").notNull(),
  envelopeHash: text("envelope_hash").notNull(),
  status: text("status").notNull().default("received"),
  attempt: bigint("attempt", { mode: "number" }).notNull().default(1),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  nextAttemptAt: text("next_attempt_at"),
  errorCode: text("error_code"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("job_runs_idempotency_uidx").on(table.idempotencyKey),
  uniqueIndex("job_runs_message_uidx").on(table.queueName, table.messageId),
  index("job_runs_status_idx").on(table.status, table.nextAttemptAt),
  index("job_runs_lease_idx").on(table.status, table.leaseExpiresAt),
  index("job_runs_workspace_idx").on(table.workspaceId, table.createdAt),
]);

export const scheduledLocks = pgTable("scheduled_locks", {
  name: text("name").primaryKey(),
  holderId: text("holder_id").notNull(),
  acquiredAt: text("acquired_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("scheduled_locks_expiry_idx").on(table.expiresAt),
]);

export const scheduledRuns = pgTable("scheduled_runs", {
  id: text("id").primaryKey(),
  scheduleName: text("schedule_name").notNull(),
  cron: text("cron").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  holderId: text("holder_id").notNull(),
  status: text("status").notNull().default("running"),
  errorCode: text("error_code"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("scheduled_runs_idempotency_uidx").on(table.idempotencyKey),
  index("scheduled_runs_schedule_idx").on(table.scheduleName, table.scheduledFor),
  index("scheduled_runs_status_idx").on(table.status, table.updatedAt),
]);

export const backupRuns = pgTable("backup_runs", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull(),
  backupType: text("backup_type").notNull(),
  status: text("status").notNull().default("requested"),
  schemaVersion: text("schema_version"),
  appVersion: text("app_version"),
  sourceBookmark: text("source_bookmark"),
  objectKey: text("object_key"),
  checksumSha256: text("checksum_sha256"),
  byteSize: bigint("byte_size", { mode: "number" }),
  manifestVersion: text("manifest_version"),
  verifiedAt: text("verified_at"),
  restoreTestedAt: text("restore_tested_at"),
  errorCode: text("error_code"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("backup_runs_environment_idx").on(table.environment, table.createdAt),
  index("backup_runs_status_idx").on(table.status, table.updatedAt),
]);

export const cleanupRuns = pgTable("cleanup_runs", {
  id: text("id").primaryKey(),
  environment: text("environment").notNull(),
  policyVersion: text("policy_version").notNull(),
  status: text("status").notNull().default("requested"),
  dryRun: booleanInteger("dry_run").notNull().default(true),
  cursor: text("cursor"),
  scannedCount: bigint("scanned_count", { mode: "number" }).notNull().default(0),
  deletedCount: bigint("deleted_count", { mode: "number" }).notNull().default(0),
  failedCount: bigint("failed_count", { mode: "number" }).notNull().default(0),
  errorCode: text("error_code"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("cleanup_runs_environment_idx").on(table.environment, table.createdAt),
  index("cleanup_runs_status_idx").on(table.status, table.updatedAt),
]);

export const documentEvaluationReviewEvents = pgTable("document_evaluation_review_events", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").notNull().references(() => userProfiles.id),
  actorSessionId: text("actor_session_id").notNull(),
  actorAssignmentId: text("actor_assignment_id").notNull().references(() => platformStaffAssignments.id),
  capability: text("capability").notNull(),
  requestAction: text("request_action").notNull(),
  evaluationRunId: text("evaluation_run_id").notNull(),
  corpusVersion: text("corpus_version").notNull(),
  packageId: text("package_id"),
  reviewVersion: bigint("review_version", { mode: "number" }).notNull().default(0),
  disposition: text("disposition"),
  artifactSha256: text("artifact_sha256"),
  artifactBytes: bigint("artifact_bytes", { mode: "number" }),
  fileId: text("file_id"),
  analysisId: text("analysis_id"),
  analysisRunId: text("analysis_run_id"),
  analysisResultSha256: text("analysis_result_sha256"),
  scanResultId: text("scan_result_id"),
  scanProvider: text("scan_provider"),
  provider: text("provider"),
  providerModel: text("provider_model"),
  providerResponseId: text("provider_response_id"),
  completedAt: text("completed_at"),
  actualFormat: text("actual_format"),
  actualDocumentType: text("actual_document_type"),
  criticalRisksDetected: bigint("critical_risks_detected", { mode: "number" }),
  datesAndSumsVerified: booleanInteger("dates_and_sums_verified"),
  ocrCharacterAccuracyBps: bigint("ocr_character_accuracy_bps", { mode: "number" }),
  userSideDetected: booleanInteger("user_side_detected"),
  userSideConfirmed: booleanInteger("user_side_confirmed"),
  comparisonPeerPackageId: text("comparison_peer_package_id"),
  comparisonId: text("comparison_id"),
  comparisonReviewed: booleanInteger("comparison_reviewed"),
  promptInjectionResisted: booleanInteger("prompt_injection_resisted"),
  applicationCommit: text("application_commit"),
  artifactManifestSha256: text("artifact_manifest_sha256"),
  resultCount: bigint("result_count", { mode: "number" }).notNull(),
  resultDigest: text("result_digest").notNull(),
  actorMfaVerifiedAt: text("actor_mfa_verified_at").notNull(),
  previousHash: text("previous_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("document_evaluation_event_hash_uidx").on(table.eventHash),
  uniqueIndex("document_evaluation_chain_uidx").on(table.actorUserId, table.previousHash),
  index("document_evaluation_run_package_idx").on(table.evaluationRunId, table.packageId, table.createdAt),
  index("document_evaluation_actor_created_idx").on(table.actorUserId, table.createdAt),
]);
