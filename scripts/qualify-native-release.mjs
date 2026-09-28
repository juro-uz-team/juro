#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { setTimeout as pause } from "node:timers/promises";

const [environment, revision, directory, ...extra] = process.argv.slice(2);
if (!["production", "staging"].includes(environment) || !/^[a-f0-9]{40}$/.test(revision ?? "") || extra.length) throw Error("Invalid qualification request");
const release = await realpath(directory);
if (!release.startsWith(`/srv/juro/${environment}/releases/`)) throw Error("Qualification release is outside its environment");
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: release, encoding: "utf8" }).trim(), revision);
assert.equal((await readFile(join(release, "apps/platform/.next/BUILD_ID"), "utf8")).trim(), revision);
const settings = parseEnv(await readFile(`/etc/juro/${environment}.env`, "utf8"));
assert.equal(settings.DEPLOYMENT_ENVIRONMENT, environment);
const port = environment === "production" ? 3200 : 3300;
const temporary = { ...process.env, ...settings, NODE_ENV: "production", PORT: String(port), WEBSITE_PORT: String(port + 1),
  ADMIN_PORT: String(port + 2), LAWYER_PORT: String(port + 3), STATUS_PORT: String(port + 4),
  PLATFORM_INTERNAL_ORIGIN: `http://localhost:${port}` };
const services = [
  { name: "app", app: "platform", entry: "server/index.ts", port, host: new URL(settings.APP_URL).host, path: "/en/auth/login" },
  { name: "website", app: "website", entry: "server/index.ts", port: port + 1, host: new URL(settings.PUBLIC_SITE_URL).host, path: "/en" },
  { name: "admin", app: "admin", entry: "src/server.ts", port: port + 2, host: `localhost:${port + 2}`, path: "/" },
  { name: "status", app: "platform", entry: "server/index.ts", port: port + 4, host: new URL(settings.STATUS_URL).host, path: "/api/status" },
  ...(settings.LAWYER_URL ? [{ name: "lawyer", app: "platform", entry: "server/index.ts", port: port + 3, host: new URL(settings.LAWYER_URL).host, path: "/favicon.png" }] : []),
];
const evidence = join(release, ".scratch", "deployment");
await mkdir(evidence, { recursive: true, mode: 0o700 });
const log = await open(join(evidence, "qualification.log"), "w", 0o600);
const children = [];
const report = { complete: false, environment, revision, checks: [], providerDependentChecks: "deferred; no inference or email delivery requested" };
function probe(service, path = service.path, method = "GET", host = service.host) {
  return new Promise((resolve, reject) => {
    const call = request({ hostname: "127.0.0.1", port: service.port, path, method,
      headers: { host, "x-real-ip": "203.0.113.42" }, signal: AbortSignal.timeout(5000) }, response => {
      response.resume(); response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers }));
    });
    call.on("error", reject); call.end();
  });
}
try {
  for (const service of services) {
    const child = spawn(process.execPath, ["--import", join(release, "apps/platform/node_modules/tsx/dist/loader.mjs"), service.entry], {
      cwd: join(release, "apps", service.app), env: { ...temporary, PLATFORM_HOST_ROLE: ["lawyer", "status"].includes(service.name) ? service.name : "app" },
      stdio: ["ignore", log.fd, log.fd],
    });
    children.push(child);
    let startupError;
    child.on("error", error => { startupError = error; });
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (startupError || child.exitCode !== null || child.signalCode !== null) throw Error(`${service.name} exited during qualification`);
      try {
        const response = await probe(service);
        if (service.name === "admin" ? response.status === 303
          && response.headers.location === `${settings.APP_URL}/ru/admin/console?reason=admin-session` : response.status === 200) {
          ready = true; break;
        }
      } catch { /* Listener is still starting. */ }
      await pause(500);
    }
    assert.ok(ready, `${service.name} did not become ready`);
    report.checks.push(`${service.name} responds on its canonical host`);
    assert.equal((await probe(service, service.path, "GET", "untrusted.example")).status, service.app === "platform" ? 400 : 403);
    report.checks.push(`${service.name} rejects an unrelated Host`);
  }
  assert.equal((await probe(services[0], "/api/platform/profile")).status, 401);
  report.checks.push("private profile rejects unauthenticated access");
  const website = services.find(service => service.name === "website");
  assert.equal((await probe(website, "/en", "POST")).status, 405);
  report.checks.push("website rejects writes");
  const status = services.find(service => service.name === "status");
  assert.equal((await probe(status, "/api/status", "POST")).status, 405);
  assert.equal((await probe(status, "/api/platform/profile")).status, 404);
  report.checks.push("status origin rejects writes and application routes");
  report.complete = true;
} finally {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const closed = new Promise(resolve => child.once("exit", resolve));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.kill("SIGTERM");
    await closed; clearTimeout(timer);
  }
  await log.close();
  await writeFile(join(evidence, "qualification.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}
console.log(JSON.stringify(report));
