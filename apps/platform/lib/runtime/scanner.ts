import { createHash, randomUUID } from "node:crypto";
import { parseClamAvScan, parseClamAvVersion } from "../document-analysis/clamav-output";
import { runDocumentTool } from "./process";

export const localMalwareScanner = {
  async fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, { ...init, duplex: "half" } as RequestInit);
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/scan" || !request.body) return new Response(null, { status: 404 });
    const expected = request.headers.get("x-content-sha256") ?? "";
    const length = Number(request.headers.get("content-length"));
    if (!/^[a-f0-9]{64}$/.test(expected) || !Number.isSafeInteger(length) || length < 1 || length > 50 * 1024 * 1024) return new Response(null, { status: 400 });
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = request.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > length) { await reader.cancel(); return new Response(null, { status: 413 }); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      if (size !== length || createHash("sha256").update(bytes).digest("hex") !== expected) return new Response(null, { status: 400 });
      const version = await runDocumentTool("clamscan", ["--version"], { maxOutput: 16_384 });
      if (version.code !== 0) throw new Error("Scanner unavailable");
      const identity = parseClamAvVersion(version.stdout);
      const scan = await runDocumentTool("clamscan", ["--no-summary", "--stdout", "--alert-exceeds-max=yes", "-"], { input: bytes, maxOutput: 16_384 });
      return Response.json({ schemaVersion: 1, ...parseClamAvScan(scan.code, scan.stdout, scan.stderr),
        provider: "juro-private-clamav", engine: "clamav", ...identity, scanId: randomUUID(), sourceSha256: expected, completedAt: new Date().toISOString() });
    } catch { return Response.json({ error: "SCANNER_UNAVAILABLE" }, { status: 503 }); }
  },
};
