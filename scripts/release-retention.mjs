import { lstat, readdir, readFile, readlink, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const contains = (root, path) => path === root || path.startsWith(root + "/");

/** Called under the deployment lock, after successful service/corpus activation. */
export async function pruneInactiveReleases(root, expectedCurrent, { procRoot = "/proc" } = {}) {
  root = await realpath(root);
  const releases = join(root, "releases");
  if (await realpath(releases) !== releases || dirname(expectedCurrent) !== releases
    || await realpath(expectedCurrent) !== expectedCurrent) throw Error("Invalid release boundary");
  const current = join(root, "current");
  async function checkCurrent() {
    if (!(await lstat(current)).isSymbolicLink() || await realpath(current) !== expectedCurrent) {
      throw Error("Active release changed during retention cleanup");
    }
  }
  await checkCurrent();
  const mounts = (await readFile(join(procRoot, "self/mountinfo"), "utf8")).split("\n")
    .filter(Boolean).map(line => line.split(" ")[4].replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))));
  const active = new Set();
  for (const pid of await readdir(procRoot)) {
    if (!/^\d+$/.test(pid)) continue;
    const processRoot = join(procRoot, pid);
    // Deployment accounts are isolated; only their processes can traverse their releases.
    try {
      if (process.getuid?.() !== 0 && (await lstat(processRoot)).uid !== process.getuid?.()) continue;
      // systemd's nondumpable PAM session helper uses this UID but cannot load application releases.
      if ((await readFile(join(processRoot, "comm"), "utf8")).trim() === "(sd-pam)") continue;
      for (const name of ["cwd", "exe"]) {
        try { active.add(await readlink(join(processRoot, name))); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      for (const fd of await readdir(join(processRoot, "fd"))) {
        try { active.add(await readlink(join(processRoot, "fd", fd))); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      for (const line of (await readFile(join(processRoot, "maps"), "utf8")).split("\n")) {
        const match = line.match(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\/.*)$/);
        if (match) active.add(match[1]);
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const removed = [], retained = [];
  for (const entry of await readdir(releases, { withFileTypes: true })) {
    const path = join(releases, entry.name);
    if (path === expectedCurrent) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path
      || mounts.some(mount => contains(path, mount)) || [...active].some(reference => contains(path, reference))) {
      retained.push(path);
      continue;
    }
    await checkCurrent();
    await rm(path, { recursive: true });
    removed.push(path);
  }
  return { removed, retained };
}
