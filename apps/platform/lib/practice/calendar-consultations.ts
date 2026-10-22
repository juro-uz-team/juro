import type { PoolClient } from "pg";
import { requireCase, audit } from "./access";
import { hash, PracticeError, type Actor } from "./domain";
import { matterScopeFor } from "./case-scope";

type GoogleApi = (path: string, init?: RequestInit) => Promise<any>;
type Availability = (
  client: PoolClient,
  organizer: string,
  start: string,
  end: string,
  except?: string,
  connectionId?: string,
  googleId?: string,
) => Promise<void>;
type Times = (event: any) => { start: string; end: string };

async function authorized(
  client: PoolClient,
  actor: Actor,
  consultationId: string,
) {
  const row = (
    await client.query(
      `SELECT c.*,p.user_id AS organizer_user_id FROM lawyer_consultations c JOIN lawyer_profiles p ON p.id=c.lawyer_profile_id JOIN practice_matters m ON m.case_id=c.case_id AND m.responsible_user_id=p.user_id WHERE c.id=$1 AND m.workspace_id=$2 FOR UPDATE OF c`,
      [consultationId, actor.workspaceId],
    )
  ).rows[0];
  if (!row) throw new PracticeError("NOT_FOUND", 404);
  await requireCase(client, actor, row.case_id);
  return row;
}
export async function updateJuroConsultation(
  client: PoolClient,
  actor: Actor,
  id: string,
  action: "update" | "cancel" | "confirm",
  input: {
    start?: string;
    end?: string;
    timezone?: string;
    caseId?: string;
    organizerUserId?: string;
  } = {},
) {
  const current = await authorized(client, actor, id);
  const lawyer = actor.userId === current.organizer_user_id,
    customer = actor.userId === current.client_user_id;
  if (
    (input.caseId && input.caseId !== current.case_id) ||
    (input.organizerUserId &&
      input.organizerUserId !== current.organizer_user_id)
  )
    throw new PracticeError("NOT_FOUND", 404);
  if (!lawyer && !customer) throw new PracticeError("ACCESS_DENIED", 403);
  if (action === "update" && !lawyer)
    throw new PracticeError("ACCESS_DENIED", 403);
  if (
    action === "update" &&
    (Date.parse(input.start ?? "") <= Date.now() ||
      Date.parse(input.end ?? "") - Date.parse(input.start ?? "") <
        15 * 60000 ||
      Date.parse(input.end ?? "") - Date.parse(input.start ?? "") > 8 * 3600000)
  )
    throw new PracticeError("INVALID_EVENT_TIME");
  if (action === "confirm" && (!customer || current.status !== "proposed"))
    throw new PracticeError("INVALID_TRANSITION", 409);
  if (!["proposed", "confirmed"].includes(current.status))
    throw new PracticeError("INVALID_TRANSITION", 409);
  const now = new Date().toISOString();
  if (action === "update")
    await client.query(
      `UPDATE lawyer_consultations SET starts_at=$2,ends_at=$3,timezone=$4,status='proposed',updated_at=$5 WHERE id=$1`,
      [id, input.start, input.end, input.timezone ?? current.timezone, now],
    );
  else
    await client.query(
      `UPDATE lawyer_consultations SET status=$2,updated_at=$3 WHERE id=$1`,
      [id, action === "cancel" ? "cancelled" : "confirmed", now],
    );
  await audit(client, actor, "consultation", id, `consultation.${action}`, {
    previousStatus: current.status,
  });
  return { id: `juro:${id}` };
}
export async function pullJuroConsultation(
  client: PoolClient,
  actor: Actor,
  connection: any,
  remote: any,
  available: Availability,
  times: Times,
) {
  const mapped = (
    await client.query(
      `SELECT g.*,c.updated_at,c.case_id FROM practice_google_consultations g JOIN lawyer_consultations c ON c.id=g.consultation_id WHERE g.connection_id=$1 AND g.google_id=$2 FOR UPDATE OF g,c`,
      [connection.id, remote.id],
    )
  ).rows[0];
  if (!mapped) return false;
  try {
    await requireCase(client, actor, mapped.case_id);
  } catch (error) {
    if (error instanceof PracticeError) return true;
    throw error;
  }
  if (mapped.etag === remote.etag) return true;
  if (mapped.updated_at !== mapped.synced_updated_at) {
    await client.query(
      `UPDATE practice_google_consultations SET state='conflict',remote_snapshot=$3 WHERE connection_id=$1 AND consultation_id=$2`,
      [connection.id, mapped.consultation_id, JSON.stringify(remote)],
    );
    return true;
  }
  await applyRemote(
    client,
    actor,
    connection,
    mapped,
    remote,
    available,
    times,
  );
  return true;
}
async function applyRemote(
  client: PoolClient,
  actor: Actor,
  connection: any,
  mapped: any,
  remote: any,
  available: Availability,
  times: Times,
) {
  const consultation = await authorized(client, actor, mapped.consultation_id),
    now = new Date().toISOString();
  if (!["proposed", "confirmed", "cancelled"].includes(consultation.status)) {
    await client.query(
      `UPDATE practice_google_consultations SET state='conflict',remote_snapshot=$3 WHERE connection_id=$1 AND consultation_id=$2`,
      [connection.id, mapped.consultation_id, JSON.stringify(remote)],
    );
    return;
  }
  if (remote.status === "cancelled")
    await client.query(
      `UPDATE lawyer_consultations SET status='cancelled',updated_at=$2 WHERE id=$1`,
      [consultation.id, now],
    );
  else {
    const time = times(remote);
    try {
      await available(
        client,
        consultation.organizer_user_id,
        time.start,
        time.end,
        `juro:${consultation.id}`,
        connection.id,
        remote.id,
      );
    } catch (error) {
      if (
        !(error instanceof PracticeError) ||
        error.code !== "SLOT_UNAVAILABLE"
      )
        throw error;
      await client.query(
        `UPDATE practice_google_consultations SET state='conflict',remote_snapshot=$3 WHERE connection_id=$1 AND consultation_id=$2`,
        [connection.id, consultation.id, JSON.stringify(remote)],
      );
      return;
    }
    // A provider changing the time does not manufacture client confirmation.
    await client.query(
      `UPDATE lawyer_consultations SET starts_at=$2,ends_at=$3,status='proposed',updated_at=$4 WHERE id=$1`,
      [consultation.id, time.start, time.end, now],
    );
  }
  await client.query(
    `UPDATE practice_google_consultations SET etag=$3,synced_updated_at=$4,state='synced',remote_snapshot=NULL WHERE connection_id=$1 AND consultation_id=$2`,
    [connection.id, consultation.id, remote.etag, now],
  );
  await client.query(
    `DELETE FROM practice_calendar_busy WHERE connection_id=$1 AND google_id=$2`,
    [connection.id, remote.id],
  );
  await audit(
    client,
    actor,
    "consultation",
    consultation.id,
    "consultation.google_updated",
  );
}
export async function pushJuroConsultations(
  client: PoolClient,
  actor: Actor,
  connection: any,
  path: string,
  google: GoogleApi,
) {
  const rows = (
    await client.query(
      `SELECT c.*,g.google_id,g.etag,g.state AS sync_state,p.user_id FROM lawyer_consultations c JOIN lawyer_profiles p ON p.id=c.lawyer_profile_id JOIN practice_matters m ON m.case_id=c.case_id AND m.responsible_user_id=p.user_id
    LEFT JOIN practice_google_consultations g ON g.consultation_id=c.id AND g.connection_id=$4
    WHERE m.workspace_id=$1 AND ${matterScopeFor()} AND p.user_id=$3 AND (g.synced_updated_at IS NULL OR g.synced_updated_at<>c.updated_at) AND coalesce(g.state,'')<>'conflict'`,
      [actor.workspaceId, actor.role, actor.userId, connection.id],
    )
  ).rows;
  let pushed = 0;
  for (const row of rows) {
    const googleId =
      row.google_id ??
      hash(`${actor.userId}:consultation:${row.id}`).slice(0, 40);
    let remote: any = {};
    if (row.status === "cancelled") {
      if (row.google_id)
        await google(`${path}/${googleId}`, {
          method: "DELETE",
          headers: row.etag ? { "if-match": row.etag } : {},
        });
    } else {
      const body = {
        id: googleId,
        status: row.status === "proposed" ? "tentative" : "confirmed",
        summary: "JURO · Consultation",
        description: "JURO",
        start: { dateTime: row.starts_at, timeZone: row.timezone },
        end: { dateTime: row.ends_at, timeZone: row.timezone },
      };
      try {
        remote = await google(row.google_id ? `${path}/${googleId}` : path, {
          method: row.google_id ? "PUT" : "POST",
          headers: row.etag ? { "if-match": row.etag } : {},
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (
          !row.google_id &&
          error instanceof PracticeError &&
          error.code === "GOOGLE_SYNC_FAILED"
        ) {
          remote = await google(`${path}/${googleId}`);
          if (
            Date.parse(remote.start?.dateTime) !== Date.parse(row.starts_at) ||
            Date.parse(remote.end?.dateTime) !== Date.parse(row.ends_at)
          ) {
            await client.query(
              `INSERT INTO practice_google_consultations(connection_id,consultation_id,google_id,etag,synced_updated_at,state,remote_snapshot) VALUES($1,$2,$3,$4,'','conflict',$5)`,
              [
                connection.id,
                row.id,
                googleId,
                remote.etag,
                JSON.stringify(remote),
              ],
            );
            continue;
          }
        } else throw error;
      }
    }
    await client.query(
      `INSERT INTO practice_google_consultations(connection_id,consultation_id,google_id,etag,synced_updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(connection_id,consultation_id) DO UPDATE SET etag=excluded.etag,synced_updated_at=excluded.synced_updated_at,state='synced',remote_snapshot=NULL`,
      [connection.id, row.id, googleId, remote.etag ?? null, row.updated_at],
    );
    await client.query(
      `DELETE FROM practice_calendar_busy WHERE connection_id=$1 AND google_id=$2`,
      [connection.id, googleId],
    );
    pushed++;
  }
  return pushed;
}
export async function juroConflicts(client: PoolClient, connectionId: string) {
  return (
    await client.query(
      `SELECT 'juro:' || consultation_id AS "eventId",remote_snapshot AS remote FROM practice_google_consultations WHERE connection_id=$1 AND state='conflict'`,
      [connectionId],
    )
  ).rows;
}
export async function resolveJuroConflict(
  client: PoolClient,
  actor: Actor,
  connection: any,
  id: string,
  choice: "local" | "remote",
  available: Availability,
  times: Times,
) {
  const mapped = (
    await client.query(
      `SELECT * FROM practice_google_consultations WHERE connection_id=$1 AND consultation_id=$2 AND state='conflict' FOR UPDATE`,
      [connection.id, id],
    )
  ).rows[0];
  if (!mapped) throw new PracticeError("NOT_FOUND", 404);
  await authorized(client, actor, id);
  if (choice === "remote")
    await applyRemote(
      client,
      actor,
      connection,
      mapped,
      mapped.remote_snapshot,
      available,
      times,
    );
  else
    await client.query(
      `UPDATE practice_google_consultations SET state='synced',etag=$3,remote_snapshot=NULL,synced_updated_at='' WHERE connection_id=$1 AND consultation_id=$2`,
      [connection.id, id, mapped.remote_snapshot.etag],
    );
  return { ok: true };
}
