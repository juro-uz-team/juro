import { resolvedDocument } from "../../../../lib/document-builder/registry/published";
import { assertSafeWrite, requireApiUser } from "../../../../lib/document-builder/auth/api";
import { apiError, badRequest, jsonResponse } from "../../../../lib/document-builder/auth/responses";
import { createStoredDocument } from "../../../../lib/document-builder/storage/documents";
import { createConfiguredDocument } from "../../../../lib/document-builder/storage/configured-documents";
import { getDocumentByCode } from "../../../../lib/document-builder/registry";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import type { DocumentRecord, FileRecord, ReceiptAnswers } from "../../../../lib/document-builder/types";
import type { QuestionnaireAnswers } from "../../../../lib/document-builder/registry";
import {
  ACCEPTED_COLLABORATOR_JOIN_SQL,
  documentListScope,
  type DocumentListFolder,
} from "../../../../lib/document-builder/permissions/collaboration-policy";
import { workspaceForUser } from "../../../../lib/platform/workspace";

export const dynamic = "force-dynamic";

interface DocumentListRow {
  id: string;
  templateId: string;
  templateCode: string | null;
  templateVersion: string | null;
  title: string;
  category: string;
  status: DocumentRecord["status"];
  caseId: string | null;
  caseLinkRevision: number;
  language: DocumentRecord["language"];
  lenderName: string | null;
  borrowerName: string | null;
  isFavorite: number;
  archivedAt: string | null;
  generatedAt: string | null;
  signedFileId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  accessRole: "owner" | "collaborator";
}

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireApiUser();
    const db = requireD1();
    const workspace = await workspaceForUser(user);
    const url = new URL(request.url);
    const requestedFolder = url.searchParams.get("folder") ?? "all";
    const folder: DocumentListFolder = [
      "all",
      "created",
      "favorite",
      "archive",
      "shared",
    ].includes(requestedFolder)
      ? requestedFolder as DocumentListFolder
      : "all";
    const status = url.searchParams.get("status") ?? "";
    const search = (url.searchParams.get("search") ?? "").trim();
    const sort = url.searchParams.get("sort") ?? "newest";
    const category = url.searchParams.get("category") ?? "";
    const from = url.searchParams.get("from") ?? "";
    const scope = documentListScope(folder, user.id, workspace.id);
    const where: string[] = [...scope.clauses];
    const binds: unknown[] = [...scope.bindings];
    if (folder === "created") { where.push("d.owner_user_id = ?"); binds.push(user.id); }
    if (folder === "favorite") where.push("d.is_favorite = 1");
    if (folder === "archive") where.push("d.status = 'Архив'");
    else where.push("d.status <> 'Архив'");
    if (status) { where.push("d.status = ?"); binds.push(status); }
    if (category) { where.push("d.category = ?"); binds.push(category); }
    if (from) { where.push("d.created_at >= ?"); binds.push(from); }
    if (search) {
      where.push("(lower(d.title) LIKE lower(?) OR lower(COALESCE(d.lender_name, '')) LIKE lower(?) OR lower(COALESCE(d.borrower_name, '')) LIKE lower(?))");
      const pattern = `%${search.replace(/[%_]/g, "")}%`;
      binds.push(pattern, pattern, pattern);
    }
    const order = sort === "oldest" ? "d.created_at ASC" : sort === "title" ? "d.title COLLATE NOCASE ASC" : "d.updated_at DESC";
    const query = `SELECT DISTINCT d.id, d.template_id AS templateId, d.template_code AS templateCode,
      d.template_version AS templateVersion, d.title, d.category, d.status,
      CASE WHEN d.owner_user_id = ? THEN d.case_id ELSE NULL END AS caseId,
      CASE WHEN d.owner_user_id = ? THEN d.case_link_revision ELSE 0 END AS caseLinkRevision,
      d.language,
      d.lender_name AS lenderName, d.borrower_name AS borrowerName, d.is_favorite AS isFavorite,
      d.archived_at AS archivedAt, d.generated_at AS generatedAt, d.signed_file_id AS signedFileId,
      d.revision, d.created_at AS createdAt, d.updated_at AS updatedAt,
      CASE WHEN d.owner_user_id = ? THEN 'owner' ELSE 'collaborator' END AS accessRole
      FROM documents d LEFT JOIN document_collaborators c
        ON c.document_id = d.id AND ${ACCEPTED_COLLABORATOR_JOIN_SQL}
      WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT 250`;
    const result = await db.prepare(query).bind(user.id, user.id, user.id, ...binds).all<DocumentListRow>();
    const documents = result.results.map((row) => ({ ...row, isFavorite: Boolean(row.isFavorite) }));
    const casesResult = await db.prepare(
      "SELECT id,title FROM cases WHERE workspace_id=? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 250",
    ).bind(workspace.id).all<{ id: string; title: string }>();
    const standaloneResult = scope.includeStandaloneFiles
      ? await db.prepare(
        `SELECT id, document_id AS documentId, kind, file_name AS fileName, mime_type AS mimeType,
         size_bytes AS sizeBytes, archived_at AS archivedAt, created_at AS createdAt
         FROM document_files
         WHERE owner_user_id = ? AND workspace_id = ? AND kind = 'standalone_signed_pdf'
         ${folder === "archive" ? "AND archived_at IS NOT NULL" : "AND archived_at IS NULL"}
         ORDER BY created_at DESC`,
      ).bind(user.id, workspace.id).all<FileRecord>()
      : { results: [] as FileRecord[] };
    return jsonResponse({ documents, cases: casesResult.results, standaloneFiles: standaloneResult.results, total: documents.length + standaloneResult.results.length });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser();
    const workspace = await workspaceForUser(user);
    const body = await request.json() as { sourceDocumentId?: string };
    if (!body.sourceDocumentId) return badRequest("Не указан исходный документ.");
    const db = requireD1();
    const source = await db.prepare(
      `SELECT d.title, d.template_code AS templateCode,d.template_version AS templateVersion, d.language, a.answers_json AS answersJson, c.auto_content AS autoContent,
       c.final_content AS finalContent, c.manually_edited AS manuallyEdited
       FROM documents d JOIN document_answers a ON a.document_id = d.id
       JOIN document_current_content c ON c.document_id = d.id
       WHERE d.id = ? AND d.owner_user_id = ? AND d.workspace_id = ? LIMIT 1`,
    ).bind(body.sourceDocumentId, user.id, workspace.id).first<{ title: string; templateCode: string | null; templateVersion:string; language: string; answersJson: string; autoContent: string; finalContent: string; manuallyEdited: number }>();
    if (!source) return jsonResponse({ error: "Документ не найден." }, { status: 404 });
    const definition = source.templateCode ? await resolvedDocument(source.templateCode,source.templateVersion) : undefined;
    if (definition) {
      const document = await createConfiguredDocument(user, {
        definition,
        language: source.language === "uz" ? "uz" : "ru",
        answers: JSON.parse(source.answersJson) as QuestionnaireAnswers,
        title: `${source.title} — копия`,
        finalContent: source.finalContent,
        manuallyEdited: Boolean(source.manuallyEdited),
      });
      return jsonResponse({ document }, { status: 201 });
    }
    const answers = JSON.parse(source.answersJson) as ReceiptAnswers;
    const document = await createStoredDocument(user, {
      answers,
      title: `${source.title} — копия`,
      autoContent: source.autoContent,
      finalContent: source.finalContent,
      manuallyEdited: Boolean(source.manuallyEdited),
    });
    return jsonResponse({ document }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
