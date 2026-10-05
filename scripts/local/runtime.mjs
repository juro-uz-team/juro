import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 25000).unref();
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
function run(command, args, cwd = "/workspace", persistent = false) {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  children.add(child);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => {
      children.delete(child);
      if (persistent && !stopping) stop(code || 1);
      if (code && !stopping) reject(new Error(`${command} exited with ${code}`));
      else resolve();
    });
  });
}
try {
  for (const app of ["platform", "website"]) {
    const directory = `/workspace/apps/${app}`;
    const marker = `${directory}/node_modules/.juro-lock-hash`;
    const hash = createHash("sha256").update(await readFile(`${directory}/package-lock.json`)).digest("hex");
    if (await readFile(marker, "utf8").catch(() => "") !== hash) {
      await run("npm", ["ci", "--no-audit", "--no-fund"], directory);
      await writeFile(marker, hash);
    }
  }
  await mkdir("/data/objects", { recursive: true });
  await run("npm", ["run", "db:migrate"], "/workspace/apps/platform");
  // Native servers continue to accept loopback peers only. These container-local
  // TCP relays expose them through Docker's host-loopback-only published ports.
  for (const port of [3000, 3001, 3002]) {
    void run("socat", [`TCP-LISTEN:${port + 100},bind=0.0.0.0,reuseaddr,fork`, `TCP:127.0.0.1:${port}`], undefined, true).catch(error => { console.error(error.message); stop(1); });
  }
  const services = [["platform", "dev"], ["platform", "jobs"], ["website", "dev"], ["admin", "dev"]];
  for (const [app, command] of services) {
    void run("npm", ["run", command], `/workspace/apps/${app}`, true).catch(error => { console.error(error.message); stop(1); });
  }
  // Scans fail closed until the official signatures are available.
  const refresh = () => run("freshclam", ["--stdout"]).catch(error => console.error(`Signature update: ${error.message}`));
  await refresh();
  setInterval(() => void refresh(), 6 * 60 * 60 * 1000).unref();
} catch (error) {
  console.error(error.message);
  stop(1);
}
