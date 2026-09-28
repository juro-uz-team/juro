#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename, lstat, realpath, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import { spawnSync } from "node:child_process";
import { publicDnsReady } from "./public-dns-readiness.mjs";

if (process.platform !== "linux" || process.getuid() !== 0) throw Error("Public activation is an operator-owned Linux service");
process.umask(0o077);
const directory = "/var/lib/juro-public-https";
const readyPath = "/etc/caddy/Caddyfile.production-ready";
const livePath = "/etc/caddy/Caddyfile";
async function operatorFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022)) throw Error("Activation input must be a root-owned, non-writable regular file");
  return readFile(path, "utf8");
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore", timeout: 30000 });
  if (result.error || result.status !== 0) throw Error(`Public activation command failed: ${command}`);
}
await mkdir(directory, { recursive: true, mode: 0o700 });
async function record(phase, extra = {}) {
  await writeFile(`${directory}/state.tmp`, JSON.stringify({ phase, checkedAt: new Date().toISOString(), ...extra }, null, 2));
  await rename(`${directory}/state.tmp`, `${directory}/state.json`);
  console.log(JSON.stringify({ phase }));
}
try {
  const config = JSON.parse(await operatorFile("/etc/juro/public-https.json"));
  const receipt = JSON.parse(await operatorFile("/srv/juro/production/recovery/native-active.json"));
  if (receipt.nativeWritesActivated !== true || receipt.finalDataVerified !== true
    || !(await realpath("/srv/juro/production/current")).startsWith("/srv/juro/production/releases/")) {
    throw Error("Production data and services must be activated before public HTTPS");
  }
  if (!Array.isArray(config.resolvers) || config.resolvers.length < 2) throw Error("Two independent public resolvers are required");
  const resolvers = config.resolvers.map(server => {
    const resolver = new Resolver({ timeout: 3000, tries: 1 }); resolver.setServers([server]); return resolver;
  });
  const hosts = config.probes.map(probe => probe.host);
  if (!await publicDnsReady(hosts, config.addresses, resolvers)) {
    await record("waiting_for_dns");
  } else {
    const candidate = await operatorFile(readyPath);
    const digest = createHash("sha256").update(candidate).digest("hex");
    if (candidate !== await operatorFile(livePath)) {
      run("/usr/local/bin/caddy", ["validate", "--config", readyPath, "--adapter", "caddyfile"]);
      await writeFile(`${livePath}.next`, candidate, { mode: 0o644 });
      await chmod(`${livePath}.next`, 0o644);
      await rename(`${livePath}.next`, livePath);
    }
    // Resume a failed reload safely even if the configuration was already replaced.
    let state; try { state = JSON.parse(await readFile(`${directory}/state.json`, "utf8")); } catch {}
    if (state?.loadedConfiguration !== digest) {
      run("systemctl", ["reload", "juro-caddy.service"]);
      await record("waiting_for_certificates", { loadedConfiguration: digest });
    }
    const checks = await Promise.all(config.probes.map(probe => new Promise(resolve => {
      const call = request({ hostname: config.addresses[0], port: 443, servername: probe.host,
        path: probe.path, headers: { host: probe.host }, signal: AbortSignal.timeout(10000) }, response => {
        response.resume(); response.on("end", () => resolve({host: probe.host, passed: response.statusCode === probe.status}));
        response.on("error", () => resolve({host: probe.host, passed: false}));
      });
      call.on("error", () => resolve({host: probe.host, passed: false})); call.end();
    })));
    await record(checks.every(check => check.passed) ? "https_ready" : "waiting_for_certificates", { loadedConfiguration: digest, checks });
    if (checks.every(check => check.passed)) run("systemctl", ["disable", "--now", "juro-public-https.timer"]);
  }
} catch (error) {
  console.error(JSON.stringify({ phase: "activation_error", message: error.message }));
  process.exitCode = 1;
}
