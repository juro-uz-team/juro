import {assertTemplatePlan} from "../../control-center/template-access";
import { resolvedDocument } from "../registry/published";
import type { DocumentDefinition, QuestionnaireAnswers } from "../registry";
import { getCategory, getDocumentByCode } from "../registry";
import { renderConfiguredDocument, type BuilderLanguage } from "../registry/engine";
import type { GenericStoredDocument, UserProfile } from "../types";
import { getDocumentAccess } from "../permissions";
import { ensureConfiguredTemplateSeed, isoNow, parseJson } from "./db";
import { requireD1 } from "./runtime";
import { workspaceForUser } from "../../platform/workspace";

export interface CreateConfiguredDocumentInput {
  definition: DocumentDefinition;
  language: BuilderLanguage;
  answers: QuestionnaireAnswers;
  title?: string;
  finalContent?: string;
  manuallyEdited?: boolean;
  caseId?: string;
  planStepId?: string;
  aiHandoff?: {
    id: string;
    assistantMessageId: string;
    idempotencyKeySha256: string;
    selectionSha256: string;
    selectedFieldIds: string[];
    locale: "ru" | "uz";
  };
}

type CreateConfiguredDocumentDependencies = {
  db?: D1Database;
  workspace?: { id: string };
};

interface ConfiguredRow {
  id: string;
  ownerUserId: string;
  templateId: string;
  templateCode: string | null;
  templateVersion: string | null;
  language: string;
  title: string;
  category: string;
  status: GenericStoredDocument["status"];
  lenderName: string | null;
  borrowerName: string | null;
  isFavorite: number;
  archivedAt: string | null;
  generatedAt: string | null;
  signedFileId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  answersJson: string;
  autoContent: string;
  finalContent: string;
  manuallyEdited: number;
}

function firstText(answers: QuestionnaireAnswers, keys: string[]): string | null {
  for (const key of keys) {
    const value = answers[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function suggestedConfiguredTitle(definition: DocumentDefinition, language: BuilderLanguage): string {
  const base = language === "uz" ? definition.titleUz : definition.titleRu;
  return `${base} — ${new Intl.DateTimeFormat(language === "uz" ? "uz-UZ" : "ru-RU").format(new Date())}`;
}

export async function createConfiguredDocument(
  user: UserProfile,
  input: CreateConfiguredDocumentInput,
  dependencies: CreateConfiguredDocumentDependencies = {},
): Promise<GenericStoredDocument> {
  await assertTemplatePlan(input.definition,user.id);
  const db = dependencies.db ?? requireD1();
  const workspace = dependencies.workspace ?? await workspaceForUser(user);
  await ensureConfiguredTemplateSeed(input.definition, db);
  const id = crypto.randomUUID();
  const now = isoNow();
  const rendered = renderConfiguredDocument(input.definition, input.answers, input.language);
  const finalContent = input.finalContent || rendered.plainText;
  const title = input.title?.trim() || suggestedConfiguredTitle(input.definition, input.language);
  const category = getCategory(input.definition.categorySlug);
  const primary = firstText(input.answers, ["claimant.fullName", "employee.fullName", "creditor.fullName"]);
  const secondary = firstText(input.answers, ["respondent.fullName", "employer.name", "debtor.fullName"]);
  const statements = [
    db.prepare(
      `INSERT INTO documents
      (id, workspace_id, owner_user_id, template_id, template_code, template_version, language, participant_mode, acting_side,
       title, category, status, case_id, plan_step_id, lender_name, borrower_name, is_favorite, archived_at, generated_at,
       signed_file_id, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'configurable', NULL, ?, ?, 'Черновик', ?, ?, ?, ?, 0, NULL, NULL, NULL, 1, ?, ?)`,
    ).bind(id, workspace.id, user.id, input.definition.id, input.definition.code, input.definition.version, input.language, title, category?.title.ru ?? input.definition.categorySlug, input.caseId ?? null, input.planStepId ?? null, primary, secondary, now, now),
    db.prepare("INSERT INTO document_answers (document_id, answers_json, updated_at) VALUES (?, ?, ?)").bind(id, JSON.stringify(input.answers), now),
    db.prepare("INSERT INTO document_current_content (document_id, auto_content, final_content, manually_edited, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, rendered.plainText, finalContent, input.manuallyEdited ? 1 : 0, now),
    db.prepare("INSERT INTO activity_events (id, document_id, actor_user_id, type, metadata_json, created_at) VALUES (?, ?, ?, 'document_created', ?, ?)")
      .bind(crypto.randomUUID(), id, user.id, JSON.stringify({ templateCode: input.definition.code, templateVersion: input.definition.version }), now),
  ];
  if (input.caseId) statements.push(db.prepare("INSERT INTO case_events (id,case_id,actor_user_id,event_type,metadata_json,created_at) VALUES (?,?,?,'document_created',?,?)").bind(crypto.randomUUID(),input.caseId,user.id,JSON.stringify({documentId:id,templateCode:input.definition.code,planStepId:input.planStepId??null}),now));
  if (input.planStepId) statements.push(db.prepare("UPDATE action_plan_steps SET status='in_progress',revision=revision+1,updated_at=? WHERE id=?").bind(now,input.planStepId));
  if (input.aiHandoff) statements.push(db.prepare(
    `INSERT INTO ai_document_prefill_handoffs
     (id,workspace_id,user_id,assistant_message_id,template_code,document_id,locale,
      selected_field_ids_json,selection_sha256,idempotency_key_sha256,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    input.aiHandoff.id,
    workspace.id,
    user.id,
    input.aiHandoff.assistantMessageId,
    input.definition.code,
    id,
    input.aiHandoff.locale,
    JSON.stringify(input.aiHandoff.selectedFieldIds),
    input.aiHandoff.selectionSha256,
    input.aiHandoff.idempotencyKeySha256,
    now,
  ));
  await db.batch(statements);
  return {
    id, ownerUserId: user.id, templateId: input.definition.id, templateCode: input.definition.code, templateVersion: input.definition.version,
    title, category: category?.title.ru ?? input.definition.categorySlug, status: "Черновик", language: input.language,
    lenderName: primary, borrowerName: secondary, isFavorite: false, archivedAt: null, generatedAt: null, signedFileId: null,
    revision: 1, createdAt: now, updatedAt: now, answers: input.answers, autoContent: rendered.plainText, finalContent,
    manuallyEdited: Boolean(input.manuallyEdited),
  };
}

export async function loadConfiguredDocument(documentId: string, userId: string): Promise<GenericStoredDocument | null> {
  const access = await getDocumentAccess(documentId, userId);
  if (!access?.canView) return null;
  const row = await requireD1().prepare(
    `SELECT d.id, d.owner_user_id AS ownerUserId, d.template_id AS templateId, d.template_code AS templateCode,
      d.template_version AS templateVersion, d.language, d.title, d.category, d.status, d.lender_name AS lenderName,
      d.borrower_name AS borrowerName, d.is_favorite AS isFavorite, d.archived_at AS archivedAt,
      d.generated_at AS generatedAt, d.signed_file_id AS signedFileId, d.revision, d.created_at AS createdAt,
      d.updated_at AS updatedAt, a.answers_json AS answersJson, c.auto_content AS autoContent,
      c.final_content AS finalContent, c.manually_edited AS manuallyEdited
    FROM documents d JOIN document_answers a ON a.document_id = d.id
    JOIN document_current_content c ON c.document_id = d.id WHERE d.id = ? LIMIT 1`,
  ).bind(documentId).first<ConfiguredRow>();
  if (!row?.templateCode || !row.templateVersion || !await resolvedDocument(row.templateCode,row.templateVersion)) return null;
  return {
    id: row.id, ownerUserId: row.ownerUserId, templateId: row.templateId, templateCode: row.templateCode, templateVersion: row.templateVersion,
    title: row.title, category: row.category, status: row.status, language: row.language as BuilderLanguage,
    lenderName: row.lenderName, borrowerName: row.borrowerName, isFavorite: Boolean(row.isFavorite), archivedAt: row.archivedAt,
    generatedAt: row.generatedAt, signedFileId: row.signedFileId, revision: row.revision, createdAt: row.createdAt,
    updatedAt: row.updatedAt, accessRole: access.role, answers: parseJson<QuestionnaireAnswers>(row.answersJson, {}),
    autoContent: row.autoContent, finalContent: row.finalContent, manuallyEdited: Boolean(row.manuallyEdited),
  };
}
