import { z } from "zod";
import { parseJsonRequest } from "../../../../lib/auth/input";
import { localizedRequestFormatError } from "../../../../lib/auth/request-locale";
import { assertSafeWrite, requireApiUser } from "../../../../lib/document-builder/auth/api";
import { apiError, badRequest, jsonResponse } from "../../../../lib/document-builder/auth/responses";
import { isoNow } from "../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { countWebsiteNotifications, readWebsiteNotificationPreferences, WEBSITE_NOTIFICATION_PREFERENCE, websiteNotificationFilter, websiteNotificationPreferencesSchema } from "../../../../lib/platform/website-notifications";
import { requireSelectedWorkspace } from "../../../../lib/platform/workspace";

export const dynamic = "force-dynamic";

const notificationReadSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  all: z.literal(true).optional(),
}).strict().refine(
  (value) => Boolean(value.id) !== Boolean(value.all),
);

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireApiUser(request);
    const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
    const db = requireD1();
    const view = new URL(request.url).searchParams.get("view");
    const preferences = await readWebsiteNotificationPreferences(db, user.id, workspace.id);
    const count = countWebsiteNotifications(db, user.id, workspace.id, preferences);
    if (view === "count") return jsonResponse({ unreadCount: await count });
    const filter = websiteNotificationFilter(preferences);
    const [result, unreadCount] = await Promise.all([
      db.prepare(
        `SELECT id, document_id AS documentId, type, title, body, read_at AS readAt, created_at AS createdAt
         FROM notifications WHERE user_id = ? AND workspace_id = ?
         ${view === "unread" ? `AND read_at IS NULL AND ${filter.sql}` : ""}
         ORDER BY created_at DESC, id DESC LIMIT 200`,
      ).bind(user.id, workspace.id, ...(view === "unread" ? filter.bindings : [])).all(),
      count,
    ]);
    return jsonResponse({ notifications: result.results, unreadCount, preferences });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser(request);
    const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
    const parsed = await parseJsonRequest(request, websiteNotificationPreferencesSchema, 1_024);
    if (!parsed.ok) return badRequest(localizedRequestFormatError(request), "INVALID_INPUT");
    const now = isoNow();
    const db = requireD1();
    await db.batch([
      db.prepare("UPDATE consents SET revoked_at = ? WHERE user_id = ? AND workspace_id = ? AND type = ? AND revoked_at IS NULL")
        .bind(now, user.id, workspace.id, WEBSITE_NOTIFICATION_PREFERENCE),
      db.prepare("INSERT INTO consents (id, user_id, workspace_id, type, version, scope_json, granted_at) VALUES (?, ?, ?, ?, '1', ?, ?)")
        .bind(crypto.randomUUID(), user.id, workspace.id, WEBSITE_NOTIFICATION_PREFERENCE, JSON.stringify(parsed.data), now),
    ]);
    return jsonResponse({ preferences: parsed.data });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser(request);
    const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
    const parsed = await parseJsonRequest(request, notificationReadSchema, 1_024);
    if (!parsed.ok) return badRequest("Некорректное уведомление.", "INVALID_INPUT");
    const body = parsed.data;
    const db = requireD1();
    if (body.all) {
      await db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND workspace_id = ? AND read_at IS NULL").bind(isoNow(), user.id, workspace.id).run();
      return jsonResponse({ updated: true });
    }
    if (!body.id) return badRequest("Не указано уведомление.");
    await db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND workspace_id = ? AND read_at IS NULL").bind(isoNow(), body.id, user.id, workspace.id).run();
    return jsonResponse({ updated: true });
  } catch (error) {
    return apiError(error);
  }
}
