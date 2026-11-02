// Practice persistence extends the canonical JURO entities; native SQL also
// owns immutable-record triggers.
import type { PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  bigint,
  integer,
  boolean,
  jsonb,
  timestamp,
  date,
  numeric,
  unique,
  primaryKey,
  foreignKey,
  check,
  index,
} from "drizzle-orm/pg-core";
import {
  aiRuns,
  cases,
  contacts,
  documentFiles,
  documents,
  lawyerConsultations,
  tasks,
  userProfiles,
  workspaces,
} from "./schema";

export const practiceWorkspaces = pgTable(
  "practice_workspaces",
  {
    workspaceId: text("workspace_id").primaryKey(),
    enabled: boolean("enabled")
      .notNull()
      .default(sql`false`),
    pilotUntil: timestamp("pilot_until", {
      withTimezone: true,
      mode: "string",
    }),
    features: jsonb("features")
      .notNull()
      .default(sql`'{}'`),
    seatLimit: integer("seat_limit"),
    providerDetails: jsonb("provider_details")
      .notNull()
      .default(sql`'{}'`),
    settings: jsonb("settings")
      .notNull()
      .default(sql`'{}'`),
    grantedBy: text("granted_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_workspaces_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check("practice_workspaces_seat_limit_check", sql`seat_limit>0`),
    foreignKey({
      name: "practice_workspaces_granted_by_fkey",
      columns: [table.grantedBy],
      foreignColumns: [userProfiles.id],
    }),
  ],
);

export const practiceContacts = pgTable(
  "practice_contacts",
  {
    contactId: text("contact_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    email: text("email"),
    companyName: text("company_name"),
    requisites: jsonb("requisites")
      .notNull()
      .default(sql`'{}'`),
    linkedUserId: text("linked_user_id"),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_contacts_contact_id_fkey",
      columns: [table.contactId],
      foreignColumns: [contacts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_contacts_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check("practice_contacts_kind_check", sql`kind IN ('person','company')`),
    foreignKey({
      name: "practice_contacts_linked_user_id_fkey",
      columns: [table.linkedUserId],
      foreignColumns: [userProfiles.id],
    }),
    unique("practice_contacts_workspace_id_contact_id_key").on(
      table.workspaceId,
      table.contactId,
    ),
    index("practice_contacts_workspace").on(table.workspaceId, table.contactId),
  ],
);

export const practicePipelines = pgTable(
  "practice_pipelines",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    stages: jsonb("stages").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_pipelines_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check("practice_pipelines_stages_check", sql`jsonb_array_length(stages)>0`),
    unique("practice_pipelines_workspace_id_id_key").on(
      table.workspaceId,
      table.id,
    ),
  ],
);

export const practiceMatters = pgTable(
  "practice_matters",
  {
    caseId: text("case_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    contactId: text("contact_id").notNull(),
    pipelineId: text("pipeline_id").notNull(),
    stageId: text("stage_id").notNull(),
    source: text("source").notNull(),
    serviceType: text("service_type")
      .notNull()
      .default(sql`'legal_services'`),
    responsibleUserId: text("responsible_user_id").notNull(),
    expectedMinor: bigint("expected_minor", { mode: "number" })
      .notNull()
      .default(sql`0`),
    currency: text("currency")
      .notNull()
      .default(sql`'UZS'`),
    nextAction: text("next_action")
      .notNull()
      .default(sql`''`),
    clientStatus: text("client_status")
      .notNull()
      .default(sql`''`),
    customFields: jsonb("custom_fields")
      .notNull()
      .default(sql`'{}'`),
    revision: integer("revision")
      .notNull()
      .default(sql`1`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_matters_case_id_fkey",
      columns: [table.caseId],
      foreignColumns: [cases.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_matters_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_matters_responsible_user_id_fkey",
      columns: [table.responsibleUserId],
      foreignColumns: [userProfiles.id],
    }),
    check("practice_matters_expected_minor_check", sql`expected_minor>=0`),
    foreignKey({
      name: "practice_matters_workspace_id_contact_id_fkey",
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [
        practiceContacts.workspaceId,
        practiceContacts.contactId,
      ],
    }),
    foreignKey({
      name: "practice_matters_workspace_id_pipeline_id_fkey",
      columns: [table.workspaceId, table.pipelineId],
      foreignColumns: [practicePipelines.workspaceId, practicePipelines.id],
    }),
    unique("practice_matters_workspace_id_case_id_key").on(
      table.workspaceId,
      table.caseId,
    ),
    index("practice_matters_scope").on(
      table.workspaceId,
      table.responsibleUserId,
      table.stageId,
    ),
  ],
);

export const practiceAssignments = pgTable(
  "practice_assignments",
  {
    caseId: text("case_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_assignments_case_id_fkey",
      columns: [table.caseId],
      foreignColumns: [practiceMatters.caseId],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_assignments_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [userProfiles.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.caseId, table.userId] }),
  ],
);

export const practiceTasks = pgTable(
  "practice_tasks",
  {
    taskId: text("task_id").primaryKey(),
    assigneeUserId: text("assignee_user_id").notNull(),
    priority: text("priority").notNull(),
    clientVisible: boolean("client_visible")
      .notNull()
      .default(sql`false`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_tasks_task_id_fkey",
      columns: [table.taskId],
      foreignColumns: [tasks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_tasks_assignee_user_id_fkey",
      columns: [table.assigneeUserId],
      foreignColumns: [userProfiles.id],
    }),
    check(
      "practice_tasks_priority_check",
      sql`priority IN ('low','normal','high','urgent')`,
    ),
  ],
);

export const practiceEntries = pgTable(
  "practice_entries",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    authorUserId: text("author_user_id").notNull(),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    clientVisible: boolean("client_visible")
      .notNull()
      .default(sql`false`),
    confirmedBy: text("confirmed_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_entries_case_id_fkey",
      columns: [table.caseId],
      foreignColumns: [practiceMatters.caseId],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_entries_author_user_id_fkey",
      columns: [table.authorUserId],
      foreignColumns: [userProfiles.id],
    }),
    check(
      "practice_entries_kind_check",
      sql`kind IN ('note','message','milestone')`,
    ),
    foreignKey({
      name: "practice_entries_confirmed_by_fkey",
      columns: [table.confirmedBy],
      foreignColumns: [userProfiles.id],
    }),
    index("practice_entries_case").on(table.caseId, table.createdAt),
  ],
);

export const practiceInvitations = pgTable(
  "practice_invitations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    contactId: text("contact_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    acceptedBy: text("accepted_by"),
    acceptedAt: timestamp("accepted_at", {
      withTimezone: true,
      mode: "string",
    }),
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "string",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_invitations_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    unique("practice_invitations_token_hash_key").on(table.tokenHash),
    foreignKey({
      name: "practice_invitations_invited_by_fkey",
      columns: [table.invitedBy],
      foreignColumns: [userProfiles.id],
    }),
    foreignKey({
      name: "practice_invitations_accepted_by_fkey",
      columns: [table.acceptedBy],
      foreignColumns: [userProfiles.id],
    }),
    foreignKey({
      name: "practice_invitations_confirmed_by_fkey",
      columns: [table.confirmedBy],
      foreignColumns: [userProfiles.id],
    }),
    foreignKey({
      name: "practice_invitations_workspace_id_contact_id_fkey",
      columns: [table.workspaceId, table.contactId],
      foreignColumns: [
        practiceContacts.workspaceId,
        practiceContacts.contactId,
      ],
    }),
  ],
);

export const practiceDocumentTemplates = pgTable(
  "practice_document_templates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    language: text("language").notNull(),
    content: jsonb("content").notNull(),
    docxKey: text("docx_key"),
    fields: jsonb("fields")
      .notNull()
      .default(sql`'[]'`),
    isDraft: boolean("is_draft")
      .notNull()
      .default(sql`true`),
    createdBy: text("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_document_templates_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "practice_document_templates_language_check",
      sql`language IN ('ru','uz','en')`,
    ),
    foreignKey({
      name: "practice_document_templates_created_by_fkey",
      columns: [table.createdBy],
      foreignColumns: [userProfiles.id],
    }),
  ],
);

export const practiceDocuments = pgTable(
  "practice_documents",
  {
    documentId: text("document_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    state: text("state")
      .notNull()
      .default(sql`'draft'`),
    content: jsonb("content").notNull(),
    revision: integer("revision")
      .notNull()
      .default(sql`1`),
    clientVisible: boolean("client_visible")
      .notNull()
      .default(sql`false`),
    agreedVersionId: text("agreed_version_id"),
    publishedVersionId: text("published_version_id"),
    signedFileId: text("signed_file_id"),
    signedConfirmedBy: text("signed_confirmed_by"),
    signedConfirmedAt: timestamp("signed_confirmed_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_documents_document_id_fkey",
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }).onDelete("cascade"),
    check(
      "practice_documents_state_check",
      sql`state IN ('draft','review','changes_requested','agreed','awaiting_signed','signed_confirmed','cancelled','archived')`,
    ),
    foreignKey({
      name: "practice_documents_signed_file_id_fkey",
      columns: [table.signedFileId],
      foreignColumns: [documentFiles.id],
    }),
    foreignKey({
      name: "practice_documents_signed_confirmed_by_fkey",
      columns: [table.signedConfirmedBy],
      foreignColumns: [userProfiles.id],
    }),
    foreignKey({
      name: "practice_documents_workspace_id_case_id_fkey",
      columns: [table.workspaceId, table.caseId],
      foreignColumns: [practiceMatters.workspaceId, practiceMatters.caseId],
    }),
    foreignKey({
      name: "practice_agreed_version_fk",
      columns: [table.documentId, table.agreedVersionId],
      foreignColumns: [
        practiceDocumentVersions.documentId,
        practiceDocumentVersions.id,
      ],
    }),
    foreignKey({
      name: "practice_published_version_fk",
      columns: [table.documentId, table.publishedVersionId],
      foreignColumns: [
        practiceDocumentVersions.documentId,
        practiceDocumentVersions.id,
      ],
    }),
  ],
);

export const practiceDocumentVersions = pgTable(
  "practice_document_versions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    revision: integer("revision").notNull(),
    content: jsonb("content").notNull(),
    authorUserId: text("author_user_id").notNull(),
    reason: text("reason").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_document_versions_document_id_fkey",
      columns: [table.documentId],
      foreignColumns: [practiceDocuments.documentId],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_document_versions_author_user_id_fkey",
      columns: [table.authorUserId],
      foreignColumns: [userProfiles.id],
    }),
    unique("practice_document_versions_document_id_revision_key").on(
      table.documentId,
      table.revision,
    ),
    unique("practice_document_versions_document_id_id_key").on(
      table.documentId,
      table.id,
    ),
  ],
);

export const practiceDocumentReviews = pgTable(
  "practice_document_reviews",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    revision: integer("revision").notNull(),
    authorUserId: text("author_user_id").notNull(),
    kind: text("kind").notNull(),
    anchor: text("anchor")
      .notNull()
      .default(sql`''`),
    body: text("body").notNull(),
    proposal: jsonb("proposal"),
    state: text("state")
      .notNull()
      .default(sql`'open'`),
    resolvedBy: text("resolved_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_document_reviews_document_id_fkey",
      columns: [table.documentId],
      foreignColumns: [practiceDocuments.documentId],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_document_reviews_author_user_id_fkey",
      columns: [table.authorUserId],
      foreignColumns: [userProfiles.id],
    }),
    check(
      "practice_document_reviews_kind_check",
      sql`kind IN ('comment','proposal','approval')`,
    ),
    check(
      "practice_document_reviews_state_check",
      sql`state IN ('open','accepted','rejected')`,
    ),
    foreignKey({
      name: "practice_document_reviews_resolved_by_fkey",
      columns: [table.resolvedBy],
      foreignColumns: [userProfiles.id],
    }),
  ],
);

export const practiceSignatures = pgTable(
  "practice_signatures",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id").notNull(),
    fileId: text("file_id").notNull(),
    confirmedBy: text("confirmed_by").notNull(),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_signatures_version_id_fkey",
      columns: [table.versionId],
      foreignColumns: [practiceDocumentVersions.id],
    }),
    foreignKey({
      name: "practice_signatures_file_id_fkey",
      columns: [table.fileId],
      foreignColumns: [documentFiles.id],
    }),
    foreignKey({
      name: "practice_signatures_confirmed_by_fkey",
      columns: [table.confirmedBy],
      foreignColumns: [userProfiles.id],
    }),
    unique("practice_signatures_version_id_file_id_key").on(
      table.versionId,
      table.fileId,
    ),
  ],
);

export const practiceFiles = pgTable(
  "practice_files",
  {
    fileId: text("file_id").primaryKey(),
    caseId: text("case_id").notNull(),
    clientVisible: boolean("client_visible")
      .notNull()
      .default(sql`false`),
    uploadedBy: text("uploaded_by").notNull(),
    purpose: text("purpose").notNull(),
    versionId: text("version_id"),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_files_file_id_fkey",
      columns: [table.fileId],
      foreignColumns: [documentFiles.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_files_case_id_fkey",
      columns: [table.caseId],
      foreignColumns: [practiceMatters.caseId],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_files_uploaded_by_fkey",
      columns: [table.uploadedBy],
      foreignColumns: [userProfiles.id],
    }),
    check(
      "practice_files_purpose_check",
      sql`purpose IN ('material','signed','payment_evidence','template')`,
    ),
    foreignKey({
      name: "practice_files_version_id_fkey",
      columns: [table.versionId],
      foreignColumns: [practiceDocumentVersions.id],
    }),
  ],
);

export const practiceInvoices = pgTable(
  "practice_invoices",
  {
    language: text("language").notNull().default("ru"),
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    documentId: text("document_id"),
    number: text("number").notNull(),
    issuedOn: date("issued_on", { mode: "string" }).notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    currency: text("currency").notNull(),
    lines: jsonb("lines").notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    providerSnapshot: jsonb("provider_snapshot").notNull(),
    customerSnapshot: jsonb("customer_snapshot").notNull(),
    fxSnapshot: jsonb("fx_snapshot")
      .notNull()
      .default(sql`'{}'`),
    issuedBy: text("issued_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "practice_invoices_language_check",
      sql`language IN ('ru','uz','en')`,
    ),
    foreignKey({
      name: "practice_invoices_document_id_fkey",
      columns: [table.documentId],
      foreignColumns: [practiceDocuments.documentId],
    }),
    check("practice_invoices_currency_check", sql`currency~'^[A-Z]{3}$'`),
    check("practice_invoices_total_minor_check", sql`total_minor>=0`),
    foreignKey({
      name: "practice_invoices_issued_by_fkey",
      columns: [table.issuedBy],
      foreignColumns: [userProfiles.id],
    }),
    foreignKey({
      name: "practice_invoices_workspace_id_case_id_fkey",
      columns: [table.workspaceId, table.caseId],
      foreignColumns: [practiceMatters.workspaceId, practiceMatters.caseId],
    }),
    unique("practice_invoices_workspace_id_number_key").on(
      table.workspaceId,
      table.number,
    ),
    unique("practice_invoices_workspace_id_id_key").on(
      table.workspaceId,
      table.id,
    ),
  ],
);

export const practicePayments = pgTable(
  "practice_payments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    method: text("method").notNull(),
    note: text("note")
      .notNull()
      .default(sql`''`),
    reversesId: text("reverses_id"),
    refundOfId: text("refund_of_id"),
    evidenceFileId: text("evidence_file_id"),
    fxSnapshot: jsonb("fx_snapshot")
      .notNull()
      .default(sql`'{}'`),
    confirmedBy: text("confirmed_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    check("practice_payments_amount_minor_check", sql`amount_minor<>0`),
    unique("practice_payments_reverses_id_key").on(table.reversesId),
    foreignKey({
      name: "practice_payments_reverses_id_fkey",
      columns: [table.reversesId],
      foreignColumns: [practicePayments.id],
    }),
    foreignKey({
      name: "practice_payments_refund_of_id_fkey",
      columns: [table.refundOfId],
      foreignColumns: [practicePayments.id],
    }),
    foreignKey({
      name: "practice_payments_evidence_file_id_fkey",
      columns: [table.evidenceFileId],
      foreignColumns: [practiceFiles.fileId],
    }),
    foreignKey({
      name: "practice_payments_confirmed_by_fkey",
      columns: [table.confirmedBy],
      foreignColumns: [userProfiles.id],
    }),
    foreignKey({
      name: "practice_payments_workspace_id_invoice_id_fkey",
      columns: [table.workspaceId, table.invoiceId],
      foreignColumns: [practiceInvoices.workspaceId, practiceInvoices.id],
    }),
    index("practice_payments_invoice").on(table.invoiceId, table.createdAt),
  ],
);

export const practiceExpenses = pgTable(
  "practice_expenses",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    incurredOn: date("incurred_on", { mode: "string" }).notNull(),
    paid: boolean("paid").notNull(),
    description: text("description").notNull(),
    fxSnapshot: jsonb("fx_snapshot")
      .notNull()
      .default(sql`'{}'`),
    recordedBy: text("recorded_by").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check("practice_expenses_amount_minor_check", sql`amount_minor>0`),
    check("practice_expenses_currency_check", sql`currency~'^[A-Z]{3}$'`),
    foreignKey({
      name: "practice_expenses_recorded_by_fkey",
      columns: [table.recordedBy],
      foreignColumns: [userProfiles.id],
    }),
    foreignKey({
      name: "practice_expenses_workspace_id_case_id_fkey",
      columns: [table.workspaceId, table.caseId],
      foreignColumns: [practiceMatters.workspaceId, practiceMatters.caseId],
    }),
  ],
);

export const practiceTimeEntries = pgTable(
  "practice_time_entries",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    userId: text("user_id").notNull(),
    minutes: integer("minutes").notNull(),
    hourlyMinor: bigint("hourly_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    workedOn: date("worked_on", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    invoiceId: text("invoice_id"),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_time_entries_case_id_fkey",
      columns: [table.caseId],
      foreignColumns: [practiceMatters.caseId],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_time_entries_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [userProfiles.id],
    }),
    check("practice_time_entries_minutes_check", sql`minutes>0`),
    check("practice_time_entries_hourly_minor_check", sql`hourly_minor>=0`),
    foreignKey({
      name: "practice_time_entries_invoice_id_fkey",
      columns: [table.invoiceId],
      foreignColumns: [practiceInvoices.id],
    }),
  ],
);

export const practiceCommissionRules = pgTable(
  "practice_commission_rules",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull(),
    source: text("source").notNull(),
    planCode: text("plan_code").notNull(),
    serviceType: text("service_type").notNull(),
    rateBps: integer("rate_bps").notNull(),
    active: boolean("active")
      .notNull()
      .default(sql`false`),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "practice_commission_rules_rate_bps_check",
      sql`rate_bps BETWEEN 0 AND 10000`,
    ),
    foreignKey({
      name: "practice_commission_rules_created_by_fkey",
      columns: [table.createdBy],
      foreignColumns: [userProfiles.id],
    }),
    unique(
      "practice_commission_rules_source_plan_code_service_type_version_key",
    ).on(table.source, table.planCode, table.serviceType, table.version),
  ],
);

export const practiceCommissions = pgTable(
  "practice_commissions",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull(),
    ruleId: text("rule_id").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    baseMinor: bigint("base_minor", { mode: "number" }).notNull(),
    rateBps: integer("rate_bps").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    basis: text("basis")
      .notNull()
      .default(sql`'confirmed_receipt'`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    unique("practice_commissions_payment_id_key").on(table.paymentId),
    foreignKey({
      name: "practice_commissions_payment_id_fkey",
      columns: [table.paymentId],
      foreignColumns: [practicePayments.id],
    }),
    foreignKey({
      name: "practice_commissions_rule_id_fkey",
      columns: [table.ruleId],
      foreignColumns: [practiceCommissionRules.id],
    }),
  ],
);

export const practiceFxRates = pgTable(
  "practice_fx_rates",
  {
    workspaceId: text("workspace_id").notNull(),
    currency: text("currency").notNull(),
    baseCurrency: text("base_currency").notNull(),
    rate: numeric("rate", { precision: 30, scale: 12 }).notNull(),
    rateOn: date("rate_on", { mode: "string" }).notNull(),
    recordedBy: text("recorded_by").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_fx_rates_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check("practice_fx_rates_rate_check", sql`rate>0`),
    foreignKey({
      name: "practice_fx_rates_recorded_by_fkey",
      columns: [table.recordedBy],
      foreignColumns: [userProfiles.id],
    }),
    primaryKey({
      columns: [
        table.workspaceId,
        table.currency,
        table.baseCurrency,
        table.rateOn,
      ],
    }),
  ],
);

export const practicePreferences = pgTable(
  "practice_preferences",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    value: jsonb("value").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_preferences_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_preferences_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [userProfiles.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.workspaceId, table.userId] }),
  ],
);

export const practiceCommands = pgTable(
  "practice_commands",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_commands_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_commands_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [userProfiles.id],
    }),
    primaryKey({ columns: [table.workspaceId, table.userId, table.key] }),
  ],
);

export const practiceCalendarConnections = pgTable(
  "practice_calendar_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    calendarId: text("calendar_id"),
    encryptedTokens: text("encrypted_tokens").notNull(),
    syncToken: text("sync_token"),
    state: text("state")
      .notNull()
      .default(sql`'connected'`),
    lastError: text("last_error"),
    lastSyncedAt: timestamp("last_synced_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_calendar_connections_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_calendar_connections_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [userProfiles.id],
    }).onDelete("cascade"),
    unique("practice_calendar_connections_workspace_id_user_id_key").on(
      table.workspaceId,
      table.userId,
    ),
  ],
);

export const practiceOauthStates = pgTable(
  "practice_oauth_states",
  {
    hash: text("hash").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    verifier: text("verifier").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_oauth_states_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_oauth_states_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [userProfiles.id],
    }),
  ],
);

export const practiceEvents = pgTable(
  "practice_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    organizerUserId: text("organizer_user_id").notNull(),
    startsAt: timestamp("starts_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    endsAt: timestamp("ends_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    timezone: text("timezone")
      .notNull()
      .default(sql`'Asia/Tashkent'`),
    status: text("status")
      .notNull()
      .default(sql`'confirmed'`),
    clientVisible: boolean("client_visible")
      .notNull()
      .default(sql`false`),
    title: text("title").notNull(),
    revision: integer("revision")
      .notNull()
      .default(sql`1`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_events_organizer_user_id_fkey",
      columns: [table.organizerUserId],
      foreignColumns: [userProfiles.id],
    }),
    check("practice_events_ends_at_check", sql`ends_at>starts_at`),
    foreignKey({
      name: "practice_events_workspace_id_case_id_fkey",
      columns: [table.workspaceId, table.caseId],
      foreignColumns: [practiceMatters.workspaceId, practiceMatters.caseId],
    }),
    index("practice_events_time").on(
      table.organizerUserId,
      table.startsAt,
      table.endsAt,
    ),
  ],
);

export const practiceGoogleEvents = pgTable(
  "practice_google_events",
  {
    connectionId: text("connection_id").notNull(),
    eventId: text("event_id").notNull(),
    googleId: text("google_id").notNull(),
    etag: text("etag"),
    syncedRevision: integer("synced_revision").notNull(),
    state: text("state")
      .notNull()
      .default(sql`'synced'`),
    remoteSnapshot: jsonb("remote_snapshot"),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_google_events_connection_id_fkey",
      columns: [table.connectionId],
      foreignColumns: [practiceCalendarConnections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_google_events_event_id_fkey",
      columns: [table.eventId],
      foreignColumns: [practiceEvents.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.connectionId, table.eventId] }),
    unique("practice_google_events_connection_id_google_id_key").on(
      table.connectionId,
      table.googleId,
    ),
  ],
);

export const practiceCalendarBusy = pgTable(
  "practice_calendar_busy",
  {
    connectionId: text("connection_id").notNull(),
    googleId: text("google_id").notNull(),
    startsAt: timestamp("starts_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    endsAt: timestamp("ends_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_calendar_busy_connection_id_fkey",
      columns: [table.connectionId],
      foreignColumns: [practiceCalendarConnections.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.connectionId, table.googleId] }),
  ],
);

export const practiceNotifications = pgTable(
  "practice_notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    eventKey: text("event_key").notNull(),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    emailState: text("email_state")
      .notNull()
      .default(sql`'pending'`),
    errorCode: text("error_code"),
    attempts: integer("attempts")
      .notNull()
      .default(sql`0`),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .default(sql`now()`),
    readAt: timestamp("read_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_notifications_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_notifications_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [userProfiles.id],
    }).onDelete("cascade"),
    unique("practice_notifications_user_id_event_key_key").on(
      table.userId,
      table.eventKey,
    ),
  ],
);

export const practiceRecurringServices = pgTable(
  "practice_recurring_services",
  {
    language: text("language").notNull().default("ru"),
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    description: text("description").notNull(),
    nextOn: date("next_on", { mode: "string" }).notNull(),
    intervalMonths: integer("interval_months").notNull(),
    active: boolean("active")
      .notNull()
      .default(sql`true`),
    createdBy: text("created_by").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "practice_recurring_services_language_check",
      sql`language IN ('ru','uz','en')`,
    ),
    check(
      "practice_recurring_services_amount_minor_check",
      sql`amount_minor>0`,
    ),
    check(
      "practice_recurring_services_interval_months_check",
      sql`interval_months BETWEEN 1 AND 12`,
    ),
    foreignKey({
      name: "practice_recurring_services_created_by_fkey",
      columns: [table.createdBy],
      foreignColumns: [userProfiles.id],
    }),
    foreignKey({
      name: "practice_recurring_services_workspace_id_case_id_fkey",
      columns: [table.workspaceId, table.caseId],
      foreignColumns: [practiceMatters.workspaceId, practiceMatters.caseId],
    }),
  ],
);

export const practiceRecurringRuns = pgTable(
  "practice_recurring_runs",
  {
    serviceId: text("service_id").notNull(),
    periodOn: date("period_on", { mode: "string" }).notNull(),
    invoiceId: text("invoice_id").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_recurring_runs_service_id_fkey",
      columns: [table.serviceId],
      foreignColumns: [practiceRecurringServices.id],
    }),
    foreignKey({
      name: "practice_recurring_runs_invoice_id_fkey",
      columns: [table.invoiceId],
      foreignColumns: [practiceInvoices.id],
    }),
    primaryKey({ columns: [table.serviceId, table.periodOn] }),
  ],
);

export const practiceCaseTemplates = pgTable(
  "practice_case_templates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id"),
    name: text("name").notNull(),
    fields: jsonb("fields")
      .notNull()
      .default(sql`'[]'`),
    tasks: jsonb("tasks")
      .notNull()
      .default(sql`'[]'`),
    stages: jsonb("stages")
      .notNull()
      .default(sql`'[]'`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_case_templates_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
  ],
);

export const practiceImports = pgTable(
  "practice_imports",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    rows: jsonb("rows").notNull(),
    columns: jsonb("columns").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()+interval '1 day'`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_imports_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_imports_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [userProfiles.id],
    }),
  ],
);

export const practiceAiDrafts = pgTable(
  "practice_ai_drafts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    caseId: text("case_id").notNull(),
    userId: text("user_id").notNull(),
    requestKey: text("request_key").notNull(),
    requestHash: text("request_hash").notNull(),
    aiRunId: text("ai_run_id"),
    result: jsonb("result"),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_ai_drafts_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_ai_drafts_case_id_fkey",
      columns: [table.caseId],
      foreignColumns: [practiceMatters.caseId],
    }),
    foreignKey({
      name: "practice_ai_drafts_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [userProfiles.id],
    }),
    foreignKey({
      name: "practice_ai_drafts_ai_run_id_fkey",
      columns: [table.aiRunId],
      foreignColumns: [aiRuns.id],
    }),
    unique("practice_ai_drafts_workspace_id_user_id_request_key_key").on(
      table.workspaceId,
      table.userId,
      table.requestKey,
    ),
  ],
);

export const practiceGoogleConsultations = pgTable(
  "practice_google_consultations",
  {
    connectionId: text("connection_id").notNull(),
    consultationId: text("consultation_id").notNull(),
    googleId: text("google_id").notNull(),
    etag: text("etag"),
    syncedUpdatedAt: text("synced_updated_at").notNull(),
    state: text("state").notNull().default("synced"),
    remoteSnapshot: jsonb("remote_snapshot"),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "practice_google_consultations_connection_id_fkey",
      columns: [table.connectionId],
      foreignColumns: [practiceCalendarConnections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "practice_google_consultations_consultation_id_fkey",
      columns: [table.consultationId],
      foreignColumns: [lawyerConsultations.id],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.connectionId, table.consultationId] }),
    unique("practice_google_consultations_connection_id_google_id_key").on(
      table.connectionId,
      table.googleId,
    ),
  ],
);
