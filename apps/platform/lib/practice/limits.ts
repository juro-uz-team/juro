import { transaction } from "./access";
import { ApiAuthError } from "../auth/safe-write";
import { message } from "./localization";

/** A narrow bridge to JURO membership. Limits are operator-configured, never
 * invented from commercial plan names by this module. */
export async function withPracticeSeat<T>(
  invitationId: string,
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  if (process.env.PRACTICE_ENABLED !== "true") return run();
  return transaction(async (client) => {
    const invitation = (
      await client.query(
        `SELECT workspace_id FROM workspace_invitations WHERE id=$1`,
        [invitationId],
      )
    ).rows[0];
    if (!invitation) return run();
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `practice:${invitation.workspace_id}`,
    ]);
    const config = (
      await client.query(
        `SELECT seat_limit FROM practice_workspaces WHERE workspace_id=$1`,
        [invitation.workspace_id],
      )
    ).rows[0];
    if (config?.seat_limit) {
      const state = (
        await client.query(
          `SELECT count(*)::integer AS count,bool_or(user_id=$2) AS already_active FROM workspace_members WHERE workspace_id=$1 AND status='active'`,
          [invitation.workspace_id, userId],
        )
      ).rows[0];
      if (!state.already_active && state.count >= config.seat_limit) {
        const locale = (
          await client.query(`SELECT locale FROM user_profiles WHERE id=$1`, [
            userId,
          ])
        ).rows[0]?.locale;
        throw new ApiAuthError(
          message(
            locale === "uz" || locale === "en" ? locale : "ru",
            "SEAT_LIMIT",
          ),
          403,
        );
      }
    }
    return run();
  });
}
