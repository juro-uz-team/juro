import { spawn } from "node:child_process";

/** Fixed executable/argument callers only; no shell interpretation or inherited provider secrets. */
export function runDocumentTool(executable: string, args: string[], options: { input?: Uint8Array; timeout?: number; maxOutput?: number } = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", OMP_THREAD_LIMIT: "1", NODE_ENV: "production" } });
    const output: Buffer[] = [], errors: Buffer[] = [];
    let size = 0, failure: Error | undefined;
    const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
    const timer = setTimeout(() => stop(new Error("Document tool timed out")), options.timeout ?? 120_000);
    const receive = (destination: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxOutput ?? 8 * 1024 * 1024)) stop(new Error("Document tool output exceeded limit"));
      else destination.push(chunk);
    };
    child.stdout.on("data", receive(output)); child.stderr.on("data", receive(errors));
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (failure || code === null) reject(failure ?? new Error("Document tool terminated"));
      else resolve({ code, stdout: Buffer.concat(output).toString("utf8"), stderr: Buffer.concat(errors).toString("utf8") });
    });
    child.stdin.on("error", error => { if ((error as NodeJS.ErrnoException).code !== "EPIPE") stop(error); });
    child.stdin.end(options.input);
  });
}
