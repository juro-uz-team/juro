#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, lstat, mkdir, readFile, readlink, realpath, rename, rmdir, symlink } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseEnv } from "node:util";

process.umask(0o077);
if (process.platform !== "linux") throw new Error("Native deployment requires Linux");
const [environment, revision, ...extra] = process.argv.slice(2);
if (!["staging", "production"].includes(environment) || !/^[a-f0-9]{40}$/.test(revision ?? "") || extra.length) {
  throw new Error("Usage: juro-deploy staging|production GIT_SHA");
}
const branch = environment === "production" ? "main" : "staging";
const config = JSON.parse(await readFile(`/etc/juro/${environment}.json`, "utf8"));
const root = `/srv/juro/${environment}`;
if (config.root !== root || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(config.repository ?? "")) {
  throw new Error("Deployment requires its isolated /srv/juro root and a GitHub HTTPS repository");
}
for (const field of ["environmentFile", "backupCommand", "qualifyCommand"]) {
  if (!isAbsolute(config[field] ?? "") || resolve(config[field]).startsWith(root + "/releases/")) {
    throw new Error(`Operator configuration requires an external absolute ${field}`);
  }
}
await access(config.backupCommand, constants.X_OK);
await access(config.qualifyCommand, constants.X_OK);
const settings = parseEnv(await readFile(config.environmentFile, "utf8"));
if (settings.DEPLOYMENT_ENVIRONMENT !== environment || !settings.DATABASE_URL || !isAbsolute(settings.OBJECT_STORAGE_PATH ?? "")) {
  throw new Error("Environment, database and absolute object storage must be provisioned before deployment");
}
if (new URL(settings.DATABASE_URL).pathname !== `/juro_${environment}`
  || !(await realpath(settings.OBJECT_STORAGE_PATH)).startsWith(root + "/data/")) {
  throw new Error("Use the environment-specific database name and object storage inside its data directory");
}
const requiredPorts = environment === "production" ? [3000, 3001, 3002] : [3100, 3101, 3102];
if (["PORT", "WEBSITE_PORT", "ADMIN_PORT"].some((name, index) => Number(settings[name]) !== requiredPorts[index])) {
  throw new Error("Environment listener ports are not isolated");
}
if (environment === "staging" && settings.EMAIL_DELIVERY_MODE !== "capture") {
  throw new Error("Staging deployments must capture email; live delivery checks use a separate operator configuration");
}
// Compare configured environments before allowing a staging deployment to touch storage.
const otherEnvironment = environment === "production" ? "staging" : "production";
try {
  const other = JSON.parse(await readFile(`/etc/juro/${otherEnvironment}.json`, "utf8"));
  const otherSettings = parseEnv(await readFile(other.environmentFile, "utf8"));
  const databaseIdentity = value => { const url = new URL(value); return `${url.hostname}:${url.port || "5432"}${url.pathname}`; };
  if (databaseIdentity(settings.DATABASE_URL) === databaseIdentity(otherSettings.DATABASE_URL)
    || resolve(settings.OBJECT_STORAGE_PATH) === resolve(otherSettings.OBJECT_STORAGE_PATH)
    || config.environmentFile === other.environmentFile) throw new Error("Staging and production storage must be separate");
} catch (error) { if (error.code !== "ENOENT") throw error; }

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  if (result.error || result.status !== 0) throw new Error(`Deployment command failed: ${command}`);
  return (result.stdout ?? "").trim();
}
function tip() {
  return run("git", ["ls-remote", config.repository, `refs/heads/${branch}`], root, true).split(/\s/)[0];
}
await mkdir(join(root, "releases"), { recursive: true, mode: 0o700 });
const lock = join(root, ".deploy-lock");
await mkdir(lock, { mode: 0o700 }); // Atomic host-side lock; stale locks require operator inspection.
let previous;
let activating = false;
try {
  const current = join(root, "current");
  try {
    if (!(await lstat(current)).isSymbolicLink()) throw new Error("Current release must be a symlink");
    previous = resolve(root, await readlink(current));
    if (!previous.startsWith(join(root, "releases") + "/")) throw new Error("Previous release escapes environment root");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (tip() !== revision) throw new Error("The branch has moved beyond the validated revision");
  const release = join(root, "releases", `${revision}-${Date.now()}`);
  run("git", ["clone", "--single-branch", "--branch", branch, "--no-checkout", config.repository, release], root);
  run("git", ["checkout", "--detach", revision], release);
  await symlink(config.environmentFile, join(release, ".env.self-hosted"));
  if (config.investorAssets) {
    if (!isAbsolute(config.investorAssets)) throw new Error("Investor assets require an absolute path");
    await access(config.investorAssets);
    await symlink(config.investorAssets, join(release, "apps/website/public/investor"));
  }
  run("npm", ["ci", "--prefix", "apps/platform"], release);
  run("npm", ["ci", "--prefix", "apps/website"], release);
  run("npm", ["run", "type-check"], release);
  run("npm", ["run", "build"], release);
  if (run("git", ["status", "--porcelain"], release, true)) throw new Error("Build modified the release source");
  if (tip() !== revision) throw new Error("A newer branch revision superseded this build");
  // Commands receive explicit environment/release arguments and are never shell-evaluated.
  run(config.backupCommand, [environment, revision, release], root);
  run("npm", ["run", "db:migrate", "--prefix", "apps/platform"], release);
  run(config.qualifyCommand, [environment, revision, release], root);
  if (tip() !== revision) throw new Error("A newer branch revision superseded qualification");
  activating = true;
  run(process.execPath, ["scripts/install-self-hosted-services.mjs", "--production", "--environment", environment], release);
  const next = join(root, `.current-${revision}-${Date.now()}`);
  await symlink(release, next);
  await rename(next, current);
  console.log(`Activated ${environment} revision ${revision}`);
} catch (error) {
  if (activating && previous) {
    try {
      run(process.execPath, ["scripts/install-self-hosted-services.mjs", "--production", "--environment", environment], previous);
      console.error("Restored previous application services; database migrations were not reversed.");
    } catch { console.error("Application rollback failed; operator intervention is required."); }
  }
  throw error;
} finally { await rmdir(lock); }
