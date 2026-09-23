import { randomUUID } from "node:crypto";
import { database } from "../storage/connection";
import { getSelfHostedRuntime } from "./self-hosted";

/** Capture complete messages locally so verification flows work without external delivery. */
export async function captureEmailRequest(init: RequestInit): Promise<Response> {
  const delivery = getSelfHostedRuntime().EMAIL_DELIVERY;
  if (!delivery) throw new Error("Local email capture is unavailable");
  return delivery.fetch("http://captured-email.local/emails", init);
}

async function capture(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (process.env.PRIVATE_DEVELOPMENT !== "true") throw new Error("External email delivery is disabled");
  const request = new Request(input, init);
  const headers = request.headers;
  const key = headers.get("idempotency-key") ?? randomUUID();
  const message: unknown = await request.json();
  if (!message || typeof message !== "object") throw new Error("Invalid email message");
  const result = await database().pool.query(`INSERT INTO storage.captured_emails(id,idempotency_key,message)
    VALUES($1,$2,$3::jsonb) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING id`,
  [randomUUID(), key, JSON.stringify(message)]);
  return Response.json({ id: result.rows[0].id });
}

export const localEmailCapture = { fetch: capture };
