import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { parseDate, toZoned } from "@internationalized/date";
import type { PoolClient } from "pg";
import { audit, memberAllowed, requireCase } from "./access";
import {
  hash,
  isLegal,
  PracticeError,
  type Actor,
  type Command,
} from "./domain";
import {
  juroConflicts,
  pullJuroConsultation,
  pushJuroConsultations,
  resolveJuroConflict,
  updateJuroConsultation,
} from "./calendar-consultations";

type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
};
type GoogleEvent = {
  id: string;
  etag?: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
};
function configuration() {
  const clientId = process.env.GOOGLE_CLIENT_ID,
    secret = process.env.GOOGLE_CLIENT_SECRET,
    redirect = process.env.PRACTICE_GOOGLE_REDIRECT_URI,
    key = process.env.PRACTICE_GOOGLE_TOKEN_KEY;
  if (!clientId || !secret || !redirect || !key || !/^[a-f0-9]{64}$/i.test(key))
    throw new PracticeError("GOOGLE_NOT_CONFIGURED", 503);
  return { clientId, secret, redirect, key: Buffer.from(key, "hex") };
}
function seal(tokens: Tokens) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", configuration().key, iv);
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((value) => value.toString("base64url"))
    .join(".");
}
function unseal(value: string): Tokens {
  const [iv, tag, bytes] = value
    .split(".")
    .map((item) => Buffer.from(item, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", configuration().key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(bytes), decipher.final()]).toString("utf8"),
  );
}
export async function oauthStart(client: PoolClient, actor: Actor) {
  if (!isLegal(actor) || !actor.writable)
    throw new PracticeError("ACCESS_DENIED", 403);
  const config = configuration(),
    state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  await client.query(
    `INSERT INTO practice_oauth_states(hash,workspace_id,user_id,verifier,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
    [hash(state), actor.workspaceId, actor.userId, verifier],
  );
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirect,
    response_type: "code",
    scope:
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events",
    state,
    access_type: "offline",
    prompt: "consent",
    code_challenge_method: "S256",
    code_challenge: Buffer.from(hash(verifier), "hex").toString("base64url"),
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
}
export async function oauthCallback(
  client: PoolClient,
  userId: string,
  code: string,
  state: string,
  fetcher = fetch,
) {
  const config = configuration();
  const stored = (
    await client.query(
      `UPDATE practice_oauth_states SET used_at=now() WHERE hash=$1 AND user_id=$2 AND used_at IS NULL AND expires_at>now() RETURNING *`,
      [hash(state), userId],
    )
  ).rows[0];
  if (!stored) throw new PracticeError("OAUTH_STATE_INVALID", 403);
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.secret,
      code,
      redirect_uri: config.redirect,
      grant_type: "authorization_code",
      code_verifier: stored.verifier,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new PracticeError("GOOGLE_AUTH_FAILED", 502);
  const tokens = await response.json();
  if (!tokens.access_token || !tokens.refresh_token)
    throw new PracticeError("GOOGLE_OFFLINE_ACCESS_REQUIRED", 409);
  await client.query(
    `INSERT INTO practice_calendar_connections(id,workspace_id,user_id,encrypted_tokens) VALUES($1,$2,$3,$4)
    ON CONFLICT(workspace_id,user_id) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens,state='connected',last_error=NULL`,
    [
      crypto.randomUUID(),
      stored.workspace_id,
      userId,
      seal({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + Number(tokens.expires_in) * 1000,
      }),
    ],
  );
  return stored.workspace_id as string;
}
async function google(
  client: PoolClient,
  connection: Record<string, any>,
  path: string,
  init: RequestInit = {},
  fetcher = fetch,
): Promise<any> {
  let tokens = unseal(connection.encrypted_tokens);
  if (tokens.expires_at < Date.now() + 60000) {
    const config = configuration();
    const response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.secret,
        refresh_token: tokens.refresh_token ?? "",
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new PracticeError("GOOGLE_REAUTH_REQUIRED", 409);
    const refreshed = await response.json();
    tokens = {
      ...tokens,
      access_token: refreshed.access_token,
      expires_at: Date.now() + Number(refreshed.expires_in) * 1000,
    };
    connection.encrypted_tokens = seal(tokens);
    await client.query(
      `UPDATE practice_calendar_connections SET encrypted_tokens=$2 WHERE id=$1`,
      [connection.id, connection.encrypted_tokens],
    );
  }
  const response = await fetcher(
    `https://www.googleapis.com/calendar/v3/${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (response.status === 401 || response.status === 403)
    throw new PracticeError("GOOGLE_REAUTH_REQUIRED", 409);
  if (response.status === 410)
    throw new PracticeError("GOOGLE_SYNC_EXPIRED", 409);
  if (!response.ok && !(init.method === "DELETE" && response.status === 404))
    throw new PracticeError(
      response.status === 412 ? "GOOGLE_CONFLICT" : "GOOGLE_SYNC_FAILED",
      502,
    );
  return response.status === 204 || response.status === 404
    ? {}
    : response.json();
}
export async function googleCalendars(
  client: PoolClient,
  actor: Actor,
  fetcher = fetch,
) {
  const conn = await connection(client, actor);
  const response = await google(
    client,
    conn,
    "users/me/calendarList?minAccessRole=writer",
    {},
    fetcher,
  );
  return {
    items: response.items.map((calendar: any) => ({
      id: calendar.id,
      name: calendar.summary,
      timezone: calendar.timeZone,
    })),
  };
}
export async function googleSelect(
  client: PoolClient,
  actor: Actor,
  calendarId: string,
) {
  const calendars = await googleCalendars(client, actor);
  if (
    !calendars.items.some(
      (calendar: { id: string }) => calendar.id === calendarId,
    )
  )
    throw new PracticeError("INVALID_CALENDAR");
  const conn = await connection(client, actor);
  if (conn.calendar_id && conn.calendar_id !== calendarId)
    throw new PracticeError("DISCONNECT_BEFORE_SWITCHING", 409);
  await client.query(
    `UPDATE practice_calendar_connections SET calendar_id=$2,sync_token=NULL WHERE id=$1`,
    [conn.id, calendarId],
  );
  return { ok: true };
}
export async function googleDisconnect(client: PoolClient, actor: Actor) {
  // Remove only local credentials and mappings; remote calendars remain intact.
  await client.query(
    `DELETE FROM practice_calendar_connections WHERE workspace_id=$1 AND user_id=$2`,
    [actor.workspaceId, actor.userId],
  );
  await audit(client, actor, "calendar", actor.userId, "google.disconnected");
  return { ok: true };
}
async function connection(client: PoolClient, actor: Actor) {
  const row = (
    await client.query(
      `SELECT * FROM practice_calendar_connections WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE`,
      [actor.workspaceId, actor.userId],
    )
  ).rows[0];
  if (!row) throw new PracticeError("GOOGLE_NOT_CONNECTED", 409);
  return row;
}
function eventTimes(event: GoogleEvent) {
  const convert = (value: NonNullable<GoogleEvent["start"]>) =>
    value.dateTime ??
    (value.date
      ? toZoned(parseDate(value.date), value.timeZone ?? "Asia/Tashkent")
          .toDate()
          .toISOString()
      : null);
  const start = event.start && convert(event.start),
    end = event.end && convert(event.end);
  if (
    !start ||
    !end ||
    !Number.isFinite(Date.parse(start)) ||
    Date.parse(start) >= Date.parse(end)
  )
    throw new PracticeError("GOOGLE_EVENT_INVALID", 502);
  return { start, end };
}
export async function syncGoogle(
  client: PoolClient,
  actor: Actor,
  fetcher = fetch,
) {
  const conn = await connection(client, actor);
  if (!conn.calendar_id)
    throw new PracticeError("CALENDAR_SELECTION_REQUIRED", 409);
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `practice-calendar:${actor.userId}`,
  ]);
  const path = `calendars/${encodeURIComponent(conn.calendar_id)}/events`;
  let nextPage: string | undefined,
    nextSync: string | undefined,
    pages = 0,
    received = 0,
    pushed = 0;
  do {
    const params = new URLSearchParams({
      maxResults: "250",
      showDeleted: "true",
      singleEvents: "true",
    });
    if (conn.sync_token) params.set("syncToken", conn.sync_token);
    if (nextPage) params.set("pageToken", nextPage);
    let result;
    try {
      result = await google(client, conn, `${path}?${params}`, {}, fetcher);
    } catch (error) {
      if (
        error instanceof PracticeError &&
        error.code === "GOOGLE_SYNC_EXPIRED" &&
        conn.sync_token
      ) {
        conn.sync_token = null;
        nextPage = undefined;
        await client.query(
          `DELETE FROM practice_calendar_busy WHERE connection_id=$1`,
          [conn.id],
        );
        continue;
      }
      throw error;
    }
    for (const remote of (result.items ?? []) as GoogleEvent[]) {
      const linked = (
        await client.query(
          `SELECT g.*,e.revision,e.status,e.case_id FROM practice_google_events g JOIN practice_events e ON e.id=g.event_id WHERE g.connection_id=$1 AND g.google_id=$2 FOR UPDATE OF g,e`,
          [conn.id, remote.id],
        )
      ).rows[0];
      if (linked) {
        try {
          await requireCase(client, actor, linked.case_id);
        } catch (error) {
          if (error instanceof PracticeError) continue;
          throw error;
        }
        if (remote.etag === linked.etag) continue;
        if (linked.revision !== linked.synced_revision) {
          await client.query(
            `UPDATE practice_google_events SET state='conflict',remote_snapshot=$3 WHERE connection_id=$1 AND event_id=$2`,
            [conn.id, linked.event_id, JSON.stringify(remote)],
          );
          continue;
        }
        await applyRemote(client, conn, linked, remote);
        received++;
      } else if (
        await pullJuroConsultation(
          client,
          actor,
          conn,
          remote,
          available,
          eventTimes,
        )
      ) {
        /* Existing source owns this event. */
      } else if (
        remote.status === "cancelled" ||
        remote.transparency === "transparent"
      )
        await client.query(
          `DELETE FROM practice_calendar_busy WHERE connection_id=$1 AND google_id=$2`,
          [conn.id, remote.id],
        );
      else if (remote.start && remote.end) {
        const times = eventTimes(remote);
        await client.query(
          `INSERT INTO practice_calendar_busy(connection_id,google_id,starts_at,ends_at) VALUES($1,$2,$3,$4)
          ON CONFLICT(connection_id,google_id) DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at`,
          [conn.id, remote.id, times.start, times.end],
        );
      }
    }
    nextPage = result.nextPageToken;
    nextSync = result.nextSyncToken;
    if (++pages > 40) throw new PracticeError("GOOGLE_SYNC_LIMIT", 503);
  } while (nextPage);
  const dirty = (
    await client.query(
      `SELECT e.*,g.google_id,g.etag,g.synced_revision,g.state AS sync_state FROM practice_events e
    LEFT JOIN practice_google_events g ON g.event_id=e.id AND g.connection_id=$1
    WHERE e.workspace_id=$2 AND e.organizer_user_id=$3 AND (g.synced_revision IS NULL OR e.revision<>g.synced_revision) AND coalesce(g.state,'')<>'conflict'`,
      [conn.id, actor.workspaceId, actor.userId],
    )
  ).rows;
  for (const event of dirty) {
    try {
      await requireCase(client, actor, event.case_id);
    } catch (error) {
      if (error instanceof PracticeError) continue;
      throw error;
    }
    // Google accepts deterministic base32hex IDs: retrying an insert cannot create another event.
    const googleId =
      event.google_id ?? hash(`${actor.userId}:${event.id}`).slice(0, 40);
    let remote: GoogleEvent = {} as GoogleEvent;
    if (event.status === "cancelled") {
      if (event.google_id)
        await google(
          client,
          conn,
          `${path}/${googleId}`,
          {
            method: "DELETE",
            headers: event.etag ? { "if-match": event.etag } : {},
          },
          fetcher,
        );
    } else {
      const body = {
        id: googleId,
        status: "confirmed",
        summary: "JURO · Consultation",
        description: "JURO",
        start: {
          dateTime: new Date(event.starts_at).toISOString(),
          timeZone: event.timezone,
        },
        end: {
          dateTime: new Date(event.ends_at).toISOString(),
          timeZone: event.timezone,
        },
      };
      try {
        remote = await google(
          client,
          conn,
          event.google_id ? `${path}/${googleId}` : path,
          {
            method: event.google_id ? "PUT" : "POST",
            headers: event.etag ? { "if-match": event.etag } : {},
            body: JSON.stringify(body),
          },
          fetcher,
        );
      } catch (error) {
        if (
          !event.google_id &&
          error instanceof PracticeError &&
          error.code === "GOOGLE_SYNC_FAILED"
        ) {
          remote = await google(
            client,
            conn,
            `${path}/${googleId}`,
            {},
            fetcher,
          );
          const times =
            remote.status === "cancelled" ? null : eventTimes(remote);
          if (
            !times ||
            Date.parse(times.start) !== new Date(event.starts_at).getTime() ||
            Date.parse(times.end) !== new Date(event.ends_at).getTime()
          ) {
            await client.query(
              `INSERT INTO practice_google_events(connection_id,event_id,google_id,etag,synced_revision,state,remote_snapshot) VALUES($1,$2,$3,$4,-1,'conflict',$5)`,
              [
                conn.id,
                event.id,
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
      `INSERT INTO practice_google_events(connection_id,event_id,google_id,etag,synced_revision) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(connection_id,event_id) DO UPDATE SET etag=excluded.etag,synced_revision=excluded.synced_revision,state='synced',remote_snapshot=NULL`,
      [conn.id, event.id, googleId, remote.etag ?? null, event.revision],
    );
    await client.query(
      `DELETE FROM practice_calendar_busy WHERE connection_id=$1 AND google_id=$2`,
      [conn.id, googleId],
    );
    pushed++;
  }
  pushed += await pushJuroConsultations(
    client,
    actor,
    conn,
    path,
    (path, init) => google(client, conn, path, init, fetcher),
  );
  await client.query(
    `UPDATE practice_calendar_connections SET sync_token=$2,last_synced_at=now(),last_error=NULL,state='connected' WHERE id=$1`,
    [conn.id, nextSync ?? conn.sync_token],
  );
  const conflicts = (
    await client.query(
      `SELECT event_id,remote_snapshot FROM practice_google_events WHERE connection_id=$1 AND state='conflict'`,
      [conn.id],
    )
  ).rows;
  return {
    received,
    pushed,
    conflicts: [
      ...conflicts.map((row) => ({
        eventId: row.event_id,
        remote: row.remote_snapshot,
      })),
      ...(await juroConflicts(client, conn.id)),
    ],
  };
}
async function applyRemote(
  client: PoolClient,
  conn: Record<string, any>,
  linked: Record<string, any>,
  remote: GoogleEvent,
) {
  if (remote.status === "cancelled")
    await client.query(
      `UPDATE practice_events SET status='cancelled',revision=revision+1,updated_at=now() WHERE id=$1`,
      [linked.event_id],
    );
  else {
    const times = eventTimes(remote);
    try {
      await available(
        client,
        conn.user_id,
        times.start,
        times.end,
        linked.event_id,
        conn.id,
        remote.id,
      );
    } catch (error) {
      if (
        !(error instanceof PracticeError) ||
        error.code !== "SLOT_UNAVAILABLE"
      )
        throw error;
      await client.query(
        `UPDATE practice_google_events SET state='conflict',remote_snapshot=$3 WHERE connection_id=$1 AND event_id=$2`,
        [conn.id, linked.event_id, JSON.stringify(remote)],
      );
      return;
    }
    await client.query(
      `UPDATE practice_events SET starts_at=$2,ends_at=$3,status='confirmed',revision=revision+1,updated_at=now() WHERE id=$1`,
      [linked.event_id, times.start, times.end],
    );
  }
  await client.query(
    `UPDATE practice_google_events SET synced_revision=(SELECT revision FROM practice_events WHERE id=$2),etag=$3,state='synced',remote_snapshot=NULL WHERE connection_id=$1 AND event_id=$2`,
    [conn.id, linked.event_id, remote.etag ?? null],
  );
  await client.query(
    `DELETE FROM practice_calendar_busy WHERE connection_id=$1 AND google_id=$2`,
    [conn.id, remote.id],
  );
}
export async function resolveGoogleConflict(
  client: PoolClient,
  actor: Actor,
  eventId: string,
  choice: "local" | "remote",
) {
  const conn = await connection(client, actor);
  if (eventId.startsWith("juro:")) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `practice-calendar:${actor.userId}`,
    ]);
    return resolveJuroConflict(
      client,
      actor,
      conn,
      eventId.slice(5),
      choice,
      available,
      eventTimes,
    );
  }
  const linked = (
    await client.query(
      `SELECT g.*,e.case_id FROM practice_google_events g JOIN practice_events e ON e.id=g.event_id WHERE g.connection_id=$1 AND g.event_id=$2 AND g.state='conflict' FOR UPDATE OF g,e`,
      [conn.id, eventId],
    )
  ).rows[0];
  if (!linked) throw new PracticeError("NOT_FOUND", 404);
  await requireCase(client, actor, linked.case_id);
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `practice-calendar:${actor.userId}`,
  ]);
  if (choice === "remote")
    await applyRemote(client, conn, linked, linked.remote_snapshot);
  else
    await client.query(
      `UPDATE practice_google_events SET state='synced',etag=$3,remote_snapshot=NULL,synced_revision=-1 WHERE connection_id=$1 AND event_id=$2`,
      [conn.id, eventId, linked.remote_snapshot.etag ?? null],
    );
  return { ok: true };
}
export async function available(
  client: PoolClient,
  organizerId: string,
  start: string,
  end: string,
  except?: string,
  connectionId?: string,
  googleId?: string,
) {
  const overlap = (
    await client.query(
      `SELECT 1 FROM practice_events e WHERE organizer_user_id=$1 AND status<>'cancelled' AND starts_at<$3 AND ends_at>$2 AND ($4::text IS NULL OR id<>$4)
    UNION ALL SELECT 1 FROM lawyer_consultations c JOIN lawyer_profiles p ON p.id=c.lawyer_profile_id WHERE p.user_id=$1 AND c.status IN ('proposed','confirmed','in_progress') AND c.starts_at::timestamptz<$3 AND c.ends_at::timestamptz>$2 AND ($7::text IS NULL OR c.id<>$7)
    UNION ALL SELECT 1 FROM lawyer_unavailability_periods u JOIN lawyer_profiles p ON p.id=u.lawyer_profile_id WHERE p.user_id=$1 AND u.starts_at::timestamptz<$3 AND u.ends_at::timestamptz>$2
    UNION ALL SELECT 1 FROM practice_calendar_busy b JOIN practice_calendar_connections c ON c.id=b.connection_id WHERE c.user_id=$1 AND b.starts_at<$3 AND b.ends_at>$2 AND NOT(b.connection_id IS NOT DISTINCT FROM $5 AND b.google_id IS NOT DISTINCT FROM $6) LIMIT 1`,
      [
        organizerId,
        start,
        end,
        except ?? null,
        connectionId ?? null,
        googleId ?? null,
        except?.startsWith("juro:") ? except.slice(5) : null,
      ],
    )
  ).rows[0];
  if (overlap) throw new PracticeError("SLOT_UNAVAILABLE", 409);
}
export async function calendarCommand(
  client: PoolClient,
  actor: Actor,
  command: Command,
): Promise<object | undefined> {
  if (command.action === "event.save") {
    await requireCase(client, actor, command.caseId);
    if (actor.role !== "client" && !isLegal(actor))
      throw new PracticeError("ACCESS_DENIED", 403);
    await memberAllowed(client, actor, command.organizerUserId);
    if (
      Date.parse(command.endsAt) <= Date.parse(command.startsAt) ||
      Date.parse(command.endsAt) - Date.parse(command.startsAt) > 86400000 ||
      (actor.role === "client" && Date.parse(command.startsAt) <= Date.now())
    )
      throw new PracticeError("INVALID_EVENT_TIME");
    try {
      new Intl.DateTimeFormat("en", { timeZone: command.timezone });
    } catch {
      throw new PracticeError("INVALID_TIMEZONE");
    }
    const assigned = (
      await client.query(
        `SELECT 1 FROM practice_assignments WHERE case_id=$1 AND user_id=$2`,
        [command.caseId, command.organizerUserId],
      )
    ).rows[0];
    if (!assigned) throw new PracticeError("MEMBER_UNAVAILABLE");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `practice-calendar:${command.organizerUserId}`,
    ]);
    await available(
      client,
      command.organizerUserId,
      command.startsAt,
      command.endsAt,
      command.eventId,
    );
    if (command.eventId?.startsWith("juro:"))
      return updateJuroConsultation(
        client,
        actor,
        command.eventId.slice(5),
        "update",
        {
          start: command.startsAt,
          end: command.endsAt,
          timezone: command.timezone,
          caseId: command.caseId,
          organizerUserId: command.organizerUserId,
        },
      );
    if (command.eventId) {
      const updated = await client.query(
        `UPDATE practice_events SET starts_at=$4,ends_at=$5,timezone=$6,title=$7,client_visible=$8,revision=revision+1,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND case_id=$3 AND organizer_user_id=$9 AND ($10::text<>'client' OR client_visible) RETURNING id`,
        [
          command.eventId,
          actor.workspaceId,
          command.caseId,
          command.startsAt,
          command.endsAt,
          command.timezone,
          command.title,
          actor.role === "client" || command.clientVisible,
          command.organizerUserId,
          actor.role,
        ],
      );
      if (!updated.rowCount) throw new PracticeError("NOT_FOUND", 404);
    } else
      await client.query(
        `INSERT INTO practice_events(id,workspace_id,case_id,organizer_user_id,starts_at,ends_at,timezone,title,client_visible) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          crypto.randomUUID(),
          actor.workspaceId,
          command.caseId,
          command.organizerUserId,
          command.startsAt,
          command.endsAt,
          command.timezone,
          command.title,
          actor.role === "client" || command.clientVisible,
        ],
      );
    await audit(
      client,
      actor,
      "event",
      command.eventId ?? command.caseId,
      command.action,
    );
    return { ok: true };
  }
  if (command.action === "event.cancel") {
    if (command.eventId.startsWith("juro:"))
      return updateJuroConsultation(
        client,
        actor,
        command.eventId.slice(5),
        "cancel",
      );
    const event = (
      await client.query(
        `SELECT * FROM practice_events WHERE workspace_id=$1 AND id=$2`,
        [actor.workspaceId, command.eventId],
      )
    ).rows[0];
    if (!event) throw new PracticeError("NOT_FOUND", 404);
    await requireCase(client, actor, event.case_id);
    if (actor.role === "client" && !event.client_visible)
      throw new PracticeError("ACCESS_DENIED", 403);
    await client.query(
      `UPDATE practice_events SET status='cancelled',revision=revision+1,updated_at=now() WHERE id=$1`,
      [event.id],
    );
    await audit(client, actor, "event", event.id, command.action);
    return { ok: true };
  }
  if (command.action === "event.confirm")
    return updateJuroConsultation(
      client,
      actor,
      command.eventId.replace(/^juro:/, ""),
      "confirm",
    );
}
