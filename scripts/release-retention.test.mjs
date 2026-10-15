import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneInactiveReleases } from "./release-retention.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "release-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releases = join(root, "releases"), procRoot = join(root, "proc");
  const current = join(releases, "current-release"), old = join(releases, "old-release");
  await mkdir(current, { recursive: true }); await mkdir(old);
  await mkdir(join(procRoot, "self"), { recursive: true });
  await writeFile(join(procRoot, "self/mountinfo"), "");
  await symlink(current, join(root, "current"), "dir");
  return { root, releases, procRoot, current, old };
}

test("removes old releases without following their links into shared data", { skip: process.platform !== "linux" }, async t => {
  const f = await fixture(t);
  const shared = join(f.root, "shared"); await mkdir(shared); await writeFile(join(shared, "source"), "keep");
  await symlink(shared, join(f.old, "objects"), "dir");
  assert.deepEqual(await pruneInactiveReleases(f.root, f.current, f), { removed: [f.old], retained: [] });
  assert.deepEqual(await readdir(f.releases), ["current-release"]);
  assert.equal(await readFile(join(shared, "source"), "utf8"), "keep");
});

test("refuses a different current release and a release outside the boundary", { skip: process.platform !== "linux" }, async t => {
  const f = await fixture(t);
  await assert.rejects(pruneInactiveReleases(f.root, f.old, f), /Active release changed/);
  await assert.rejects(pruneInactiveReleases(f.root, f.root, f), /Invalid release boundary/);
  assert.equal((await readdir(f.releases)).length, 2);
});

test("retains a release still referenced by a process or nested mount", { skip: process.platform !== "linux" }, async t => {
  const f = await fixture(t);
  const pid = join(f.procRoot, "123"); await mkdir(join(pid, "fd"), { recursive: true });
  await writeFile(join(pid, "comm"), "node\n");
  await symlink(f.current, join(pid, "cwd"), "dir");
  await symlink(f.current, join(pid, "exe"), "dir");
  await writeFile(join(pid, "maps"), `1-2 r--p 0 00:00 1 ${f.old}/library.so\n`);
  assert.deepEqual(await pruneInactiveReleases(f.root, f.current, f), { removed: [], retained: [f.old] });
  await writeFile(join(pid, "maps"), "");
  await writeFile(join(f.procRoot, "self/mountinfo"), `1 2 0:0 / ${f.old}/data rw - ext4 /dev/test rw\n`);
  assert.deepEqual(await pruneInactiveReleases(f.root, f.current, f), { removed: [], retained: [f.old] });
});
