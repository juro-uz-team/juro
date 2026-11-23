import { clearGoogleFlow, clearGoogleProof, exchangeGoogleCode, googleOAuthConfig, issueGoogleProof, readGoogleFlow } from "../../../../../lib/auth/google-oauth";
import { existingGoogleEmailUserId, googleAccountUserId, storeGoogleProof } from "../../../../../lib/auth/google-accounts";
import { requireD1 } from "../../../../../lib/document-builder/storage/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = googleOAuthConfig();
  if (!config || url.origin !== config.origin) return new Response(null, { status: 404 });
  const flow = readGoogleFlow(config, request.headers.get("cookie"));
  const locale = flow?.request.locale ?? "en";

  function back(status: "cancelled" | "failed" | "email" | "continue", proof?: string) {
    const headers = new Headers({ "cache-control": "private, no-store", "referrer-policy": "no-referrer" });
    headers.append("set-cookie", clearGoogleFlow());
    headers.append("set-cookie", proof ?? clearGoogleProof());
    const destination = new URL(`/${locale}/auth/${status === "continue" ? "google" : flow?.request.mode ?? "login"}`, config!.origin);
    if (status !== "continue") {
      destination.searchParams.set("google", status);
      if (flow?.request.returnTo) destination.searchParams.set("returnTo", flow.request.returnTo);
      if (flow?.request.accountType) destination.searchParams.set("accountType", flow.request.accountType);
    }
    headers.set("location", destination.href);
    return new Response(null, { status: 303, headers });
  }

  const query = url.searchParams;
  if (!flow || query.getAll("state").length !== 1 || query.get("state") !== flow.state) return back("failed");
  if (query.get("error")) return back("cancelled");
  const code = query.get("code");
  if (!code || code.length > 2048 || query.getAll("code").length !== 1) return back("failed");
  try {
    const identity = await exchangeGoogleCode(config, flow, code);
    const db = requireD1();
    const linked = await googleAccountUserId(db, identity.subjectHash);
    const existing = linked ? null : await existingGoogleEmailUserId(db, identity.email);
    if (!linked && !existing && !identity.ownsEmail) return back("email");
    const proof = issueGoogleProof(config, {
      request: flow.request,
      subjectHash: identity.subjectHash,
      email: identity.email,
      name: identity.name,
      kind: linked ? "login" : existing ? "link" : "signup",
    });
    await storeGoogleProof(db, proof.value);
    return back("continue", proof.cookie);
  } catch {
    return back("failed");
  }
}
