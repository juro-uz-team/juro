import assert from "node:assert/strict";
import test from "node:test";
import { deploymentRequest } from "./deployment-gateway.mjs";

const revision = "a".repeat(40);
const command = environment => `/usr/local/bin/juro-deploy ${environment} ${revision}`;

test("each deployment credential can select only its assigned environment", () => {
  for (const environment of ["production", "staging"]) {
    assert.deepEqual(deploymentRequest(`juro-${environment}`, environment, command(environment)), { environment, revision });
    const other = environment === "production" ? "staging" : "production";
    assert.throws(() => deploymentRequest(`juro-${environment}`, environment, command(other)));
    assert.throws(() => deploymentRequest(`juro-${other}`, environment, command(environment)));
  }
  assert.throws(() => deploymentRequest("root", "production", command("production")));
});

test("interactive shells, transfers, substitutions and additional commands are rejected", () => {
  for (const supplied of [undefined, "", "bash", "internal-sftp", "scp -t /tmp/file", `${command("staging")}\n`,
    `${command("staging")}; id`, `${command("staging")} && id`, `${command("staging")} extra`,
    "/usr/local/bin/juro-deploy staging $(id)", command("staging").replace(revision, "../main"),
    command("staging").replace(revision, revision.slice(1))]) {
    assert.throws(() => deploymentRequest("juro-staging", "staging", supplied), JSON.stringify(supplied));
  }
});
