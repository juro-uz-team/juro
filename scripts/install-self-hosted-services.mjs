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
const environmentIndex = process.argv.indexOf("--environment");
const deploymentEnvironment = environmentIndex >= 0 ? process.argv[environmentIndex + 1] : null;
if (environmentIndex >= 0 && !["staging", "production"].includes(deploymentEnvironment)) throw new Error("Invalid deployment environment");
const unitPrefix = deploymentEnvironment ? `juro-${deploymentEnvironment}` : "juro-self-hosted";
const configuration = parseEnv(await readFile(environment, "utf8"));
if (deploymentEnvironment && configuration.DEPLOYMENT_ENVIRONMENT !== deploymentEnvironment) throw new Error("Deployment environment mismatch");
const services = [
  ["platform", "apps/platform", "server/index.ts"],
  ["jobs", "apps/platform", "server/jobs.ts"],
  ["source-observer", "apps/platform", "server/source-observer.ts"],
  ["website", "apps/website", "server/index.ts"],
  ["admin", "apps/admin", "src/server.ts"],
];
if (configuration.PRIVATE_DEVELOPMENT !== "true") {
  if (configuration.LAWYER_URL) services.push(["lawyer", "apps/platform", "server/index.ts"]);
  if (configuration.STATUS_URL) services.push(["status", "apps/platform", "server/index.ts"]);
}
for (const [name, path, entry] of services) {
  const unit = `[Unit]
Description=JURO ${deploymentEnvironment ?? "private self-hosted"} ${name}
After=network.target

[Service]
Type=simple
WorkingDirectory=${resolve(root, path).replaceAll("%", "%%")}
ExecStart=${quote(process.execPath)} ${quote(resolve(root, "scripts/with-private-env.mjs"))} --import ${quote(resolve(root, "apps/platform/node_modules/tsx/dist/loader.mjs"))} ${entry}
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=NODE_ENV=${production ? "production" : "development"}
Environment=PLATFORM_HOST_ROLE=${["lawyer", "status"].includes(name) ? name : "app"}
Restart=on-failure
RestartSec=5
TimeoutStopSec=180
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
`;
  await writeFile(resolve(directory, `${unitPrefix}-${name}.service`), unit, { mode: 0o600 });
}
execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
execFileSync("systemd-analyze", ["--user", "verify", ...services.map(([name]) => resolve(directory, `${unitPrefix}-${name}.service`))], { stdio: "inherit" });
execFileSync("systemctl", ["--user", "enable", ...services.map(([name]) => `${unitPrefix}-${name}.service`)], { stdio: "inherit" });
execFileSync("systemctl", ["--user", "restart", ...services.map(([name]) => `${unitPrefix}-${name}.service`)], { stdio: "inherit" });
for (const [name] of services) execFileSync("systemctl", ["--user", "is-active", `${unitPrefix}-${name}.service`], { stdio: "inherit" });
for (const [name, port, path] of [
  ["platform", configuration.PORT ?? 3000, "/robots.txt"],
  ["website", configuration.WEBSITE_PORT ?? 3001, "/robots.txt"],
  ["admin", configuration.ADMIN_PORT ?? 3002, "/"],
  ...(services.some(([name]) => name === "lawyer") ? [["lawyer", configuration.LAWYER_PORT ?? 3003, "/favicon.png"]] : []),
  ...(services.some(([name]) => name === "status") ? [["status", configuration.STATUS_PORT ?? 3004, "/favicon.png"]] : []),
]) {
  let ready = false;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const publicOrigin = name === "platform" ? configuration.APP_URL : name === "lawyer" ? configuration.LAWYER_URL : name === "status" ? configuration.STATUS_URL : configuration.PUBLIC_SITE_URL;
      const headers = configuration.PRIVATE_DEVELOPMENT !== "true" && name !== "admin"
        ? { host: new URL(publicOrigin).host, "x-real-ip": "127.0.0.1" } : {};
      const response = await fetch(`http://localhost:${port}${path}`, { headers, redirect: "manual", signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.status >= 200 && response.status < 400) { ready = true; break; }
    } catch { /* The newly started HTTP listener may not be ready yet. */ }
    await pause(500);
  }
  if (!ready) throw new Error(`${name} did not become HTTP-ready; inspect its user service journal`);
}
console.log(`Installed ${deploymentEnvironment ?? "private"} ${production ? "production" : "development"} services from ${root}`);
