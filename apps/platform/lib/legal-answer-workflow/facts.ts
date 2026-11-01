import { z } from "zod";

export const legalFactUpdateSchema = z.object({ factId: z.string().uuid(), status: z.enum(["confirmed", "rejected"]) }).strict();
export class LegalFactUnavailable extends Error {
  constructor() { super("FACT_UNAVAILABLE"); }
}

/** User confirmation changes saved case context, never the authority of a legal source. */
export async function updateLegalFact(input: {
  db: D1Database; workspaceId: string; userId: string; factId: string; status: "confirmed" | "rejected";
}) {
  const fields = legalFactUpdateSchema.parse({ factId: input.factId, status: input.status });
  const now = new Date().toISOString();
  const claimed = () => input.db.prepare(`SELECT CASE WHEN changes()=1 THEN 1
    ELSE json_extract('FACT_UNAVAILABLE','$') END AS owned`);
  try {
    await input.db.batch([
      input.db.prepare("UPDATE workspace_members SET updated_at=updated_at WHERE workspace_id=? AND user_id=? AND status='active'")
        .bind(input.workspaceId, input.userId), claimed(),
      input.db.prepare(`UPDATE conversations SET updated_at=updated_at WHERE workspace_id=? AND owner_user_id=? AND status='active'
        AND id IN (SELECT conversation_id FROM confirmed_facts WHERE id=?)`)
        .bind(input.workspaceId, input.userId, fields.factId), claimed(),
      input.db.prepare(`UPDATE confirmed_facts SET status=?,confirmed_by_user_id=?,confirmed_at=?,updated_at=? WHERE id=?
        AND conversation_id IN (SELECT id FROM conversations WHERE workspace_id=? AND owner_user_id=? AND status='active')`)
        .bind(fields.status, fields.status === "confirmed" ? input.userId : null,
          fields.status === "confirmed" ? now : null, now, fields.factId, input.workspaceId, input.userId), claimed(),
    ]);
  } catch { throw new LegalFactUnavailable(); }
  return fields;
}
