import { renderReceipt, suggestedDocumentTitle } from "../templates/receipt";
import { assertTemplatePlan } from "../template-access";
import type { ReceiptAnswers, StoredDocument, UserProfile } from "../types";
import { ensureTemplateSeed, isoNow } from "./db";
import { requireD1 } from "./runtime";
import { workspaceForContentEditor } from "../../platform/workspace";

export interface CreateDocumentInput {
  answers: ReceiptAnswers;
  title?: string;
  autoContent?: string;
  finalContent?: string;
  manuallyEdited?: boolean;
  status?: "Черновик" | "Готов";
}

export async function createStoredDocument(user: UserProfile, input: CreateDocumentInput, workspaceId?: string | null): Promise<StoredDocument> {
  const db = requireD1();
  const workspace = await workspaceForContentEditor(user, workspaceId);
  await assertTemplatePlan("0602001", input.answers.language === "uz-cyrl" ? "uz" : input.answers.language, workspace.id, db);
  await ensureTemplateSeed();
  const id = crypto.randomUUID();
  const now = isoNow();
  const rendered = renderReceipt(input.answers);
  const autoContent = input.autoContent || rendered.plainText;
  const finalContent = input.finalContent || autoContent;
  const title = input.title?.trim() || suggestedDocumentTitle(input.answers);
  const status = input.status ?? "Черновик";
  await db.batch([
    db.prepare(
      `INSERT INTO documents
      (id, workspace_id, owner_user_id, template_id, template_code, template_version, language, participant_mode, acting_side, title, category, status,
       lender_name, borrower_name, is_favorite, archived_at, generated_at, signed_file_id, revision, created_at, updated_at)
      VALUES (?, ?, ?, 'receipt-money-v1', 'receipt-money', '1.0.0', ?, ?, ?, ?, 'Займы и расписки', ?, ?, ?, 0, NULL, NULL, NULL, 1, ?, ?)`,
    ).bind(id, workspace.id, user.id, input.answers.language, input.answers.participantMode, input.answers.actingSide, title, status, input.answers.lender.fullName || null, input.answers.borrower.fullName || null, now, now),
    db.prepare("INSERT INTO document_answers (document_id, answers_json, updated_at) VALUES (?, ?, ?)")
      .bind(id, JSON.stringify(input.answers), now),
    db.prepare("INSERT INTO document_current_content (document_id, auto_content, final_content, manually_edited, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, autoContent, finalContent, input.manuallyEdited ? 1 : 0, now),
    db.prepare("INSERT INTO activity_events (id, document_id, actor_user_id, type, metadata_json, created_at) VALUES (?, ?, ?, 'document_created', NULL, ?)")
      .bind(crypto.randomUUID(), id, user.id, now),
  ]);
  return {
    id,
    ownerUserId: user.id,
    title,
    category: "Займы и расписки",
    status,
    language: input.answers.language,
    lenderName: input.answers.lender.fullName || null,
    borrowerName: input.answers.borrower.fullName || null,
    isFavorite: false,
    archivedAt: null,
    generatedAt: null,
    signedFileId: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    answers: input.answers,
    autoContent,
    finalContent,
    manuallyEdited: Boolean(input.manuallyEdited),
  };
}
