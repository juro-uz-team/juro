import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { setTimeout as pause } from "node:timers/promises";
import { parseEnv } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") throw new Error("Install these private services on the Linux server");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (/[\r\n]/.test(root)) throw new Error("Unsupported service path");
const environment = resolve(root, ".env.self-hosted");
await access(environment);
const directory = resolve(homedir(), ".config/systemd/user");
await mkdir(directory, { recursive: true });
const quote = value => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
const production = process.argv.includes("--production");
const services = [
  ["platform", "apps/platform", "server/index.ts"],
  ["jobs", "apps/platform", "server/jobs.ts"],
  ["source-observer", "apps/platform", "server/source-observer.ts"],
  ["website", "apps/website", "server/index.ts"],
  ["admin", "apps/admin", "src/server.ts"],
];
for (const [name, path, entry] of services) {
  const unit = `[Unit]
Description=JURO private self-hosted ${name}
After=network.target

[Service]
Type=simple
WorkingDirectory=${resolve(root, path).replaceAll("%", "%%")}
ExecStart=${quote(process.execPath)} ${quote(resolve(root, "scripts/with-private-env.mjs"))} --import ${quote(resolve(root, "apps/platform/node_modules/tsx/dist/loader.mjs"))} ${entry}
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=NODE_ENV=${production ? "production" : "development"}
Restart=on-failure
RestartSec=5
TimeoutStopSec=180
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
`;
  await writeFile(resolve(directory, `juro-self-hosted-${name}.service`), unit, { mode: 0o600 });
}
execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
execFileSync("systemd-analyze", ["--user", "verify", ...services.map(([name]) => resolve(directory, `juro-self-hosted-${name}.service`))], { stdio: "inherit" });
execFileSync("systemctl", ["--user", "enable", ...services.map(([name]) => `juro-self-hosted-${name}.service`)], { stdio: "inherit" });
execFileSync("systemctl", ["--user", "restart", ...services.map(([name]) => `juro-self-hosted-${name}.service`)], { stdio: "inherit" });
for (const [name] of services) execFileSync("systemctl", ["--user", "is-active", `juro-self-hosted-${name}.service`], { stdio: "inherit" });
const configuration = parseEnv(await readFile(environment, "utf8"));
for (const [name, port, path] of [
  ["platform", configuration.PORT ?? 3000, "/robots.txt"],
  ["website", configuration.WEBSITE_PORT ?? 3001, "/robots.txt"],
  ["admin", configuration.ADMIN_PORT ?? 3002, "/"],
]) {
  let ready = false;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}${path}`, { redirect: "manual", signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.status >= 200 && response.status < 400) { ready = true; break; }
    } catch { /* The newly started HTTP listener may not be ready yet. */ }
    await pause(500);
  }
  if (!ready) throw new Error(`${name} did not become HTTP-ready; inspect its user service journal`);
}
console.log(`Installed private ${production ? "production" : "development"} services from ${root}`);
