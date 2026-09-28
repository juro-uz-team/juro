import { randomUUID } from "node:crypto";
import { database } from "../storage/connection";
import { getSelfHostedRuntime } from "./self-hosted";

/** Use the configured delivery transport without changing caller retry/idempotency semantics. */
export async function sendEmailRequest(init: RequestInit): Promise<Response> {
  const delivery = getSelfHostedRuntime().EMAIL_DELIVERY;
  if (!delivery) throw new Error("Email delivery is unavailable");
  return delivery.fetch("https://api.resend.com/emails", init);
}

async function capture(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (process.env.PRIVATE_DEVELOPMENT !== "true" && process.env.DEPLOYMENT_ENVIRONMENT !== "staging") throw new Error("Email capture requires a private or staging deployment");
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
