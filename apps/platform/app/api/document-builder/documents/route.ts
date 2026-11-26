import { documentToolHistory } from "../../../../lib/document-builder/document-tool-history";
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
  canSelect: number;
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
    const matchingDocuments = `FROM documents d LEFT JOIN document_collaborators c
        ON c.document_id = d.id AND c.user_id = ? AND ${ACCEPTED_COLLABORATOR_JOIN_SQL}
      WHERE ${where.join(" AND ")}`;
    const fileFilters = ["f.owner_user_id=?", "f.workspace_id=?"];
    const fileBinds: unknown[] = [user.id, workspace.id];
    fileFilters.push(folder === "archive" ? "f.archived_at IS NOT NULL" : "f.archived_at IS NULL");
    if (from) { fileFilters.push("f.created_at >= ?"); fileBinds.push(from); }
    if (search) { fileFilters.push("lower(f.file_name) LIKE lower(?)"); fileBinds.push("%" + search.replace(/[%_]/g, "") + "%"); }
    fileFilters.push(`(f.kind='standalone_signed_pdf'
      ${status ? "" : `OR (f.document_id IS NULL AND f.kind IN ('analysis_safe','review_upload','analysis_upload_pending') AND EXISTS (
        SELECT 1 FROM document_analyses a WHERE a.uploaded_file_id=f.id AND a.workspace_id=f.workspace_id
          AND a.owner_user_id=f.owner_user_id AND a.deletion_requested_at IS NULL
          AND (f.kind<>'analysis_upload_pending' OR a.status IN ('uploaded','quarantined'))))
      OR (f.kind='comparison_version' AND EXISTS (
        SELECT 1 FROM document_comparisons cmp WHERE cmp.workspace_id=f.workspace_id
          AND cmp.owner_user_id=f.owner_user_id AND cmp.deleted_at IS NULL
          AND (cmp.version_one_file_id=f.id OR cmp.version_two_file_id=f.id)))`})`);
    const includeFiles = scope.includeStandaloneFiles && folder !== "favorite" && folder !== "created" && !category
      && (!status || status === "Подписан");
    const library = `SELECT DISTINCT d.id, d.title AS sort_title, d.created_at, d.updated_at, 'document' AS entry_type
      ${matchingDocuments}
      ${includeFiles ? `UNION ALL SELECT f.id, f.file_name, f.created_at, f.updated_at, 'file'
        FROM document_files f WHERE ${fileFilters.join(" AND ")}` : ""}`;
    const libraryBindings = [user.id, ...binds, ...(includeFiles ? fileBinds : [])];
    const pageSize = 6;
    const requestedPage = Number(url.searchParams.get("page") ?? 0);
    const totalRow = await db.prepare(`SELECT COUNT(*) AS total FROM (${library}) AS library`)
      .bind(...libraryBindings).first<{ total: number }>();
    const total = Number(totalRow?.total ?? 0);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, Math.max(0, Math.ceil(total / pageSize) - 1)) : 0;
    const order = sort === "oldest" ? "created_at ASC" : sort === "title" ? "lower(sort_title) ASC" : "updated_at DESC";
    const entries = (await db.prepare(`SELECT id,entry_type AS entryType FROM (${library}) AS library
      ORDER BY ${order},entry_type,id LIMIT ? OFFSET ?`)
      .bind(...libraryBindings, pageSize, page * pageSize).all<{ id: string; entryType: string }>()).results;
    const documentIds = entries.filter(item => item.entryType === "document").map(item => item.id);
    const fileIds = entries.filter(item => item.entryType === "file").map(item => item.id);
    const slots = (ids: string[]) => ids.map(() => "?").join(",");
    const [result, standaloneResult, casesResult] = await Promise.all([
      documentIds.length ? db.prepare(`SELECT DISTINCT d.id, d.template_id AS templateId, d.template_code AS templateCode,
        d.template_version AS templateVersion, d.title, d.category, d.status,
        CASE WHEN d.owner_user_id = ? THEN d.case_id ELSE NULL END AS caseId,
        CASE WHEN d.owner_user_id = ? THEN d.case_link_revision ELSE 0 END AS caseLinkRevision,
        d.language, d.lender_name AS lenderName, d.borrower_name AS borrowerName, d.is_favorite AS isFavorite,
        d.archived_at AS archivedAt, d.generated_at AS generatedAt, d.signed_file_id AS signedFileId,
        d.revision, d.created_at AS createdAt, d.updated_at AS updatedAt,
        CASE WHEN d.owner_user_id = ? OR c.can_download = 1 THEN 1 ELSE 0 END AS canSelect,
        CASE WHEN d.owner_user_id = ? THEN 'owner' ELSE 'collaborator' END AS accessRole
        ${matchingDocuments} AND d.id IN (${slots(documentIds)})`)
        .bind(user.id, user.id, user.id, user.id, user.id, ...binds, ...documentIds).all<DocumentListRow>() : { results: [] },
      fileIds.length ? db.prepare(`SELECT f.id,f.document_id AS documentId,f.kind,f.file_name AS fileName,
        f.mime_type AS mimeType,f.size_bytes AS sizeBytes,f.archived_at AS archivedAt,f.created_at AS createdAt
        FROM document_files f WHERE ${fileFilters.join(" AND ")} AND f.id IN (${slots(fileIds)})`)
        .bind(...fileBinds, ...fileIds).all<FileRecord>() : { results: [] },
      db.prepare("SELECT id,title FROM cases WHERE workspace_id=? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 250")
        .bind(workspace.id).all<{ id: string; title: string }>(),
    ]);
    const documents = documentIds.flatMap(id => result.results.filter(row => row.id === id)
      .map(row => ({ ...row, canSelect: Boolean(row.canSelect), isFavorite: Boolean(row.isFavorite) })));
    const standaloneFiles = fileIds.flatMap(id => standaloneResult.results.filter(row => row.id === id));
    const history = await documentToolHistory(db, workspace.id, user.id, documents, standaloneFiles);
    return jsonResponse({ documents, cases: casesResult.results, standaloneFiles, total, page, entries, history });
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
