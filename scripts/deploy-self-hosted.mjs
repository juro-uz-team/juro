#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, lstat, mkdir, readFile, readlink, realpath, rename, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

function corpusReceipt(value, phase, target, original) {
  if (value?.version !== 1 || value.phase !== phase
    || ["environment", "revision", "release"].some(key => value[key] !== target[key])
    || value.previous !== (target.previous ?? null)
    || !/^[a-f0-9]{64}$/.test(value.originalSelectionSha256 ?? "")
    || (original && value.originalSelectionSha256 !== original)
    || !["original", "committed", "ambiguous"].includes(value.selectionState)) {
    throw new Error("Invalid corpus deployment receipt");
  }
  return value;
}

/** Operator hook and service manager boundary. Ambiguous publication forbids rollback. */
export async function coordinateDeploymentActivation(target, actions) {
  let prepared;
  if (actions.hook) {
    prepared = corpusReceipt(await actions.hook("prepare"), "prepare", target);
    if (prepared.selectionState !== "original") throw new Error("Corpus preparation did not retain original selection");
  }
  await actions.beforeInstall?.();
  try {
    await actions.install(target.release);
    await actions.switchCurrent(target.release);
    if (actions.hook) {
      const activated = corpusReceipt(await actions.hook("activate"), "activate", target, prepared.originalSelectionSha256);
      if (activated.selectionState !== "committed") throw new Error("Corpus activation was not confirmed");
    }
  } catch (error) {
    let safe = !actions.hook;
    if (actions.hook) {
      try {
        safe = corpusReceipt(await actions.hook("status"), "status", target, prepared.originalSelectionSha256).selectionState === "original";
      } catch { safe = false; }
    }
    let restored = false;
    if (safe && target.previous) {
      try {
        await actions.install(target.previous);
        await actions.switchCurrent(target.previous);
        restored = true;
      } catch { /* Keep the lock when restoration cannot be established. */ }
    }
    const failure = new Error(restored
      ? "Deployment failed; restored previous application services and current link; migrations were not reversed"
      : "Deployment failed; candidate retained where possible and deployment lock retained; operator inspection required", { cause: error });
    failure.preserveDeploymentLock = !restored;
    throw failure;
  }
}

async function main() {

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
if (settings.CORPUS_DATABASE_URL || config.corpusCommand) {
  if (!isAbsolute(config.corpusCommand ?? "") || resolve(config.corpusCommand).startsWith(root + "/releases/")) {
    throw new Error("Shared corpus deployment requires an external absolute corpusCommand");
  }
  await access(config.corpusCommand, constants.X_OK);
}
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
if (!settings.STATUS_URL || Number(settings.STATUS_PORT) !== requiredPorts[0] + 4
  || (environment === "production" && (!settings.LAWYER_URL || Number(settings.LAWYER_PORT) !== 3003))
  || (environment === "staging" && settings.LAWYER_URL)) {
  throw new Error("Domain listeners require isolated production lawyer and environment-specific status ports");
}
if (environment === "staging" && settings.EMAIL_DELIVERY_MODE !== "capture") {
  throw new Error("Staging deployments must capture email; live delivery checks use a separate operator configuration");
}
// Each account can read only its own secret file. The fixed database names and
// object roots above enforce storage separation without opening the other file.
const otherEnvironment = environment === "production" ? "staging" : "production";
try {
  const other = JSON.parse(await readFile(`/etc/juro/${otherEnvironment}.json`, "utf8"));
  if (other.root !== `/srv/juro/${otherEnvironment}` || config.environmentFile === other.environmentFile) {
    throw new Error("Staging and production storage must be separate");
  }
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
let preserveLock = false;
try {
  const current = join(root, "current");
  try {
    if (!(await lstat(current)).isSymbolicLink()) throw new Error("Current release must be a symlink");
    previous = resolve(root, await readlink(current));
    if (!previous.startsWith(join(root, "releases") + "/")) throw new Error("Previous release escapes environment root");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (tip() !== revision) throw new Error("The branch has moved beyond the validated revision");
  const release = join(root, "releases", `${revision}-${Date.now()}`);
  await writeFile(join(lock, "owner.json"), JSON.stringify({ version: 1, environment, revision, release, previous: previous ?? null }), { flag: "wx", mode: 0o600 });
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
  const sourceChanges = run("git", ["status", "--porcelain"], release, true);
  if (sourceChanges) {
    console.error(sourceChanges);
    throw new Error("Build modified the release source");
  }
  if (tip() !== revision) throw new Error("A newer branch revision superseded this build");
  // Commands receive explicit environment/release arguments and are never shell-evaluated.
  run(config.backupCommand, [environment, revision, release], root);
  run("npm", ["run", "db:migrate", "--prefix", "apps/platform"], release);
  run(config.qualifyCommand, [environment, revision, release], root);
  if (tip() !== revision) throw new Error("A newer branch revision superseded qualification");
  const evidence = join(release, ".scratch", "deployment");
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const target = { environment, revision, release, previous };
  const hook = config.corpusCommand ? async phase => {
    const result = spawnSync(config.corpusCommand, [phase, environment, revision, release, previous ?? ""], {
      cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 150_000,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    await writeFile(join(evidence, `corpus-${phase}.json`), JSON.stringify({
      phase, status: result.status, error: result.error?.message,
      stdout: result.stdout ?? "", stderr: result.stderr ?? "",
    }, null, 2), { flag: "wx", mode: 0o600 });
    if (result.error || result.status !== 0) throw new Error(`Corpus ${phase} command failed`);
    return JSON.parse(result.stdout);
  } : undefined;
  await coordinateDeploymentActivation(target, {
    hook,
    beforeInstall: async () => { if (tip() !== revision) throw new Error("A newer branch revision superseded corpus preparation"); },
    install: async path => run(process.execPath, ["scripts/install-self-hosted-services.mjs", "--production", "--environment", environment], path),
    switchCurrent: async path => {
      const next = join(root, `.current-${revision}-${Date.now()}`);
      await symlink(path, next);
      await rename(next, current);
    },
  });
  console.log(`Activated ${environment} revision ${revision}`);
} catch (error) {
  preserveLock = error.preserveDeploymentLock === true;
  console.error(error.message);
  throw error;
} finally {
  if (!preserveLock) {
    await unlink(join(lock, "owner.json")).catch(error => { if (error.code !== "ENOENT") throw error; });
    await rmdir(lock);
  }
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
