import { z } from "zod";

import {
  knowledgeBaseArticleBodySchema,
  knowledgeBaseRelatedSlugsSchema,
} from "./knowledge-base";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;
const statusSchema = z.enum(["draft", "published", "archived"]);
const optionalEnglishTitleSchema = z.string().trim().min(3).max(180).nullable().default(null);
const optionalEnglishSummarySchema = z.string().trim().min(10).max(500).nullable().default(null);
const optionalEnglishBodySchema = knowledgeBaseArticleBodySchema.nullable().default(null);

export const knowledgeBaseAdminQuerySchema = z.object({
  articleId: z.string().regex(idPattern).optional(),
  status: statusSchema.optional(),
}).strict();

export const knowledgeBaseDraftContentSchema = z.object({
  slug: z.string().trim().min(3).max(120).regex(slugPattern),
  category: z.string().trim().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  titleRu: z.string().trim().min(3).max(180),
  titleUz: z.string().trim().min(3).max(180),
  titleEn: optionalEnglishTitleSchema,
  summaryRu: z.string().trim().min(10).max(500),
  summaryUz: z.string().trim().min(10).max(500),
  summaryEn: optionalEnglishSummarySchema,
  bodyRu: knowledgeBaseArticleBodySchema,
  bodyUz: knowledgeBaseArticleBodySchema,
  bodyEn: optionalEnglishBodySchema,
  relatedSlugs: knowledgeBaseRelatedSlugsSchema,
}).strict().superRefine((value, context) => {
  if (new Set(value.relatedSlugs).size !== value.relatedSlugs.length) {
    context.addIssue({ code: "custom", path: ["relatedSlugs"], message: "RELATED_SLUGS_DUPLICATED" });
  }
  if (value.relatedSlugs.includes(value.slug)) {
    context.addIssue({ code: "custom", path: ["relatedSlugs"], message: "ARTICLE_CANNOT_RELATE_TO_ITSELF" });
  }
  const englishFields = [value.titleEn, value.summaryEn, value.bodyEn];
  const englishFieldCount = englishFields.filter((field) => field !== null).length;
  if (englishFieldCount > 0 && englishFieldCount < englishFields.length) {
    context.addIssue({ code: "custom", path: ["titleEn"], message: "ENGLISH_CONTENT_INCOMPLETE" });
  }
});

export const knowledgeBaseAdminMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save_draft"),
    articleId: z.string().regex(idPattern).optional(),
    versionId: z.string().regex(idPattern).optional(),
    content: knowledgeBaseDraftContentSchema,
  }).strict(),
  z.object({
    action: z.literal("publish"),
    articleId: z.string().regex(idPattern),
    versionId: z.string().regex(idPattern),
  }).strict(),
  z.object({
    action: z.literal("set_status"),
    articleId: z.string().regex(idPattern),
    status: z.enum(["archived", "restored"]),
  }).strict(),
]);

export type KnowledgeBaseDraftContent = z.infer<typeof knowledgeBaseDraftContentSchema>;

export type KnowledgeBaseAdminArticleSummary = {
  articleId: string;
  slug: string;
  category: string;
  status: z.infer<typeof statusSchema>;
  titleRu: string;
  titleUz: string;
  titleEn: string | null;
  latestVersionNumber: number;
  draftVersionId: string | null;
  publishedVersionId: string | null;
  helpfulCount: number;
  notHelpfulCount: number;
  updatedAt: string;
};

export type KnowledgeBaseAdminVersion = {
  versionId: string;
  versionNumber: number;
  titleRu: string;
  titleUz: string;
  titleEn: string | null;
  summaryRu: string;
  summaryUz: string;
  summaryEn: string | null;
  bodyRu: KnowledgeBaseDraftContent["bodyRu"];
  bodyUz: KnowledgeBaseDraftContent["bodyUz"];
  bodyEn: KnowledgeBaseDraftContent["bodyEn"];
  relatedSlugs: string[];
  contentSha256: string;
  contentHashVersion: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type KnowledgeBaseAdminArticle = {
  articleId: string;
  slug: string;
  category: string;
  status: z.infer<typeof statusSchema>;
  updatedAt: string;
  versions: KnowledgeBaseAdminVersion[];
};

export class KnowledgeBaseAdminError extends Error {
  constructor(
    public readonly code: "ARTICLE_UNAVAILABLE" | "VERSION_UNAVAILABLE" | "DRAFT_CONFLICT" | "SLUG_CONFLICT" | "RELATED_ARTICLE_UNAVAILABLE" | "PUBLISH_CONFLICT",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "KnowledgeBaseAdminError";
  }
}

type AdminRow = {
  articleId: string;
  slug: string;
  category: string;
  status: "draft" | "published" | "archived";
  titleRu: string | null;
  titleUz: string | null;
  titleEn: string | null;
  latestVersionNumber: number;
  draftVersionId: string | null;
  publishedVersionId: string | null;
  helpfulCount: number;
  notHelpfulCount: number;
  updatedAt: string;
};

type VersionRow = {
  versionId: string;
  versionNumber: number;
  titleRu: string;
  titleUz: string;
  titleEn: string | null;
  summaryRu: string;
  summaryUz: string;
  summaryEn: string | null;
  bodyRuJson: string;
  bodyUzJson: string;
  bodyEnJson: string | null;
  relatedSlugsJson: string;
  contentSha256: string;
  contentHashVersion: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export async function listKnowledgeBaseAdminArticles(input: {
  db: D1Database;
  status?: "draft" | "published" | "archived";
}): Promise<KnowledgeBaseAdminArticleSummary[]> {
  const parsed = knowledgeBaseAdminQuerySchema.parse({ status: input.status });
  const filter = parsed.status ? "WHERE article.status=?" : "";
  const bindings = parsed.status ? [parsed.status] : [];
  const rows = await input.db.prepare(
    `SELECT article.id AS articleId,article.slug,article.category,article.status,
      coalesce((SELECT title_ru FROM knowledge_base_article_versions draft WHERE draft.article_id=article.id AND draft.published_at IS NULL ORDER BY draft.version_number DESC LIMIT 1),(SELECT title_ru FROM knowledge_base_article_versions published WHERE published.article_id=article.id AND published.published_at IS NOT NULL ORDER BY published.version_number DESC LIMIT 1)) AS titleRu,
      coalesce((SELECT title_uz FROM knowledge_base_article_versions draft WHERE draft.article_id=article.id AND draft.published_at IS NULL ORDER BY draft.version_number DESC LIMIT 1),(SELECT title_uz FROM knowledge_base_article_versions published WHERE published.article_id=article.id AND published.published_at IS NOT NULL ORDER BY published.version_number DESC LIMIT 1)) AS titleUz,
      coalesce((SELECT title_en FROM knowledge_base_article_versions draft WHERE draft.article_id=article.id AND draft.published_at IS NULL ORDER BY draft.version_number DESC LIMIT 1),(SELECT title_en FROM knowledge_base_article_versions published WHERE published.article_id=article.id AND published.published_at IS NOT NULL ORDER BY published.version_number DESC LIMIT 1)) AS titleEn,
      coalesce((SELECT max(version_number) FROM knowledge_base_article_versions version WHERE version.article_id=article.id),0) AS latestVersionNumber,
      (SELECT id FROM knowledge_base_article_versions draft WHERE draft.article_id=article.id AND draft.published_at IS NULL ORDER BY draft.version_number DESC LIMIT 1) AS draftVersionId,
      (SELECT id FROM knowledge_base_article_versions published WHERE published.article_id=article.id AND published.published_at IS NOT NULL ORDER BY published.version_number DESC LIMIT 1) AS publishedVersionId,
      coalesce((SELECT sum(CASE WHEN feedback.helpful=1 THEN 1 ELSE 0 END) FROM knowledge_base_feedback feedback WHERE feedback.version_id=(SELECT id FROM knowledge_base_article_versions current WHERE current.article_id=article.id AND current.published_at IS NOT NULL ORDER BY current.version_number DESC LIMIT 1)),0) AS helpfulCount,
      coalesce((SELECT sum(CASE WHEN feedback.helpful=0 THEN 1 ELSE 0 END) FROM knowledge_base_feedback feedback WHERE feedback.version_id=(SELECT id FROM knowledge_base_article_versions current WHERE current.article_id=article.id AND current.published_at IS NOT NULL ORDER BY current.version_number DESC LIMIT 1)),0) AS notHelpfulCount,
      article.updated_at AS updatedAt
     FROM knowledge_base_articles article ${filter}
     ORDER BY CASE article.status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,article.updated_at DESC,article.slug ASC LIMIT 200`,
  ).bind(...bindings).all<AdminRow>();
  return rows.results.map((row) => ({ ...row, titleRu: row.titleRu ?? row.slug, titleUz: row.titleUz ?? row.slug }));
}

export async function getKnowledgeBaseAdminArticle(input: {
  db: D1Database;
  articleId: string;
}): Promise<KnowledgeBaseAdminArticle | null> {
  assertId(input.articleId);
  const article = await input.db.prepare(
    "SELECT id AS articleId,slug,category,status,updated_at AS updatedAt FROM knowledge_base_articles WHERE id=? LIMIT 1",
  ).bind(input.articleId).first<{ articleId: string; slug: string; category: string; status: "draft" | "published" | "archived"; updatedAt: string }>();
  if (!article) return null;
  const rows = await input.db.prepare(
    `SELECT id AS versionId,version_number AS versionNumber,title_ru AS titleRu,title_uz AS titleUz,title_en AS titleEn,
      summary_ru AS summaryRu,summary_uz AS summaryUz,summary_en AS summaryEn,
      body_ru_json AS bodyRuJson,body_uz_json AS bodyUzJson,body_en_json AS bodyEnJson,
      related_slugs_json AS relatedSlugsJson,content_sha256 AS contentSha256,content_hash_version AS contentHashVersion,created_at AS createdAt,
      coalesce(updated_at,created_at) AS updatedAt,published_at AS publishedAt
     FROM knowledge_base_article_versions WHERE article_id=? ORDER BY version_number DESC`,
  ).bind(input.articleId).all<VersionRow>();
  const versions = rows.results.flatMap(parseVersionRow);
  if (versions.length !== rows.results.length) return null;
  return { ...article, versions };
}

export async function saveKnowledgeBaseDraft(input: {
  db: D1Database;
  actorUserId: string | null;
  articleId?: string;
  versionId?: string;
  content: KnowledgeBaseDraftContent;
  now?: Date;
}): Promise<{ articleId: string; versionId: string; versionNumber: number; created: boolean }> {
  const content = knowledgeBaseDraftContentSchema.parse(input.content);
  if(input.actorUserId !== null) assertId(input.actorUserId);
  if (input.articleId) assertId(input.articleId);
  if (input.versionId) assertId(input.versionId);
  const now = validNow(input.now);
  const hash = await knowledgeBaseContentSha256(content);
  if (!input.articleId) {
    if (input.versionId) throw new KnowledgeBaseAdminError("VERSION_UNAVAILABLE", "Версия недоступна.", 404);
    const articleId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    try {
      await input.db.batch([
        input.db.prepare(
          `INSERT INTO knowledge_base_articles
           (id,slug,category,status,created_at,updated_at,published_at,created_by_user_id,updated_by_user_id)
           VALUES (?,?,?,'draft',?,?,NULL,?,?)`,
        ).bind(articleId, content.slug, content.category, now, now, input.actorUserId, input.actorUserId),
        input.db.prepare(
          `INSERT INTO knowledge_base_article_versions
           (id,article_id,version_number,title_ru,title_uz,title_en,summary_ru,summary_uz,summary_en,body_ru_json,body_uz_json,body_en_json,related_slugs_json,content_sha256,content_hash_version,created_at,published_at,created_by_user_id,updated_by_user_id,published_by_user_id,updated_at)
           VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?,?,'full-v2',?,NULL,?,?,NULL,?)`,
        ).bind(versionId, articleId, content.titleRu, content.titleUz, content.titleEn, content.summaryRu, content.summaryUz, content.summaryEn, JSON.stringify(content.bodyRu), JSON.stringify(content.bodyUz), content.bodyEn === null ? null : JSON.stringify(content.bodyEn), JSON.stringify(content.relatedSlugs), hash, now, input.actorUserId, input.actorUserId, now),
      ]);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new KnowledgeBaseAdminError("SLUG_CONFLICT", "Такой slug уже используется.", 409);
      throw error;
    }
    return { articleId, versionId, versionNumber: 1, created: true };
  }

  const article = await input.db.prepare(
    `SELECT id,slug,category,status,
      EXISTS(SELECT 1 FROM knowledge_base_article_versions published WHERE published.article_id=knowledge_base_articles.id AND published.published_at IS NOT NULL) AS hasPublished
     FROM knowledge_base_articles WHERE id=? LIMIT 1`,
  ).bind(input.articleId).first<{ id: string; slug: string; category: string; status: string; hasPublished: number }>();
  if (!article) throw new KnowledgeBaseAdminError("ARTICLE_UNAVAILABLE", "Статья недоступна.", 404);
  if (article.status === "archived") throw new KnowledgeBaseAdminError("ARTICLE_UNAVAILABLE", "Сначала восстановите статью.", 409);
  if (article.hasPublished && (article.slug !== content.slug || article.category !== content.category)) {
    throw new KnowledgeBaseAdminError("PUBLISH_CONFLICT", "Slug и категория опубликованной статьи неизменяемы.", 409);
  }

  if (input.versionId) {
    const version = await input.db.prepare(
      "SELECT id,version_number AS versionNumber,published_at AS publishedAt FROM knowledge_base_article_versions WHERE id=? AND article_id=? LIMIT 1",
    ).bind(input.versionId, article.id).first<{ id: string; versionNumber: number; publishedAt: string | null }>();
    if (!version || version.publishedAt) throw new KnowledgeBaseAdminError("VERSION_UNAVAILABLE", "Редактируемый черновик недоступен.", 409);
    try {
      await input.db.batch([
        input.db.prepare("UPDATE knowledge_base_articles SET slug=?,category=?,updated_at=?,updated_by_user_id=? WHERE id=?")
          .bind(content.slug, content.category, now, input.actorUserId, article.id),
        input.db.prepare(
          `UPDATE knowledge_base_article_versions SET title_ru=?,title_uz=?,title_en=?,summary_ru=?,summary_uz=?,summary_en=?,body_ru_json=?,body_uz_json=?,body_en_json=?,related_slugs_json=?,content_sha256=?,content_hash_version='full-v2',updated_by_user_id=?,updated_at=?
           WHERE id=? AND article_id=? AND published_at IS NULL`,
        ).bind(content.titleRu, content.titleUz, content.titleEn, content.summaryRu, content.summaryUz, content.summaryEn, JSON.stringify(content.bodyRu), JSON.stringify(content.bodyUz), content.bodyEn === null ? null : JSON.stringify(content.bodyEn), JSON.stringify(content.relatedSlugs), hash, input.actorUserId, now, version.id, article.id),
      ]);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new KnowledgeBaseAdminError("SLUG_CONFLICT", "Такой slug уже используется.", 409);
      throw error;
    }
    return { articleId: article.id, versionId: version.id, versionNumber: version.versionNumber, created: false };
  }

  const existingDraft = await input.db.prepare(
    "SELECT id FROM knowledge_base_article_versions WHERE article_id=? AND published_at IS NULL LIMIT 1",
  ).bind(article.id).first<{ id: string }>();
  if (existingDraft) throw new KnowledgeBaseAdminError("DRAFT_CONFLICT", "У статьи уже есть черновик.", 409);
  const latest = await input.db.prepare(
    "SELECT coalesce(max(version_number),0) AS versionNumber FROM knowledge_base_article_versions WHERE article_id=?",
  ).bind(article.id).first<{ versionNumber: number }>();
  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  const versionId = crypto.randomUUID();
  await input.db.batch([
    input.db.prepare("UPDATE knowledge_base_articles SET updated_at=?,updated_by_user_id=? WHERE id=?")
      .bind(now, input.actorUserId, article.id),
    input.db.prepare(
      `INSERT INTO knowledge_base_article_versions
       (id,article_id,version_number,title_ru,title_uz,title_en,summary_ru,summary_uz,summary_en,body_ru_json,body_uz_json,body_en_json,related_slugs_json,content_sha256,content_hash_version,created_at,published_at,created_by_user_id,updated_by_user_id,published_by_user_id,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'full-v2',?,NULL,?,?,NULL,?)`,
    ).bind(versionId, article.id, versionNumber, content.titleRu, content.titleUz, content.titleEn, content.summaryRu, content.summaryUz, content.summaryEn, JSON.stringify(content.bodyRu), JSON.stringify(content.bodyUz), content.bodyEn === null ? null : JSON.stringify(content.bodyEn), JSON.stringify(content.relatedSlugs), hash, now, input.actorUserId, input.actorUserId, now),
  ]);
  return { articleId: article.id, versionId, versionNumber, created: true };
}

export async function publishKnowledgeBaseDraft(input: {
  db: D1Database;
  actorUserId: string | null;
  articleId: string;
  versionId: string;
  now?: Date;
}): Promise<{ articleId: string; versionId: string; status: "published" }> {
  if(input.actorUserId !== null) assertId(input.actorUserId);
  assertId(input.articleId);
  assertId(input.versionId);
  const now = validNow(input.now);
  const version = await input.db.prepare(
    `SELECT version.related_slugs_json AS relatedSlugsJson,version.published_at AS publishedAt,article.slug,article.status
     FROM knowledge_base_article_versions version INNER JOIN knowledge_base_articles article ON article.id=version.article_id
     WHERE version.id=? AND version.article_id=? LIMIT 1`,
  ).bind(input.versionId, input.articleId).first<{ relatedSlugsJson: string; publishedAt: string | null; slug: string; status: string }>();
  if (!version || version.publishedAt || version.status === "archived") {
    throw new KnowledgeBaseAdminError("VERSION_UNAVAILABLE", "Черновик недоступен для публикации.", 409);
  }
  let relatedValue: unknown;
  try {
    relatedValue = JSON.parse(version.relatedSlugsJson);
  } catch {
    throw new KnowledgeBaseAdminError("RELATED_ARTICLE_UNAVAILABLE", "Проверьте связанные статьи.", 409);
  }
  const parsedRelated = knowledgeBaseRelatedSlugsSchema.safeParse(relatedValue);
  if (!parsedRelated.success || parsedRelated.data.includes(version.slug)) {
    throw new KnowledgeBaseAdminError("RELATED_ARTICLE_UNAVAILABLE", "Проверьте связанные статьи.", 409);
  }
  if (parsedRelated.data.length) {
    const placeholders = parsedRelated.data.map(() => "?").join(",");
    const result = await input.db.prepare(
      `SELECT count(*) AS count FROM knowledge_base_articles WHERE slug IN (${placeholders}) AND status='published'`,
    ).bind(...parsedRelated.data).first<{ count: number }>();
    if ((result?.count ?? 0) !== parsedRelated.data.length) {
      throw new KnowledgeBaseAdminError("RELATED_ARTICLE_UNAVAILABLE", "Все связанные статьи должны быть опубликованы.", 409);
    }
  }
  try {
    const results = await input.db.batch([
      input.db.prepare(
        "UPDATE knowledge_base_article_versions SET published_at=?,published_by_user_id=?,updated_by_user_id=?,updated_at=? WHERE id=? AND article_id=? AND published_at IS NULL",
      ).bind(now, input.actorUserId, input.actorUserId, now, input.versionId, input.articleId),
      input.db.prepare(
        "UPDATE knowledge_base_articles SET status='published',published_at=?,updated_at=?,updated_by_user_id=?,status_changed_by_user_id=?,status_changed_at=? WHERE id=? AND status<>'archived'",
      ).bind(now, now, input.actorUserId, input.actorUserId, now, input.articleId),
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
      throw new KnowledgeBaseAdminError("PUBLISH_CONFLICT", "Статья изменилась. Обновите данные и повторите публикацию.", 409);
    }
  } catch {
    throw new KnowledgeBaseAdminError("PUBLISH_CONFLICT", "Статья изменилась. Обновите данные и повторите публикацию.", 409);
  }
  return { articleId: input.articleId, versionId: input.versionId, status: "published" };
}

export async function setKnowledgeBaseArticleStatus(input: {
  db: D1Database;
  actorUserId: string | null;
  articleId: string;
  status: "archived" | "restored";
  now?: Date;
}): Promise<{ articleId: string; status: "draft" | "published" | "archived" }> {
  if(input.actorUserId !== null) assertId(input.actorUserId);
  assertId(input.articleId);
  const now = validNow(input.now);
  const article = await input.db.prepare(
    `SELECT status,EXISTS(SELECT 1 FROM knowledge_base_article_versions version WHERE version.article_id=knowledge_base_articles.id AND version.published_at IS NOT NULL) AS hasPublished
     FROM knowledge_base_articles WHERE id=? LIMIT 1`,
  ).bind(input.articleId).first<{ status: "draft" | "published" | "archived"; hasPublished: number }>();
  if (!article) throw new KnowledgeBaseAdminError("ARTICLE_UNAVAILABLE", "Статья недоступна.", 404);
  const status = input.status === "archived" ? "archived" : article.hasPublished ? "published" : "draft";
  if (article.status === status) return { articleId: input.articleId, status };
  await input.db.prepare(
    "UPDATE knowledge_base_articles SET status=?,updated_at=?,updated_by_user_id=?,status_changed_by_user_id=?,status_changed_at=? WHERE id=?",
  ).bind(status, now, input.actorUserId, input.actorUserId, now, input.articleId).run();
  return { articleId: input.articleId, status };
}

export async function knowledgeBaseContentSha256(content: KnowledgeBaseDraftContent): Promise<string> {
  const canonical = JSON.stringify({
    titleRu: content.titleRu,
    titleUz: content.titleUz,
    summaryRu: content.summaryRu,
    summaryUz: content.summaryUz,
    bodyRu: content.bodyRu,
    bodyUz: content.bodyUz,
    ...(content.titleEn === null ? {} : {
      titleEn: content.titleEn,
      summaryEn: content.summaryEn,
      bodyEn: content.bodyEn,
    }),
    related: content.relatedSlugs,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseVersionRow(row: VersionRow): KnowledgeBaseAdminVersion[] {
  try {
    const bodyRu = knowledgeBaseArticleBodySchema.safeParse(JSON.parse(row.bodyRuJson));
    const bodyUz = knowledgeBaseArticleBodySchema.safeParse(JSON.parse(row.bodyUzJson));
    const bodyEn = row.bodyEnJson === null
      ? null
      : knowledgeBaseArticleBodySchema.safeParse(JSON.parse(row.bodyEnJson));
    const related = knowledgeBaseRelatedSlugsSchema.safeParse(JSON.parse(row.relatedSlugsJson));
    if (!bodyRu.success || !bodyUz.success || (bodyEn !== null && !bodyEn.success) || !related.success) return [];
    return [{
      versionId: row.versionId,
      versionNumber: row.versionNumber,
      titleRu: row.titleRu,
      titleUz: row.titleUz,
      titleEn: row.titleEn,
      summaryRu: row.summaryRu,
      summaryUz: row.summaryUz,
      summaryEn: row.summaryEn,
      bodyRu: bodyRu.data,
      bodyUz: bodyUz.data,
      bodyEn: bodyEn === null ? null : bodyEn.data,
      relatedSlugs: related.data,
      contentSha256: row.contentSha256,
      contentHashVersion: row.contentHashVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      publishedAt: row.publishedAt,
    }];
  } catch {
    return [];
  }
}

function assertId(value: string): void {
  if (!idPattern.test(value)) throw new KnowledgeBaseAdminError("ARTICLE_UNAVAILABLE", "Объект недоступен.", 404);
}

function validNow(value?: Date): string {
  const now = value ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError("INVALID_NOW");
  return now.toISOString();
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique constraint|UNIQUE constraint/i.test(error.message);
}
