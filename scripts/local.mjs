import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, access, cp } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { startHost, stopHost, hostRequest, hostLogs, hostEnvironment } from "./local/host.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const environmentPath = new URL("../.env.self-hosted", import.meta.url);
const action = process.argv[2] || "up";
if (!["up", "down", "logs", "status", "mail"].includes(action)) throw new Error("Use up, down, logs, status or mail");

async function configure() {
  let contents = await readFile(environmentPath, "utf8").catch(error => {
    if (error.code !== "ENOENT") throw error;
    return "# Private local JURO configuration. Never commit this file.\n";
  });
  const existing = parseEnv(contents);
  const values = {};
  const token = () => randomBytes(32).toString("hex");
  if (!existing.POSTGRES_PASSWORD) values.POSTGRES_PASSWORD = token();
  const password = existing.POSTGRES_PASSWORD || values.POSTGRES_PASSWORD;
  if (!/^[A-Za-z0-9_-]+$/.test(password)) throw new Error("Local Compose requires a URL-safe POSTGRES_PASSWORD");
  if (!existing.DATABASE_URL) values.DATABASE_URL = `postgresql://juro:${password}@127.0.0.1:55432/juro`;
  if (!existing.IDENTITY_KEYRING) values.IDENTITY_KEYRING = JSON.stringify({ active: "local-v1", versions: { "local-v1": { aead: randomBytes(32).toString("base64url"), hmac: randomBytes(32).toString("base64url") } } });
  if (!existing.ADMIN_INTERNAL_TOKEN) values.ADMIN_INTERNAL_TOKEN = token();
  if (!existing.AUTH_CHALLENGE_SECRET) values.AUTH_CHALLENGE_SECRET = token();
  const defaults = { PRIVATE_DEVELOPMENT: "true", IDENTITY_PROTECTION_MODE: "dual_write", APP_URL: "http://localhost:3000", PUBLIC_SITE_URL: "http://localhost:3001", ADMIN_CONSOLE_ORIGIN: "http://localhost:3002", OBJECT_STORAGE_PATH: fileURLToPath(new URL("../.data/objects", import.meta.url)).replaceAll("\\", "/") };
  for (const [key, value] of Object.entries(defaults)) if (!existing[key]) values[key] = value;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}='${value}'`;
    const expression = new RegExp(`^${key}=.*$`, "m");
    contents = expression.test(contents) ? contents.replace(expression, () => line) : `${contents.trimEnd()}\n${line}\n`;
  }
  if (Object.keys(values).length) await writeFile(environmentPath, contents, { mode: 0o600 });
  await mkdir(new URL("../.data/objects", import.meta.url), { recursive: true });
  console.log("Local configuration ready; existing provider credentials preserved.");
}

const docker = process.platform === "win32" ? ["--context", "desktop-linux"] : [];
const compose = [...docker, "compose", "--env-file", ".env.self-hosted", "-f", "compose.yaml"];
const legacy = [...compose, "-f", "compose.local.yaml"];
function run(command, args, options = {}) {
  return new Promise((yes, no) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit", ...options });
    let output = "";
    child.stdout?.on("data", chunk => { output += chunk; });
    child.once("error", no);
    child.once("exit", code => code ? no(new Error(`${command} exited with ${code}`)) : yes(output.trim()));
  });
}
try {
  if (action === "up") {
    await configure();
    const oldContainer = await run("docker", [...legacy, "ps", "-a", "-q", "workspace"], { capture: true });
    if (oldContainer) {
      await run("docker", [...legacy, "stop", "workspace"]);
      // Immutable uploads stay available when moving off the Linux app container.
      const imported = resolve(root, ".data/local/docker-objects-imported");
      if (!await access(imported).then(() => true, () => false)) {
        const staging = resolve(root, ".data/local/docker-objects");
        await mkdir(staging, { recursive: true });
        await run("docker", [...docker, "cp", `${oldContainer}:/data/objects/.`, staging]);
        await cp(staging, resolve(root, ".data/objects"), { recursive: true, force: false, errorOnExist: false });
        await writeFile(imported, "Imported immutable files from the previous Docker workspace.\n");
      }
    }
    await run("docker", [...compose, "up", "-d", "--wait", "postgres"]);
    for (const app of ["platform", "website"]) {
      if (!await access(resolve(root, `apps/${app}/node_modules/next/package.json`)).then(() => true, () => false)) {
        const npm = process.env.npm_execpath ?? resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
        await run(process.execPath, [npm, "ci"], { cwd: resolve(root, `apps/${app}`) });
      }
    }
    const env = await hostEnvironment();
    await run(process.execPath, ["--import", new URL("../apps/platform/node_modules/tsx/dist/loader.mjs", import.meta.url).href, "scripts/migrate-postgres.mts"], { cwd: resolve(root, "apps/platform"), env });
    await startHost();
    console.log("Platform: http://localhost:3000\nWebsite: http://localhost:3001\nAdmin: http://localhost:3002\nOnly PostgreSQL runs in Docker. Logs: npm run local:logs");
  } else if (action === "down") {
    await stopHost();
    await run("docker", [...legacy, "stop"]);
  } else if (action === "logs") await hostLogs();
  else if (action === "status") {
    console.log("Host:", await hostRequest() ?? "stopped");
    await run("docker", [...compose, "ps"]);
  } else if (action === "mail") {
    await run("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "juro", "-d", "juro", "-P", "pager=off", "-c", "SELECT captured_at, message->>'to' AS recipient, message->>'subject' AS subject, coalesce(message->>'text',message->>'html') AS body FROM storage.captured_emails ORDER BY captured_at DESC LIMIT 5"]);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
