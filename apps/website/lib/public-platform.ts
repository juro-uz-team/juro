import { request } from "node:http";

export function publicPlatformOrigin() {
  return (process.env.JURO_PUBLIC_PLATFORM_ORIGIN || process.env.NEXT_PUBLIC_PLATFORM_ORIGIN || process.env.APP_URL || `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
}

/** The native application accepts its canonical Host from the local proxy.
 * Use the same boundary for public catalogue reads, including protected staging.
 */
export async function publicPlatformJson<T>(path: string): Promise<T> {
  if (!path.startsWith("/api/public/lawyers") || path.includes("?") || path.includes("#")) throw new Error("Unsupported public catalogue path");
  if (process.env.JURO_PUBLIC_PLATFORM_ORIGIN) {
    const response = await fetch(publicPlatformOrigin() + path, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Public catalogue unavailable");
    return response.json() as Promise<T>;
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid application port");
  const host = process.env.PRIVATE_DEVELOPMENT === "true" ? `localhost:${port}` : new URL(publicPlatformOrigin()).host;
  return new Promise<T>((resolve, reject) => {
    const call = request({ hostname: "127.0.0.1", port, path, method: "GET", headers: { host, "x-real-ip": "127.0.0.1", accept: "application/json" } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error("Public catalogue unavailable")); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { response.destroy(new Error("Public catalogue response too large")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T); } catch (error) { reject(error); } });
    });
    call.setTimeout(5000, () => call.destroy(new Error("Public catalogue timed out")));
    call.on("error", reject); call.end();
  });
}
