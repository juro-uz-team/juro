import { spawn } from "node:child_process";

/** Fixed executable/argument callers only; no shell interpretation or inherited provider secrets. */
export function runDocumentTool(executable: string, args: string[], options: { input?: Uint8Array; timeout?: number; maxOutput?: number } = {}) {
  const scannerContainer = process.platform === "win32" && process.env.PRIVATE_DEVELOPMENT === "true" && executable === "clamscan"
    ? process.env.LOCAL_CLAMAV_CONTAINER : undefined;
  if (scannerContainer && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(scannerContainer)) {
    return Promise.reject(new Error("Invalid local scanner container name"));
  }
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(scannerContainer ? "docker.exe" : executable, scannerContainer ? ["exec", "-i", scannerContainer, "clamscan", ...args] : args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: { ...(process.platform === "win32" ? { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA } : { PATH: "/usr/bin:/bin" }), LANG: "C.UTF-8", OMP_THREAD_LIMIT: "1", NODE_ENV: "production" } });
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
