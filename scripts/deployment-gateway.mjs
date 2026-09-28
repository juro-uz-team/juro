#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function deploymentRequest(username, environment, originalCommand) {
  if (!["production", "staging"].includes(environment) || username !== `juro-${environment}`) {
    throw new Error("Deployment account does not match the environment");
  }
  const match = /^\/usr\/local\/bin\/juro-deploy (production|staging) ([a-f0-9]{40})$/.exec(originalCommand ?? "");
  if (!match || match[1] !== environment) throw new Error("Only the assigned environment's deployment command is permitted");
  return { environment, revision: match[2] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("The gateway requires one assigned environment");
    const account = userInfo();
    const request = deploymentRequest(account.username, process.argv[2], process.env.SSH_ORIGINAL_COMMAND);
    const result = spawnSync("/usr/local/bin/node", ["/usr/local/lib/juro/deploy-self-hosted.mjs", request.environment, request.revision], {
      cwd: `/srv/juro/${request.environment}`,
      stdio: "inherit",
      env: {
        HOME: account.homedir,
        USER: account.username,
        LOGNAME: account.username,
        PATH: "/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
        XDG_RUNTIME_DIR: `/run/user/${account.uid}`,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${account.uid}/bus`,
      },
    });
    if (result.error) throw new Error("Could not start the deployment process");
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
