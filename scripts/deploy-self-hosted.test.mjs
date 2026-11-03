import assert from "node:assert/strict";
import test from "node:test";
import { coordinateDeploymentActivation, corpusDeploymentCommand, pruneReleases } from "./deploy-self-hosted.mjs";
import { mkdtemp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("retention keeps the actual rollback release instead of a newer failed build", async () => {
  const root = await mkdtemp(join(tmpdir(), "juro-release-retention-"));
  try {
    const releases = join(root, "releases");
    const names = [1, 2, 3, 4].map(i => `${String(i).repeat(40)}-${i}`);
    for (const name of names) await mkdir(join(releases, name), { recursive: true });
    await symlink(join(releases, names[2]), join(root, "current"), "junction");
    const removed = await pruneReleases(root, join(releases, names[2]), join(releases, names[1]));
    assert.deepEqual(removed.sort(), [join(releases, names[0]), join(releases, names[3])].sort());
    assert.deepEqual((await readdir(releases)).sort(), [names[1], names[2]].sort());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("retention refuses changed current and protects referenced releases and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "juro-release-retention-"));
  try {
    const releases = join(root, "releases");
    const active = join(releases, `${"a".repeat(40)}-1`);
    const referenced = join(releases, `${"b".repeat(40)}-2`);
    await mkdir(active, { recursive: true });
    await mkdir(referenced);
    await symlink(active, join(root, "current"), "junction");
    await symlink(root, join(releases, `${"c".repeat(40)}-3`), "junction");
    await assert.rejects(pruneReleases(root, referenced, active), /Active release changed/);
    await assert.rejects(pruneReleases(root, active, root), /escapes/);
    assert.deepEqual(await pruneReleases(root, active, undefined, { referenced: async () => referenced }), []);
    assert.equal((await readdir(releases)).length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

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


test("retained-corpus application releases skip corpus hooks and preserve application rollback", async () => {
  assert.equal(corpusDeploymentCommand({corpusPolicy:"retain",corpusCommand:"/operator/activate-corpus"},{CORPUS_DATABASE_URL:"configured"}),undefined);
  const {events,actions}=fixture({hook:undefined});
  actions.install=async path=>{events.push(`install:${path}`);if(path===target.release)throw Error("application install failed");};
  await assert.rejects(coordinateDeploymentActivation(target,actions),error=>error.preserveDeploymentLock===false);
  assert.deepEqual(events,[`install:${target.release}`,`install:${target.previous}`,`current:${target.previous}`]);
});
test("corpus activation remains explicit and unknown operator policies fail closed", () => {
  assert.equal(corpusDeploymentCommand({corpusCommand:"/operator/activate-corpus"},{CORPUS_DATABASE_URL:"configured"}),"/operator/activate-corpus");
  assert.equal(corpusDeploymentCommand({},{}),undefined);
  assert.throws(()=>corpusDeploymentCommand({corpusPolicy:"typo"},{}),/corpus policy/);
  assert.throws(()=>corpusDeploymentCommand({},{CORPUS_DATABASE_URL:"configured"}),/corpusCommand/);
});
