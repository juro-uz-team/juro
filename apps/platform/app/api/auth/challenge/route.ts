import { createHash } from "node:crypto";
import { challengeSecretConfigured, issueNativeChallenge, nativeChallengeActions } from "../../../../lib/auth/native-challenge";

export const dynamic = "force-dynamic";
// Bounded generation budget; account actions also retain their durable rate limits.
const requests = new Map<string, { count: number; until: number }>();
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.AUTH_CHALLENGE_SECRET;
  if (process.env.PRIVATE_DEVELOPMENT === "true" || !challengeSecretConfigured(secret)) return new Response(null, { status: 503, headers });
  const url = new URL(request.url);
  const origin = new URL(process.env.APP_URL!);
  const action = url.searchParams.get("action") ?? "";
  if (url.hostname !== origin.hostname || !(nativeChallengeActions as readonly string[]).includes(action)) return new Response(null, { status: 400, headers });
  const ip = request.headers.get("x-juro-client-ip");
  if (!ip) return new Response(null, { status: 400, headers });
  const now = Date.now();
  for (const [key, value] of requests) if (value.until <= now) requests.delete(key);
  const key = createHash("sha256").update(ip).digest("hex");
  const entry = requests.get(key) ?? { count: 0, until: now + 60_000 };
  if (entry.count >= 30 || (!requests.has(key) && requests.size >= 10_000)) return new Response(null, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  entry.count++; requests.set(key, entry);
  return Response.json(await issueNativeChallenge(secret, origin.hostname, action), { headers });
}
