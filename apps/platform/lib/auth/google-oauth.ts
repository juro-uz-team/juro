import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { normalizeEmail, randomToken } from "./crypto";
import { safeAuthReturnPath } from "./return-path";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 5000 });
const callbackPath = "/api/auth/google/callback";
const flowLifetime = 600;
const proofLifetime = 900;
const flowCookie = "__Host-juro_google_flow";
const proofCookie = "__Host-juro_google_proof";

export const googleStartInput = z.object({
  locale: z.enum(["ru", "uz", "en"]),
  mode: z.enum(["login", "register"]),
  accountType: z.enum(["individual", "entrepreneur", "lawyer"]).default("individual"),
  rememberMe: z.boolean().default(false),
  returnTo: z.string().max(2048).optional().transform(path => safeAuthReturnPath(path) ?? undefined),
});
export type GoogleStartInput = z.output<typeof googleStartInput>;
const flowSchema = z.object({
  request: googleStartInput,
  state: z.string().length(43),
  nonce: z.string().length(43),
  verifier: z.string().length(43),
  expires: z.number(),
});
const proofSchema = z.object({
  request: googleStartInput,
  token: z.string().length(43),
  subjectHash: z.string().length(64),
  email: z.email().max(254),
  name: z.string().max(160),
  kind: z.enum(["login", "signup", "link"]),
  expires: z.number(),
});
export type GoogleProof = z.output<typeof proofSchema>;
type Flow = z.output<typeof flowSchema>;

export function googleOAuthConfig() {
  const { GOOGLE_AUTH_CLIENT_ID: clientId, GOOGLE_AUTH_CLIENT_SECRET: secret, APP_URL } = process.env;
  if (!clientId || !secret || !APP_URL) return null;
  try {
    const origin = new URL(APP_URL).origin;
    if (!origin.startsWith("https://")) return null;
    return { clientId, secret, origin, redirectUri: origin + callbackPath };
  } catch {
    return null;
  }
}

export type GoogleConfig = NonNullable<ReturnType<typeof googleOAuthConfig>>;

function cookieKey(config: GoogleConfig) {
  return createHash("sha256").update("juro-google-oauth-v1").update("\0").update(config.secret).digest();
}

function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function writeCookie(config: GoogleConfig, name: string, value: unknown, maxAge: number) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cookieKey(config), iv);
  cipher.setAAD(Buffer.from(name));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return cookie(name, Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url"), maxAge);
}

function readCookie(config: GoogleConfig, raw: string | null, name: string): unknown {
  const prefix = name + "=";
  const matches = raw?.split(";").map(part => part.trim()).filter(part => part.startsWith(prefix));
  if (!matches || matches.length !== 1) return null;
  const encoded = matches[0].slice(prefix.length);
  if (!/^[A-Za-z0-9_-]{39,4000}$/u.test(encoded)) return null;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", cookieKey(config), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

export const clearGoogleFlow = () => cookie(flowCookie, "", 0);
export const clearGoogleProof = () => cookie(proofCookie, "", 0);

export function startGoogleOAuth(config: GoogleConfig, request: GoogleStartInput) {
  const flow: Flow = {
    request,
    state: randomToken(32),
    nonce: randomToken(32),
    verifier: randomToken(32),
    expires: Date.now() + flowLifetime * 1000,
  };
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
    hl: request.locale,
  }).toString();
  return { url: url.href, cookie: writeCookie(config, flowCookie, flow, flowLifetime) };
}

export function readGoogleFlow(config: GoogleConfig, raw: string | null) {
  const flow = flowSchema.safeParse(readCookie(config, raw, flowCookie));
  return flow.success && flow.data.expires > Date.now() ? flow.data : null;
}

export function readGoogleProof(config: GoogleConfig, raw: string | null) {
  const proof = proofSchema.safeParse(readCookie(config, raw, proofCookie));
  return proof.success && proof.data.expires > Date.now() ? proof.data : null;
}

export function issueGoogleProof(config: GoogleConfig, proof: Omit<GoogleProof, "expires" | "token">) {
  const value = { ...proof, expires: Date.now() + proofLifetime * 1000, token: randomToken(32) };
  return { value, cookie: writeCookie(config, proofCookie, value, proofLifetime) };
}

export async function exchangeGoogleCode(config: GoogleConfig, flow: Flow, code: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.secret,
      code_verifier: flow.verifier,
      code,
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("GOOGLE_TOKEN_EXCHANGE_FAILED");
  const result = z.object({ id_token: z.string().max(12_000) }).parse(await response.json());
  const { payload } = await jwtVerify(result.id_token, googleKeys, {
    algorithms: ["RS256"],
    audience: config.clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    requiredClaims: ["exp", "iat", "sub", "nonce", "email", "email_verified"],
    maxTokenAge: "10 minutes",
    clockTolerance: 30,
  });
  return googleIdentity(payload, flow.nonce, config.clientId);
}

export function googleIdentity(payload: Record<string, unknown>, nonce: string, clientId: string) {
  const parsed = z.object({
    nonce: z.literal(nonce),
    azp: z.literal(clientId).optional(),
    sub: z.string().regex(/^[!-~]{1,255}$/u),
    email: z.email().max(254),
    email_verified: z.union([z.literal(true), z.literal("true")]),
    name: z.string().optional(),
    hd: z.string().min(1).optional(),
  }).parse(payload);
  const email = normalizeEmail(parsed.email);
  return {
    email,
    subjectHash: createHash("sha256").update(parsed.sub).digest("hex"),
    name: (parsed.name ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 160),
    ownsEmail: Boolean(parsed.hd) || email.endsWith("@gmail.com"),
  };
}
