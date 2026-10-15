import type { PoolClient } from "pg";
import { practiceActor, transaction } from "./access";
import { crmCommand } from "./crm";
import { documentCommand } from "./documents";
import { financeCommand } from "./finance";
import { calendarCommand } from "./calendar";
import { commandSchema, hash, PracticeError, type Actor } from "./domain";

export async function idempotent<T>(
  client: PoolClient,
  actor: Actor,
  key: string,
  requestHash: string,
  run: () => Promise<T>,
): Promise<T> {
  if (!/^[A-Za-z0-9._:-]{16,180}$/.test(key))
    throw new PracticeError("IDEMPOTENCY_KEY_REQUIRED");
  // A workspace lock serializes financial postings and role changes; the same
  // request cannot post twice even when it arrives in parallel.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `practice:${actor.workspaceId}`,
  ]);
  const prior = (
    await client.query(
      `SELECT request_hash,response FROM practice_commands WHERE workspace_id=$1 AND user_id=$2 AND key=$3`,
      [actor.workspaceId, actor.userId, key],
    )
  ).rows[0];
  if (prior) {
    if (prior.request_hash !== requestHash)
      throw new PracticeError("IDEMPOTENCY_CONFLICT", 409);
    return prior.response;
  }
  const response = await run();
  await client.query(
    `INSERT INTO practice_commands(workspace_id,user_id,key,request_hash,response) VALUES($1,$2,$3,$4,$5)`,
    [
      actor.workspaceId,
      actor.userId,
      key,
      requestHash,
      JSON.stringify(response),
    ],
  );
  return response;
}
export async function executeCommand(
  userId: string,
  workspaceId: string,
  key: string,
  input: unknown,
) {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new PracticeError("INVALID_INPUT");
  const command = parsed.data;
  return transaction(async (client) => {
    const actor = await practiceActor(
      client,
      userId,
      workspaceId,
      command.action !== "notification.read" &&
        command.action !== "preferences.save",
    );
    return idempotent(
      client,
      actor,
      key,
      hash(JSON.stringify(command)),
      async () => {
        // Recheck after acquiring the workspace lock, so revocation wins over queued writes.
        await practiceActor(
          client,
          userId,
          workspaceId,
          command.action !== "notification.read" &&
            command.action !== "preferences.save",
        );
        const result =
          (await crmCommand(client, actor, command)) ??
          (await documentCommand(client, actor, command)) ??
          (await financeCommand(client, actor, command)) ??
          (await calendarCommand(client, actor, command));
        if (!result) throw new PracticeError("INVALID_ACTION");
        return result;
      },
    );
  });
}
