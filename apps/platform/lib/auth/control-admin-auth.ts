import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { database } from "../storage/connection";
import { randomToken, sha256 } from "./crypto";
import { renderJuroAuthEmail, sendJuroAuthEmail } from "./transactional-email";
import { createIdentityProtectionContext, userIdByEmail } from "./identity-protection";

export const adminEmail = () => (process.env.ADMIN_ALLOWED_EMAIL ?? "muzaffarbekmurodov@gmail.com").trim().toLowerCase();
const bounded = (key: string, fallback: number, max: number) => Math.min(max, Math.max(1, Number(process.env[key]) || fallback));
const secret = () => {
 const value = process.env.ADMIN_OTP_SECRET;
 if (!value || value.length < 32) throw Error("ADMIN_OTP_SECRET_UNAVAILABLE");
 return value;
};
const hashCode = (id: string, code: string) => createHmac("sha256", secret()).update(`${id}:${code}`).digest("hex");
export async function controlAudit(email: string, action: string, entityType?: string, entityId?: string, metadata: object = {}) {
 await database().pool.query("INSERT INTO control_admin_audit(id,actor_email,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)",
 [crypto.randomUUID(), email, action, entityType ?? null, entityId ?? null, JSON.stringify(metadata)]);
}
async function rate(key: string, limit: number, seconds: number) {
 const result = await database().pool.query(`INSERT INTO control_admin_rate_limits(key,window_start,count) VALUES($1,now(),1)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN control_admin_rate_limits.window_start < now()-$2*interval '1 second' THEN 1 ELSE control_admin_rate_limits.count+1 END,
 window_start=CASE WHEN control_admin_rate_limits.window_start < now()-$2*interval '1 second' THEN now() ELSE control_admin_rate_limits.window_start END RETURNING count`, [key,seconds]);
 return result.rows[0].count <= limit;
}
export async function requestAdminCode(emailInput: string, ip: string, delivery: {apiKey: string; from: string}) {
 const email = emailInput.trim().toLowerCase();
 const challengeId = crypto.randomUUID();
 const ipKey = createHmac("sha256",secret()).update(ip).digest("hex");
 const permitted = await rate(`request:${ipKey}`, 10, 3600);
 // The reply is identical for unknown addresses and throttled requests.
 if (!permitted || email !== adminEmail()) return {challengeId};
 const client = await database().pool.connect();
 let code = "";
 try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`control-admin:${email}`]);
  const recent = await client.query("SELECT 1 FROM control_admin_challenges WHERE email=$1 AND created_at > now()-$2*interval '1 second' LIMIT 1", [email,bounded("ADMIN_OTP_RESEND_SECONDS",60,3600)]);
  if (recent.rowCount) { await client.query("ROLLBACK"); return {challengeId}; }
  if (!await rate(`email:${email}`,5,3600)) {await client.query("ROLLBACK"); return {challengeId};}
  code = String(randomInt(0,1_000_000)).padStart(6,"0");
  await client.query("UPDATE control_admin_challenges SET consumed_at=now() WHERE email=$1 AND consumed_at IS NULL",[email]);
  await client.query("INSERT INTO control_admin_challenges(id,email,code_hash,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 second')",[challengeId,email,hashCode(challengeId,code),bounded("ADMIN_OTP_TTL_SECONDS",300,900)]);
  await client.query("COMMIT");
 } catch (error) {await client.query("ROLLBACK"); throw error;} finally {client.release();}
 const message = renderJuroAuthEmail({locale:"ru",purpose:"admin_login",code,expirySeconds:bounded("ADMIN_OTP_TTL_SECONDS",300,900),details:[{label:"Вход",value:"JURO Control Center"},{label:"Срок действия",value:`${bounded("ADMIN_OTP_TTL_SECONDS",300,900)} секунд. Не передавайте код другим лицам.`}]});
 const sent = await sendJuroAuthEmail({...delivery,to:email,idempotencyKey:`control-login:${challengeId}`,message});
 if (!sent.ok) {
  await database().pool.query("UPDATE control_admin_challenges SET consumed_at=now() WHERE id=$1",[challengeId]);
  await controlAudit(email,"login_email_delivery_failed");
 }
 return {challengeId};
}
export async function verifyAdminCode(id: string, code: string, ip: string) {
 const ipKey = createHmac("sha256",secret()).update(ip).digest("hex");
 if (!await rate(`verify:${ipKey}`,30,900)) return null;
 const client = await database().pool.connect();
 try {
  await client.query("BEGIN");
  const result = await client.query("SELECT * FROM control_admin_challenges WHERE id=$1 FOR UPDATE",[id]);
  const row = result.rows[0];
  if (!row || row.email !== adminEmail() || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now() || row.attempts >= bounded("ADMIN_OTP_MAX_ATTEMPTS",5,5)) {await client.query("ROLLBACK"); return null;}
  await client.query("UPDATE control_admin_challenges SET attempts=attempts+1 WHERE id=$1",[id]);
  const expected = Buffer.from(row.code_hash,"hex");
  const actual = Buffer.from(hashCode(id,code),"hex");
  if (!/^\d{6}$/.test(code) || !timingSafeEqual(expected,actual)) {await client.query("COMMIT"); return null;}
  const token = randomToken(); const csrfToken = randomToken();
  const expiresAt = new Date(Date.now()+bounded("ADMIN_SESSION_TTL_SECONDS",3600,28800)*1000).toISOString();
  const sessionId = crypto.randomUUID();
  await client.query("UPDATE control_admin_challenges SET consumed_at=now() WHERE id=$1",[id]);
  await client.query("INSERT INTO control_admin_sessions(id,email,token_hash,expires_at) VALUES($1,$2,$3,$4)",[sessionId,row.email,await sha256(token),expiresAt]);
  await client.query("INSERT INTO control_admin_audit(id,actor_email,action,entity_type,entity_id) VALUES($1,$2,'login','admin_session',$3)",[crypto.randomUUID(),row.email,sessionId]);
  await client.query("COMMIT");
  return {token,csrfToken,expiresAt,roles:["super_admin"]};
 } catch(error) {await client.query("ROLLBACK"); throw error;} finally {client.release();}
}
export async function controlPrincipal(token: string | null) {
 if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
 const result = await database().pool.query("SELECT id,email,expires_at FROM control_admin_sessions WHERE token_hash=$1 AND email=$2 AND revoked_at IS NULL AND expires_at>now()",[await sha256(token),adminEmail()]);
 const row = result.rows[0];
 if (!row) return null;
 const context = createIdentityProtectionContext(process.env.IDENTITY_PROTECTION_MODE,process.env.IDENTITY_KEYRING);
 const userId = await userIdByEmail(database() as unknown as D1Database,context,row.email);
 return {sessionId:row.id as string, email:row.email as string, userId, expiresAt:new Date(row.expires_at).toISOString(), roles:["super_admin"] as const};
}
export async function revokeControlSession(token: string) {
 await database().pool.query("UPDATE control_admin_sessions SET revoked_at=now() WHERE token_hash=$1",[await sha256(token)]);
}
