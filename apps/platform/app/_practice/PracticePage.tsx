import { requireChatGPTUser } from "../chatgpt-auth";
import { getOrCreateUserProfile } from "../../lib/document-builder/storage/db";
import { database } from "../../lib/storage/connection";
import type { Locale } from "../../lib/practice/domain";
import { message } from "../../lib/practice/localization";
import { PracticeApp } from "./PracticeApp";
import "./practice.css";

export async function renderPractice({
  locale = "ru",
  workspaceId,
  embedded = false,
  initialCaseId,
  invitationToken,
}: {
  locale?: Locale;
  workspaceId?: string;
  embedded?: boolean;
  initialCaseId?: string;
  invitationToken?: string;
}) {
  const user = await requireChatGPTUser("/practice");
  const profile = await getOrCreateUserProfile(user);
  if (process.env.PRACTICE_ENABLED !== "true")
    return (
      <div className="practice-invite">
        <h1>JURO Practice</h1>
        <p>{message(locale, "MODULE_DISABLED")}</p>
      </div>
    );
  const available = (
    await database().pool.query(
      `SELECT w.id FROM workspaces w JOIN practice_workspaces p ON p.workspace_id=w.id WHERE
    EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=$1 AND m.status='active')
    OR EXISTS(SELECT 1 FROM practice_invitations i WHERE i.workspace_id=w.id AND i.accepted_by=$1 AND i.confirmed_at IS NOT NULL AND i.revoked_at IS NULL)
    ORDER BY CASE WHEN w.id=$2 THEN 0 ELSE 1 END,w.name`,
      [profile.id, workspaceId ?? ""],
    )
  ).rows;
  const selected = workspaceId
    ? available.find((row) => row.id === workspaceId)?.id
    : available[0]?.id;
  if (!selected && !invitationToken)
    return (
      <div className="practice-invite">
        <h1>JURO Practice</h1>
        <p>{message(locale, "PILOT_INVITATION_REQUIRED")}</p>
      </div>
    );
  return (
    <PracticeApp
      workspaceId={selected ?? "pending-invitation"}
      locale={locale}
      todayLabel={new Intl.DateTimeFormat(locale, {
        dateStyle: "long",
        timeZone: "Asia/Tashkent",
      }).format(new Date())}
      embedded={embedded}
      initialCaseId={initialCaseId}
      invitationToken={invitationToken}
    />
  );
}
