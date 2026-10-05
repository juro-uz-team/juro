import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

test("local login isolates personas, preserves repeat logins, and rejects non-local access", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const state = {
    enabled: true, db: d1,
    async profile(input: { email: string; fullName: string }) {
      const existing = sqlite.prepare("SELECT id,full_name AS fullName FROM user_profiles WHERE email=?").get(input.email);
      if (existing) return existing;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      sqlite.prepare("INSERT INTO user_profiles(id,email,full_name,created_at,updated_at) VALUES (?,?,?,?,?)")
        .run(id, input.email, input.fullName, now, now);
      return { id, fullName: input.fullName };
    },
  };
  const key = `development-login-${crypto.randomUUID()}`;
  Object.assign(globalThis, { [key]: state });
  try {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../app/api/auth/dev-login/route.ts", import.meta.url))],
      bundle: true, write: false, platform: "node", format: "esm",
      plugins: [{ name: "login-boundaries", setup(builder) {
        builder.onResolve({ filter: /lib\// }, args => ({ path: args.path, namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
          const contents = args.path.endsWith("/crypto") ? "export const normalizeEmail=v=>v.trim().toLowerCase();"
            : args.path.endsWith("/development-auth") ? "export const localDevelopmentAuthEnabled=()=>state.enabled;"
            : args.path.endsWith("/session-management") ? "export const createLocalDevelopmentSession=async(db,{userId})=>({token:userId});"
            : args.path.endsWith("/session") ? "export const sessionCookie=t=>'session='+t; export const clearLogoutPendingCookie=()=> 'logout=; Max-Age=0';"
            : args.path.endsWith("/db") ? "export const getOrCreateUserProfile=input=>state.profile(input);"
            : "export const requireD1=()=>state.db; export const runtimeEnv=()=>({});";
          return { contents: `const state=globalThis[${JSON.stringify(key)}];` + contents, loader: "js" };
        });
      } }],
    });
    const { GET } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
    const login = (query: string, host = "localhost"): Promise<Response> => GET(new Request(`http://${host}/api/auth/dev-login?${query}`));
    assert.equal((await login("accountType=lawyer", "example.com")).status, 404);
    state.enabled = false;
    assert.equal((await login("accountType=lawyer")).status, 404);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM user_profiles").get()?.total, 0);
    state.enabled = true;
    assert.equal((await login("accountType=admin")).status, 400);
    const personal = await login("accountType=individual");
    const lawyer = await login("returnTo=/en/lawyer/dashboard");
    assert.equal(personal.headers.get("location"), "/ru/individual/dashboard");
    assert.equal(lawyer.headers.get("location"), "/en/lawyer/dashboard");
    assert.notEqual(personal.headers.get("set-cookie"), lawyer.headers.get("set-cookie"));
    assert.equal((await login("accountType=lawyer&returnTo=https://example.com")).headers.get("location"), "/ru/lawyer/dashboard");
    assert.equal((await login("accountType=individual")).headers.get("set-cookie"), personal.headers.get("set-cookie"));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM user_profiles").get()?.total, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM lawyer_profiles").get()?.total, 1);
    const approval = sqlite.prepare("SELECT status,marketplace_status FROM lawyer_profiles").get();
    assert.equal(approval?.status, "public_approved");
    assert.equal(approval?.marketplace_status, "public_approved");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM user_profiles WHERE onboarding_completed_at IS NULL").get()?.total, 0);
  } finally {
    Reflect.deleteProperty(globalThis, key);
    sqlite.close();
  }
});
