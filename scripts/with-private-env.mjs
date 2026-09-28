import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { publicBuildOrigins } from "./public-build-origins.mjs";

try { loadEnvFile(fileURLToPath(new URL("../.env.self-hosted", import.meta.url))); }
catch (error) { if (error.code !== "ENOENT") throw error; }
Object.assign(process.env, publicBuildOrigins(process.env));
const args = process.argv.slice(2);
if (args[0] === "--production") { args.shift(); process.env.NODE_ENV = "production"; }
if (!args.length) throw new Error("A Node entry point is required");
// Next forwards execArgv to build workers through NODE_OPTIONS, which rejects --env-file.
const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
