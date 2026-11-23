import { z } from "zod";
import { parseJson } from "../document-builder/storage/db";

export const websiteNotificationPreferencesSchema = z.object({
  enabled: z.boolean(),
  documents: z.boolean(),
  legislation: z.boolean(),
  workspace: z.boolean(),
}).strict();

export type WebsiteNotificationPreferences = z.infer<typeof websiteNotificationPreferencesSchema>;

export const WEBSITE_NOTIFICATION_PREFERENCE = "website_notification_preferences";

export async function readWebsiteNotificationPreferences(db: D1Database, userId: string, workspaceId: string): Promise<WebsiteNotificationPreferences> {
  const row = await db.prepare(
    `SELECT scope_json AS scope FROM consents
     WHERE user_id = ? AND workspace_id = ? AND type = ? AND revoked_at IS NULL
     ORDER BY rowid DESC LIMIT 1`,
  ).bind(userId, workspaceId, WEBSITE_NOTIFICATION_PREFERENCE).first<{ scope: string | null }>();
  const result = websiteNotificationPreferencesSchema.safeParse(parseJson(row?.scope, null));
  return result.success ? result.data : { enabled: true, documents: true, legislation: true, workspace: true };
}

export function websiteNotificationFilter(preferences: WebsiteNotificationPreferences) {
  return {
    sql: `? = 1 AND CASE
      WHEN type = 'legislation_monitor' THEN ? = 1
      WHEN document_id IS NOT NULL THEN ? = 1
      ELSE ? = 1 END`,
    bindings: [Number(preferences.enabled), Number(preferences.legislation), Number(preferences.documents), Number(preferences.workspace)],
  };
}

export async function countWebsiteNotifications(db: D1Database, userId: string, workspaceId: string, preferences: WebsiteNotificationPreferences) {
  if (!preferences.enabled) return 0;
  const filter = websiteNotificationFilter(preferences);
  const row = await db.prepare(
    `SELECT count(*) AS total FROM notifications WHERE user_id = ? AND workspace_id = ? AND read_at IS NULL AND ${filter.sql}`,
  ).bind(userId, workspaceId, ...filter.bindings).first<{ total: number | string }>();
  return Number(row?.total ?? 0);
}
