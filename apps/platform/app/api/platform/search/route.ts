import { requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { documentVisibilityScope } from "../../../../lib/document-builder/permissions/document-visibility";
import { requireD1, runtimeEnv } from "../../../../lib/document-builder/storage/runtime";
import { filterVerifiedLexSources } from "../../../../lib/legal/source-trust";
import { isLocale } from "../../../../lib/platform/routing";
import { workspaceForUser } from "../../../../lib/platform/workspace";
import { searchUserDocuments } from "../../../../lib/document-analysis/user-document-vectors";
import {
  globalSearchFuzzyNeedle,
  globalSearchQueryMode,
  rankGlobalSearchRows,
  semanticGlobalSearchScore,
} from "../../../../lib/platform/global-search-policy";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

function likeValue(value: string) {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

async function hasTable(db: D1Database, table: string) {
  return Boolean(await db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
  ).bind(table).first());
}

function emptySearchRows(db: D1Database, columns: string) {
  return db.prepare(`SELECT ${columns} WHERE 0`);
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await requireApiUser();
  const workspace = await workspaceForUser(user);
  const url = new URL(request.url);
  const requestedLocale = url.searchParams.get("locale");
  const locale = typeof requestedLocale === "string" && isLocale(requestedLocale)
    ? requestedLocale
    : "ru";
  const query = (url.searchParams.get("q") || "").normalize("NFKC").trim().slice(0, 120);
  const queryMode = globalSearchQueryMode(query);
  if (queryMode === "incomplete") return response({ query, results: [] });
  const searching = queryMode === "search";
  const like = likeValue(query);
  const fuzzyLike = likeValue(globalSearchFuzzyNeedle(query));
  const searchFlag = searching ? 1 : 0;
  const db = requireD1();
  const documentVisibility = documentVisibilityScope(user.id, workspace.id);
  const [tasksAvailable, lawyersAvailable] = await Promise.all([
    hasTable(db, "tasks"),
    hasTable(db, "lawyer_profiles"),
  ]);
  const [cases, documents, conversations, comparisons, tasks, analyses, templates, lawyers, sources] = await db.batch([
    db.prepare(
      `SELECT id,title,description AS subtitle,updated_at AS updatedAt
       FROM cases WHERE workspace_id=? AND case_visible_to(id,?) AND archived_at IS NULL
         AND (?=0 OR title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
           OR title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT 18`,
    ).bind(workspace.id, user.id, searchFlag, like, like, fuzzyLike, fuzzyLike),
    db.prepare(
      `SELECT d.id,d.title,d.category AS subtitle,d.updated_at AS updatedAt
       FROM documents d WHERE ${documentVisibility.sql} AND d.archived_at IS NULL
         AND (?=0 OR d.title LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\')
       ORDER BY d.updated_at DESC LIMIT 18`,
    ).bind(...documentVisibility.bindings, searchFlag, like, fuzzyLike),
    db.prepare(
      `SELECT id,title,'AI' AS subtitle,updated_at AS updatedAt
       FROM conversations WHERE workspace_id=? AND owner_user_id=? AND status='active'
         AND (?=0 OR title LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT 18`,
    ).bind(workspace.id, user.id, searchFlag, like, fuzzyLike),
    db.prepare(
      `SELECT c.id,(one.file_name || ' ↔ ' || two.file_name) AS title,
        c.status AS subtitle,c.updated_at AS updatedAt
       FROM document_comparisons c
       JOIN document_files one ON one.id=c.version_one_file_id
       JOIN document_files two ON two.id=c.version_two_file_id
       WHERE c.workspace_id=? AND c.owner_user_id=? AND c.deleted_at IS NULL
         AND (?=0 OR one.file_name LIKE ? ESCAPE '\\' OR two.file_name LIKE ? ESCAPE '\\'
           OR one.file_name LIKE ? ESCAPE '\\' OR two.file_name LIKE ? ESCAPE '\\')
       ORDER BY c.updated_at DESC LIMIT 18`,
    ).bind(workspace.id, user.id, searchFlag, like, like, fuzzyLike, fuzzyLike),
    tasksAvailable ? db.prepare(
      `SELECT t.id,t.case_id AS caseId,t.title,coalesce(t.description,'') AS subtitle,
        t.updated_at AS updatedAt
       FROM tasks t WHERE t.workspace_id=? AND t.owner_user_id=? AND t.status!='cancelled'
         AND (?=0 OR t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\'
           OR t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')
       ORDER BY t.updated_at DESC LIMIT 18`,
    ).bind(workspace.id, user.id, searchFlag, like, like, fuzzyLike, fuzzyLike) : emptySearchRows(
      db, "'' AS id,NULL AS caseId,'' AS title,'' AS subtitle,'' AS updatedAt",
    ),
    db.prepare(
      `SELECT a.id,f.file_name AS title,a.status AS subtitle,a.updated_at AS updatedAt
       FROM document_analyses a JOIN document_files f ON f.id=a.uploaded_file_id
       WHERE a.workspace_id=? AND a.owner_user_id=?
         AND (?=0 OR f.file_name LIKE ? ESCAPE '\\' OR f.file_name LIKE ? ESCAPE '\\')
       ORDER BY a.updated_at DESC LIMIT 18`,
    ).bind(workspace.id, user.id, searchFlag, like, fuzzyLike),
    db.prepare(
      `SELECT t.key AS id,l.name AS title,t.category AS subtitle,t.updated_at AS updatedAt
       FROM document_templates t JOIN document_template_locales l ON l.template_id=t.id
       WHERE t.active=1 AND l.language=?
         AND (?=0 OR l.name LIKE ? ESCAPE '\\' OR l.name LIKE ? ESCAPE '\\')
       ORDER BY l.name LIMIT 18`,
    ).bind(locale, searchFlag, like, fuzzyLike),
    lawyersAvailable ? db.prepare(
      `SELECT id,display_name AS title,'' AS subtitle,
        coalesce(public_approved_at,created_at) AS updatedAt
       FROM lawyer_profiles
       WHERE status='public_approved' AND marketplace_status='public_approved' AND public_approved_at IS NOT NULL
         AND (?=0 OR display_name LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
       ORDER BY display_name COLLATE NOCASE LIMIT 18`,
    ).bind(searchFlag, like, fuzzyLike) : emptySearchRows(
      db, "'' AS id,'' AS title,'' AS subtitle,'' AS updatedAt",
    ),
    db.prepare(
      `SELECT id,act_title AS title,coalesce(act_identifier,'') AS subtitle,
        last_checked_at AS updatedAt,official_url AS officialUrl,
        source_type AS sourceType,status,verification_state AS verificationState,
        verified_at AS verifiedAt,content_sha256 AS contentSha256
       FROM legal_sources WHERE status='verified' AND verification_state='verified'
         AND verified_at IS NOT NULL AND content_sha256 IS NOT NULL AND locale=?
         AND (?=0 OR act_title LIKE ? ESCAPE '\\' OR act_identifier LIKE ? ESCAPE '\\'
           OR act_title LIKE ? ESCAPE '\\' OR act_identifier LIKE ? ESCAPE '\\')
       ORDER BY last_checked_at DESC LIMIT 18`,
    ).bind(locale, searchFlag, like, like, fuzzyLike, fuzzyLike),
  ]);
  const bindings = runtimeEnv();
  const documentContent = bindings.USER_DOCUMENTS_INDEX
    && bindings.BUCKET
    && bindings.OPENAI_API_KEY
    && bindings.APP_ENV
    && bindings.LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST === "true"
    && searching
    ? await searchUserDocuments({
        APP_ENV: bindings.APP_ENV,
        DB: db,
        BUCKET: bindings.BUCKET,
        USER_DOCUMENTS_INDEX: bindings.USER_DOCUMENTS_INDEX,
        OPENAI_API_KEY: bindings.OPENAI_API_KEY,
        EMBEDDING_MODEL: bindings.EMBEDDING_MODEL,
      }, {
        workspaceId: workspace.id,
        userId: user.id,
        query,
        limit: 6,
      }).catch(() => [])
    : [];
  const withType = (type: string, rows: unknown[]) => rows.map((item) => ({ ...(item as object), type }));
  return response({
    query,
    results: [
      ...withType("case", rankGlobalSearchRows(cases.results, searching ? query : "", 6)),
      ...withType("document", rankGlobalSearchRows(documents.results, searching ? query : "", 6)),
      ...withType("conversation", rankGlobalSearchRows(conversations.results, searching ? query : "", 6)),
      ...withType("comparison", rankGlobalSearchRows(comparisons.results, searching ? query : "", 6)),
      ...withType("task", rankGlobalSearchRows(tasks.results, searching ? query : "", 6)),
      ...withType("analysis", rankGlobalSearchRows(analyses.results, searching ? query : "", 6)),
      ...documentContent.map((item) => ({
        ...item,
        searchScore: semanticGlobalSearchScore(item.score),
      })),
      ...(searching ? withType("template", rankGlobalSearchRows(templates.results, query, 6)) : []),
      ...(searching ? withType("lawyer", rankGlobalSearchRows(lawyers.results, query, 6)) : []),
      ...withType(
        "source",
        filterVerifiedLexSources(
          (searching ? rankGlobalSearchRows(sources.results, query, 6) : []).map((item) => ({
            ...(item as Record<string, unknown>),
            officialUrl: String(
              (item as Record<string, unknown>).officialUrl || "",
            ),
            status: String((item as Record<string, unknown>).status || ""),
            sourceType: String((item as Record<string, unknown>).sourceType || ""),
            verificationState: String((item as Record<string, unknown>).verificationState || ""),
            verifiedAt: String((item as Record<string, unknown>).verifiedAt || ""),
            contentSha256: String((item as Record<string, unknown>).contentSha256 || ""),
          })),
        ),
      ),
    ],
  });
});
