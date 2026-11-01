import { z } from "zod";
import { deleteAiConversation } from "../ai/branch-store";
import { readAiRunStatus } from "../ai/run-store";
import { readSavedAnswerConversation } from "./saved-conversation";
import { withinSignal } from "./lifetime";
import { readAnswerPayload } from "./signed-http";

type Actor = { db: D1Database; workspaceId: string; userId: string };
type Configuration = {
  publicOrigin: string;
  authenticate(request: Request, signal: AbortSignal): Promise<Actor>;
  settings(actor: Actor, signal: AbortSignal): Promise<{
    provider: { configured: boolean; provider: string | null; model: string | null; fallbackConfigured: boolean };
    monthlyLimit: number | null;
  }>;
};
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const identifier = z.string().min(1).max(240);
const querySchema = z.object({ conversationId: identifier.optional(), branchId: identifier.optional(),
  idempotencyKey: identifier.optional(), before: z.iso.datetime().optional(), beforeId: identifier.optional() }).strict();

async function assertMembership(actor: Actor, signal: AbortSignal) {
  const member = await withinSignal(signal, () => actor.db.prepare(`SELECT 1 FROM workspace_members
    WHERE workspace_id=? AND user_id=? AND status='active'`).bind(actor.workspaceId, actor.userId).first());
  if (!member) throw new Error("WORKSPACE_ACCESS_DENIED");
}

async function listConversations(actor: Actor, cursor: { before?: string; beforeId?: string }, signal: AbortSignal) {
  const rows = await withinSignal(signal, () => actor.db.prepare(`SELECT c.id,c.title,c.locale,c.status,c.updated_at AS updatedAt,
    (SELECT m.content FROM conversation_messages m WHERE m.conversation_id=c.id AND m.author_type='assistant'
      ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS lastAnswer FROM conversations c
    WHERE c.workspace_id=? AND c.owner_user_id=? AND c.status='active'
      AND (? IS NULL OR c.updated_at<? OR (c.updated_at=? AND c.id<?))
    ORDER BY c.updated_at DESC,c.id DESC LIMIT 21`)
    .bind(actor.workspaceId, actor.userId, cursor.before ?? null, cursor.before ?? null,
      cursor.before ?? null, cursor.beforeId ?? null)
    .all<{id: string; title: string; locale: string; status: string; updatedAt: string; lastAnswer: string | null}>());
  const page = rows.results.slice(0, 20);
  const ids = page.map(row => row.id);
  const facts = ids.length ? (await withinSignal(signal, () => actor.db.prepare(`SELECT id,conversation_id AS conversationId,
    statement,status FROM confirmed_facts WHERE conversation_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at,id`)
    .bind(...ids).all<{id: string; conversationId: string; statement: string; status: string}>())).results : [];
  const last = page.at(-1);
  return { conversations: page.map(row => ({ ...row, facts: facts.filter(fact => fact.conversationId === row.id)
    .map(({ id, statement, status }) => ({ id, statement, status })) })),
  next: rows.results.length > 20 && last ? { before: last.updatedAt, beforeId: last.id } : null };
}

/** Retained browser read/delete contract, independent of generation and retired chat adapters. */
export async function handleSignedAnswerBrowser(request: Request, configuration: Configuration): Promise<Response> {
  if (!["GET", "DELETE"].includes(request.method)) return Response.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405, headers });
  if (request.method === "DELETE" && (request.headers.get("origin") !== new URL(configuration.publicOrigin).origin
    || request.headers.get("x-juro-csrf") !== "1"
    || (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin"))) {
    return Response.json({ code: "REQUEST_ORIGIN_INVALID" }, { status: 403, headers });
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  let actor: Actor;
  try { actor = await withinSignal(signal, () => configuration.authenticate(request, signal)); await assertMembership(actor, signal); }
  catch { return Response.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401, headers }); }
  try {
    if (request.method === "DELETE") {
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        return Response.json({ code: "REQUEST_CONTENT_TYPE_INVALID" }, { status: 415, headers });
      }
      const { conversationId } = z.object({ conversationId: identifier }).strict().parse(await readAnswerPayload(request, signal));
      const result = await withinSignal(signal, () => deleteAiConversation({ ...actor, conversationId }));
      return Response.json({ status: result }, { status: result === "deleted" ? 200 : result === "busy" ? 409 : 404, headers });
    }
    const params = new URL(request.url).searchParams;
    if ([...new Set(params.keys())].some(key => params.getAll(key).length !== 1)) throw new Error("REQUEST_QUERY_INVALID");
    const query = querySchema.parse(Object.fromEntries(params));
    if (Boolean(query.before) !== Boolean(query.beforeId) || (query.branchId && !query.conversationId)
      || (query.idempotencyKey && (query.conversationId || query.before)) || (query.conversationId && query.before)) {
      throw new Error("REQUEST_QUERY_INVALID");
    }
    let result: unknown;
    if (query.idempotencyKey) result = await withinSignal(signal, () => readAiRunStatus({ ...actor, idempotencyKey: query.idempotencyKey! }));
    else if (query.conversationId) result = await readSavedAnswerConversation({ ...actor, ...query,
      conversationId: query.conversationId, signal });
    else {
      const now = new Date(), periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
      const [page, settings, usage, cases] = await Promise.all([
        listConversations(actor, query, signal), configuration.settings(actor, signal),
        withinSignal(signal, () => actor.db.prepare(`SELECT COALESCE(SUM(units),0) AS used FROM ai_usage_ledger
          WHERE workspace_id=? AND user_id=? AND feature='legal_chat' AND period_start=? AND status IN ('reserved','consumed')`)
          .bind(actor.workspaceId, actor.userId, periodStart).first<{used: number}>()),
        withinSignal(signal, () => actor.db.prepare(`SELECT id,title,status,updated_at AS updatedAt FROM cases
          WHERE workspace_id=? AND owner_user_id=? AND archived_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT 100`)
          .bind(actor.workspaceId, actor.userId).all()),
      ]);
      result = { ...page, provider: settings.provider, usage: { used: Number(usage?.used ?? 0),
        limit: settings.monthlyLimit, periodEnd }, cases: cases.results };
    }
    await assertMembership(actor, signal);
    return Response.json(result, { headers });
  } catch (error) {
    const unavailable = error instanceof Error && /UNAVAILABLE|ACCESS_DENIED/.test(error.message);
    return Response.json({ code: unavailable ? "SAVED_CONVERSATION_UNAVAILABLE" : "REQUEST_INVALID" },
      { status: unavailable ? 404 : 400, headers });
  }
}
