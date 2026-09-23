import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
let configuration = {};
try { configuration = parseEnv(await readFile(new URL("../../../.env.self-hosted", import.meta.url), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const environment = Object.fromEntries(["PATH", "SystemRoot", "TEMP", "TMP", "LANG", "HOME"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(environment, { NODE_ENV: "test", NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: process.env.DATABASE_URL ?? configuration.DATABASE_URL ?? "" });
const requested = process.argv.slice(2);
const files = requested.length ? requested : (await readdir(new URL("../tests/", import.meta.url)))
  .filter(file => /\.test\.(?:ts|mjs)$/.test(file)).sort().map(file => `tests/${file}`);
const child = spawn(process.execPath, ["--import", "tsx", "--import", "./tests/helpers/runtime-env.ts", "--test", "--test-concurrency=2", ...files],
  { cwd: project, env: environment, stdio: "inherit" });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
