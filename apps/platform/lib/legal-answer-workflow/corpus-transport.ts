import type { createPreparedNumericTransport } from "../legal-corpus/prepared-numeric-transport";
import { indexedRetrievalRemainingMs, indexedRetrievalSignal } from "../runtime/indexed-retrieval";
import { withinSignal } from "./lifetime";
import type { EvidenceScope } from "./evidence";
import { emitResearchDiagnostic } from "./diagnostics";

type Configuration = Parameters<typeof createPreparedNumericTransport>[0];
type Transport = ReturnType<typeof createPreparedNumericTransport>;
type Waiting = { catalog: boolean; signal: AbortSignal; start(): void; cancel(): void };
type Queue = { active: number; waiting: Waiting[]; catalogBurst: number };
const queues = new Map<string, Queue>();

/** A process-wide bound covers all requests and credentials targeting the same loopback port. */
async function acquire(key: string, signal: AbortSignal, catalog: boolean): Promise<() => void> {
  signal.throwIfAborted();
  let queue = queues.get(key);
  if (!queue) {
    if (queues.size >= 32) throw new Error("CORPUS_TRANSPORT_CAPACITY");
    queue = { active: 0, waiting: [], catalogBurst: 0 }; queues.set(key, queue);
  }
  const current = queue;
  const release = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // Short catalog reads unblock already-completed discovery. At most two
      // may bypass older ordinary work; FIFO is retained within each class.
      const catalogIndex = current.waiting.findIndex(item => item.catalog);
      const ordinaryIndex = current.waiting.findIndex(item => !item.catalog);
      const index = catalogIndex >= 0 && (current.catalogBurst < 2 || ordinaryIndex < 0) ? catalogIndex : ordinaryIndex;
      const next = index >= 0 ? current.waiting.splice(index, 1)[0] : undefined;
      if (next) {
        current.catalogBurst = next.catalog ? Math.min(2, current.catalogBurst + 1) : 0;
        next.start();
      }
      else {
        current.catalogBurst = 0;
        current.active--;
        if (!current.active && queues.get(key) === current) queues.delete(key);
      }
    };
  };
  if (current.active < 4) { current.active++; return release(); }
  if (current.waiting.length >= 32) throw new Error("CORPUS_TRANSPORT_CAPACITY");
  return new Promise<() => void>((resolve, reject) => {
    const item: Waiting = { catalog, signal, start() {
      signal.removeEventListener("abort", item.cancel);
      resolve(release());
    }, cancel() {
      const index = current.waiting.indexOf(item);
      if (index < 0) return;
      current.waiting.splice(index, 1);
      signal.removeEventListener("abort", item.cancel);
      reject(signal.reason);
    } };
    current.waiting.push(item);
    signal.addEventListener("abort", item.cancel, { once: true });
    if (signal.aborted) item.cancel();
  });
}

async function readJson(response: Response, maximumBytes: number, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    throw new Error("CORPUS_TRANSPORT_BODY_LIMIT");
  }
  if (!response.body) throw new Error("CORPUS_TRANSPORT_BODY_MISSING");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await withinSignal(signal, () => reader.read());
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) throw new Error("CORPUS_TRANSPORT_BODY_LIMIT");
      chunks.push(next.value);
    }
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Fresh transport over the retained numeric discovery and original-source protocol. */
export function createCorpusTransport(configuration: Configuration): Pick<Transport, "execute" | "readExact" | "readSources" | "readAsset"> & {
  readSourceReference(request: { artifacts: unknown; reference: { url: string; scope: EvidenceScope } }, signal?: AbortSignal): Promise<unknown>;
} {
  let url: URL;
  try { url = new URL(configuration.url); } catch { throw new Error("CORPUS_TRANSPORT_CONFIGURATION"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || !/^[a-f0-9]{64}$/u.test(configuration.workerSha256)
    || configuration.token.length < 32 || configuration.token.length > 4096 || /[\s\x00-\x1f\x7f]/u.test(configuration.token)) {
    throw new Error("CORPUS_TRANSPORT_CONFIGURATION");
  }
  const origin = url.origin, queueKey = `loopback:${url.port || "80"}`;
  const { token, workerSha256 } = configuration;
  async function post(path: string, request: unknown, caller?: AbortSignal): Promise<unknown> {
    const started = performance.now();
    const scope = indexedRetrievalSignal();
    const remaining = scope ? indexedRetrievalRemainingMs() : 60_000;
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("CORPUS_TRANSPORT_DEADLINE");
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, ...(scope ? [scope] : []), ...(caller ? [caller] : [])]);
    const timer = setTimeout(() => controller.abort(new Error("CORPUS_TRANSPORT_DEADLINE")), Math.ceil(Math.min(60_000, remaining)));
    let release: (() => void) | undefined;
    let response: Response | undefined;
    let admissionStarted: number | undefined, admitted: number | undefined, headersReceived: number | undefined;
    let bodyStarted: number | undefined, bodyFinished: number | undefined;
    try {
      signal.throwIfAborted();
      const body = JSON.stringify(request);
      if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("CORPUS_TRANSPORT_REQUEST_LIMIT");
      admissionStarted = performance.now();
      release = await acquire(queueKey, signal, path === "/read-exact");
      admitted = performance.now();
      signal.throwIfAborted();
      response = await withinSignal(signal, () => fetch(origin + path, { method: "POST", body, signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        redirect: "error", cache: "no-store" }));
      headersReceived = performance.now();
      if (response.headers.get("x-juro-worker-sha256") !== workerSha256) throw new Error("CORPUS_WORKER_IDENTITY");
      if (path === "/read-exact" && response.status === 413) throw new Error("PREPARED_CATALOG_PAGE_REQUIRED");
      if (!response.ok) throw new Error("CORPUS_TRANSPORT_HTTP");
      if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        throw new Error("CORPUS_TRANSPORT_CONTENT_TYPE");
      }
      bodyStarted = performance.now();
      const result = await readJson(response, path === "/search" ? 4 * 1024 * 1024 : 64 * 1024 * 1024, signal);
      bodyFinished = performance.now();
      return result;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new Error(error instanceof Error && (/^CORPUS_[A-Z_]+$/u.test(error.message)
        || error.message === "PREPARED_CATALOG_PAGE_REQUIRED") ? error.message : "CORPUS_TRANSPORT_FAILED");
    } finally {
      const timing = response?.headers.get("server-timing") ?? "";
      const duration = (name: string) => {
        const match = timing.split(",").map(item => item.trim()).find(item => item.startsWith(`${name};`));
        const value = match?.match(/(?:^|;)\s*dur=([\d.]+)/u)?.[1];
        return value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
      };
      const finished = performance.now();
      emitResearchDiagnostic({ event: "corpus_timing", durationMs: finished - started,
        admissionWaitMs: admissionStarted === undefined ? null : (admitted ?? finished) - admissionStarted,
        responseWaitMs: admitted === undefined ? null : (headersReceived ?? finished) - admitted,
        bodyReadParseMs: bodyStarted === undefined ? null : (bodyFinished ?? finished) - bodyStarted,
        queueMs: duration("queue"), serviceMs: duration("service") });
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
      controller.abort(); clearTimeout(timer); release?.();
    }
  }
  return {
    execute: (request, signal) => post("/search", request, signal),
    readExact: (request, signal) => post("/read-exact", request, signal),
    readSources: (request, signal) => post("/read-sources", request, signal),
    readSourceReference: (request, signal) => post("/read-sources", request, signal),
    readAsset: (request, signal) => post("/read-asset", request, signal),
  };
}
