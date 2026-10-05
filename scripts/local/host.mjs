import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as tcpServer, connect } from "node:net";
import { randomBytes } from "node:crypto";
import { open, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { setTimeout as pause } from "node:timers/promises";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = resolve(root, ".data/local");
const statePath = resolve(directory, "host.json");
const logPath = resolve(directory, "host.log");
export async function hostRequest(action = "status") {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const response = await fetch(`http://127.0.0.1:${state.port}/${action}`, {
      method: action === "stop" ? "POST" : "GET",
      headers: { authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error("Host control request failed");
    return await response.json();
  } catch { return null; }
}

export async function startHost() {
  if (await hostRequest()) { console.log("Host application processes are already running."); return; }
  await mkdir(directory, { recursive: true });
  // Refuse occupied ports instead of starting a partial stack.
  for (const port of [3000, 3001, 3002]) await new Promise((yes, no) => {
    const server = tcpServer();
    server.once("error", error => no(new Error(`Port ${port} unavailable (${error.code})`)));
    server.listen(port, "127.0.0.1", () => server.close(yes));
  });
  const log = await open(logPath, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], {
    cwd: root, detached: true, windowsHide: true, stdio: ["ignore", log.fd, log.fd],
  });
  await new Promise((yes, no) => { child.once("spawn", yes); child.once("error", no); });
  child.unref();
  await log.close();
  for (let attempt = 0; attempt < 240; attempt++) {
    if (await hostRequest() && await listenersReady()) { console.log("Host processes ready. Follow compilation with npm run local:logs."); return; }
    await pause(500);
  }
  await stopHost();
  throw new Error("Host startup failed; inspect .data/local/host.log");
}

async function listenersReady() {
  const results = await Promise.all([3000, 3001, 3002].map(port => new Promise(done => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = ready => { socket.destroy(); done(ready); };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  })));
  return results.every(Boolean);
}

export async function stopHost() {
  if (!await hostRequest()) return;
  if (!await hostRequest("stop")) throw new Error("Could not stop host processes");
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!await hostRequest()) return;
    await pause(500);
  }
  throw new Error("Host processes did not stop");
}

export async function hostLogs() {
  let position = Math.max(0, (await stat(logPath)).size - 16000);
  while (true) {
    const file = await open(logPath, "r");
    try {
      const size = (await file.stat()).size;
      if (size < position) position = 0;
      if (size > position) {
        const buffer = Buffer.alloc(Math.min(size - position, 65536));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
        process.stdout.write(buffer.subarray(0, bytesRead)); position += bytesRead;
      }
    } finally { await file.close(); }
    await pause(500);
  }
}

export async function hostEnvironment() {
  const saved = parseEnv(await readFile(resolve(root, ".env.self-hosted"), "utf8"));
  return { ...process.env, ...saved, NODE_ENV: "development", PRIVATE_DEVELOPMENT: "true",
    DATABASE_URL: `postgresql://juro:${saved.POSTGRES_PASSWORD}@127.0.0.1:55432/juro`,
    OBJECT_STORAGE_PATH: resolve(root, ".data/objects"),
    APP_URL: "http://localhost:3000", PUBLIC_SITE_URL: "http://localhost:3001", ADMIN_CONSOLE_ORIGIN: "http://localhost:3002",
    PORT: "3000", WEBSITE_PORT: "3001", ADMIN_PORT: "3002", PLATFORM_HOST_ROLE: "app",
    EMAIL_DELIVERY_MODE: "capture", LOCAL_AUTH_BYPASS: saved.LOCAL_AUTH_BYPASS ?? "true",
    LOCAL_WATCH_POLLING: "false", WATCHPACK_POLLING: "false", NEXT_TELEMETRY_DISABLED: "1",
    GIT_CEILING_DIRECTORIES: resolve(root, "apps"),
  };
}

if (process.argv[2] === "serve") {
  const environment = await hostEnvironment();
  const token = randomBytes(32).toString("hex");
  const children = new Set();
  let stopping = false;
  const control = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ running: !stopping, services: children.size }));
    if (request.url === "/stop" && request.method === "POST") void stop();
  });
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    await Promise.all([...children].map(child => new Promise(done => {
      child.once("exit", done);
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", done);
      } else child.kill("SIGTERM");
      setTimeout(done, 10000).unref();
    })));
    await rm(statePath, { force: true });
    control.close();
    process.exit(code);
  }
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  for (const [app, entry] of [["platform", "server/index.ts"], ["platform", "server/jobs.ts"], ["website", "server/index.ts"], ["admin", "src/server.ts"]]) {
    const child = spawn(process.execPath, ["--import", new URL("../../apps/platform/node_modules/tsx/dist/loader.mjs", import.meta.url).href, entry], {
      cwd: resolve(root, `apps/${app}`), env: environment, windowsHide: true, stdio: "inherit",
    });
    children.add(child);
    child.on("error", error => { console.error(`${app}: ${error.message}`); void stop(1); });
    child.on("exit", code => { children.delete(child); if (!stopping) { console.error(`${app} exited (${code})`); void stop(code || 1); } });
  }
  await new Promise(done => control.listen(0, "127.0.0.1", done));
  await writeFile(statePath, JSON.stringify({ port: control.address().port, token }), { mode: 0o600 });
  console.log(`Host development started ${new Date().toISOString()}`);
}
