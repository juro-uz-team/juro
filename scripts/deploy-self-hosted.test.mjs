import assert from "node:assert/strict";
import test from "node:test";
import { coordinateDeploymentActivation } from "./deploy-self-hosted.mjs";

const target = { environment: "production", revision: "a".repeat(40), release: "/srv/juro/production/releases/new", previous: "/srv/juro/production/releases/old" };
const originalSelectionSha256 = "b".repeat(64);
function fixture(overrides = {}) {
  const events = [];
  const actions = {
    hook: async phase => { events.push(phase); return { version: 1, ...target, phase, originalSelectionSha256, selectionState: phase === "activate" ? "committed" : "original" }; },
    install: async release => { events.push(`install:${release}`); },
    switchCurrent: async release => { events.push(`current:${release}`); },
    ...overrides,
  };
  return { events, actions };
}
test("deployment qualifies corpus before changing services and activates only after switching current", async () => {
  const { events, actions } = fixture();
  await coordinateDeploymentActivation(target, actions);
  assert.deepEqual(events, ["prepare", `install:${target.release}`, `current:${target.release}`, "activate"]);
});

test("unqualified or wrongly bound corpus preparation never changes services", async () => {
  for (const mismatch of [{ revision: "c".repeat(40) }, { previous: null }, { selectionState: "committed" }, { originalSelectionSha256: "bad" }]) {
    const { events, actions } = fixture({ hook: async phase => ({ version: 1, ...target, phase, originalSelectionSha256, selectionState: "original", ...mismatch }) });
    await assert.rejects(coordinateDeploymentActivation(target, actions));
    assert.deepEqual(events, []);
  }
});

test("failed activation restores services and current only with the same original selection", async () => {
  const { events, actions } = fixture();
  const originalHook = actions.hook;
  actions.hook = async phase => { if (phase === "activate") throw Error("publication failed"); return originalHook(phase); };
  await assert.rejects(coordinateDeploymentActivation(target, actions), error => error.preserveDeploymentLock === false);
  assert.deepEqual(events, ["prepare", `install:${target.release}`, `current:${target.release}`, "status", `install:${target.previous}`, `current:${target.previous}`]);
});

test("committed, ambiguous, changed-parent, malformed and unavailable status preserve candidate and lock", async () => {
  for (const status of [{ selectionState: "committed" }, { selectionState: "ambiguous" }, { originalSelectionSha256: "c".repeat(64) }, null, "throw"]) {
    const { events, actions } = fixture();
    const originalHook = actions.hook;
    actions.hook = async phase => {
      if (phase === "activate") throw Error("lost activation response");
      if (phase === "status") {
        if (status === "throw") throw Error("status unavailable");
        return status && { ...await originalHook(phase), ...status };
      }
      return originalHook(phase);
    };
    await assert.rejects(coordinateDeploymentActivation(target, actions), error => error.preserveDeploymentLock === true);
    assert(!events.includes(`install:${target.previous}`));
    assert(!events.includes(`current:${target.previous}`));
  }
});

test("partial service installation checks corpus before rollback; failed rollback retains lock", async () => {
  const { events, actions } = fixture();
  actions.install = async path => { events.push(`install:${path}`); throw Error("service manager failure"); };
  await assert.rejects(coordinateDeploymentActivation(target, actions), error => error.preserveDeploymentLock === true);
  assert.deepEqual(events, ["prepare", `install:${target.release}`, "status", `install:${target.previous}`]);
});

test("branch supersession after preparation stops before installation", async () => {
  const { events, actions } = fixture({ beforeInstall: async () => { throw Error("branch moved"); } });
  await assert.rejects(coordinateDeploymentActivation(target, actions), /branch moved/);
  assert.deepEqual(events, ["prepare"]);
});

test("installations without a shared corpus retain ordinary rollback behavior", async () => {
  const { events, actions } = fixture({ hook: undefined });
  await coordinateDeploymentActivation(target, actions);
  assert.deepEqual(events, [`install:${target.release}`, `current:${target.release}`]);
});
