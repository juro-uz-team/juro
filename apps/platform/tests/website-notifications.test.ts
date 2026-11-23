import assert from "node:assert/strict";
import test from "node:test";
import { countWebsiteNotifications, readWebsiteNotificationPreferences, WEBSITE_NOTIFICATION_PREFERENCE, websiteNotificationFilter, websiteNotificationPreferencesSchema } from "../lib/platform/website-notifications";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

test("website alerts follow the latest workspace preferences and preserve history", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const now = "2026-11-24T00:00:00Z";
    sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES ('owner','owner@example.test',?,?)").run(now, now);
    for (const id of ["personal", "team"]) {
      sqlite.prepare("INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual',?,'en',?,?)").run(id, id, now, now);
    }
    const notice = sqlite.prepare("INSERT INTO notifications(id,user_id,workspace_id,type,title,body,read_at,created_at) VALUES (?,'owner',?,?,'Title','Body',?,?)");
    notice.run("law", "personal", "legislation_monitor", null, now);
    notice.run("workspace", "personal", "support_reply", null, now);
    notice.run("read", "personal", "support_reply", now, now);
    notice.run("team-law", "team", "legislation_monitor", null, now);

    const load = (workspaceId: string) => readWebsiteNotificationPreferences(d1, "owner", workspaceId);
    const count = async (workspaceId: string) => countWebsiteNotifications(d1, "owner", workspaceId, await load(workspaceId));
    const defaults = await load("personal");
    assert.deepEqual(defaults, { enabled: true, documents: true, legislation: true, workspace: true });
    assert.equal(await count("personal"), 2);

    const save = sqlite.prepare("INSERT INTO consents(id,user_id,workspace_id,type,version,scope_json,granted_at) VALUES (?,'owner','personal',?,'1',?,?)");
    save.run("mute-law", WEBSITE_NOTIFICATION_PREFERENCE, JSON.stringify({ ...defaults, legislation: false }), now);
    assert.equal(await count("personal"), 1);
    assert.equal(await count("team"), 1);

    const documentFilter = websiteNotificationFilter({ ...defaults, documents: false });
    const selected = sqlite.prepare(`SELECT id FROM (SELECT 'doc' AS id, 'comment_added' AS type, 'doc-id' AS document_id) WHERE ${documentFilter.sql}`);
    assert.deepEqual(selected.all(...documentFilter.bindings), []);

    save.run("pause", WEBSITE_NOTIFICATION_PREFERENCE, JSON.stringify({ ...defaults, enabled: false }), now);
    assert.equal(await count("personal"), 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM notifications WHERE workspace_id='personal'").get()?.total, 3);
    assert.equal(websiteNotificationPreferencesSchema.safeParse({ ...defaults, email: false }).success, false);
  } finally {
    sqlite.close();
  }
});
