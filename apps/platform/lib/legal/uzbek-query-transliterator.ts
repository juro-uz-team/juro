import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";

const queriesSchema = z.array(z.string().min(1).max(2000)).min(1).max(4);
// Platform services and qualification runners set cwd to apps/platform. Resolve
// from that release directory so bundling cannot relocate the Python asset.
const script = resolve("scripts/uzbek-query-transliterate.py");

/** Run the pinned Python package once per batch. No shell, provider secrets or network. */
export async function transliterateUzbekQueries(queries: string[], signal?: AbortSignal): Promise<string[]> {
  queriesSchema.parse(queries);
  signal?.throwIfAborted();
  const input = JSON.stringify(queries);
  if (Buffer.byteLength(input) > 32768) throw new Error("UZBEK_TRANSLITERATION_INPUT_LIMIT");
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "python" : "python3", ["-I", "-B", script], {
      shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.platform === "win32" ? process.env.PATH : "/usr/bin:/bin",
        ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot, LOCALAPPDATA: process.env.LOCALAPPDATA } : {}),
        LANG: "C.UTF-8", NODE_ENV: "production" },
    });
    const chunks: Buffer[] = [];
    let size = 0, failure: Error | undefined;
    const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
    const cancel = () => stop(new Error("UZBEK_TRANSLITERATION_CANCELLED"));
    const timer = setTimeout(() => stop(new Error("UZBEK_TRANSLITERATION_TIMEOUT")), 3000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32768) stop(new Error("UZBEK_TRANSLITERATION_OUTPUT_LIMIT"));
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32768) stop(new Error("UZBEK_TRANSLITERATION_OUTPUT_LIMIT"));
    });
    child.stdin.on("error", () => stop(new Error("UZBEK_TRANSLITERATION_INPUT_FAILED")));
    child.on("error", () => { cleanup(); reject(new Error("UZBEK_TRANSLITERATION_UNAVAILABLE")); });
    child.on("close", code => {
      cleanup();
      if (failure || code !== 0) { reject(failure ?? new Error("UZBEK_TRANSLITERATION_FAILED")); return; }
      try {
        const output = queriesSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        if (output.length !== queries.length) throw new Error("UZBEK_TRANSLITERATION_COUNT");
        resolve(output);
      } catch { reject(new Error("UZBEK_TRANSLITERATION_OUTPUT_INVALID")); }
    });
    child.stdin.end(input);
  });
}
