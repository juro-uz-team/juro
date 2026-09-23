import { publicApiRequestBodyLimit } from "../lib/request-body";
import { STATUS_ORIGIN_HEADER } from "../lib/operations/status-metadata";
import { LAWYER_HOST_REQUEST_HEADER } from "../lib/platform/lawyer-entry-routing";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import next from "next";
import { getSelfHostedRuntime } from "../lib/runtime/self-hosted";
import { handleInternalAdminRequest } from "../lib/auth/admin-internal-api";
import { INTERNAL_REQUEST_PATH_HEADER, isAuthenticatedPlatformPathReady } from "../lib/platform/routing";

if (process.env.PRIVATE_DEVELOPMENT !== "true") throw new Error("This deployment requires private SSH access");
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev: process.env.NODE_ENV !== "production", hostname: "localhost", port });
await app.prepare();
const handle = app.getRequestHandler();

function secureResponse(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'") + "; connect-src 'self' ws://localhost:*; media-src 'self' blob:; worker-src 'self' blob:");
}

function boundedBody(request: IncomingMessage, response: ServerResponse, limit: number): boolean {
  const reject = () => {
    response.shouldKeepAlive = false;
    if (!response.headersSent) response.writeHead(413, { Connection: "close" });
    response.once("finish", () => request.destroy());
    response.end();
  };
  const length = request.headers["content-length"];
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    reject(); return false;
  }
  const push = request.push.bind(request);
  let received = 0;
  request.push = (chunk, encoding) => {
    if (chunk !== null) received += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding);
    if (received > limit) {
      reject(); return false;
    }
    return push(chunk, encoding);
  };
  return true;
}

createServer(async (request, response) => {
  secureResponse(response);
  const host = request.headers.host ?? "";
  if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(host)) {
    response.writeHead(400); response.end(); return;
  }
  const url = new URL(request.url ?? "/", `http://${host}`);
  if (!isAuthenticatedPlatformPathReady(url.pathname)) { response.writeHead(404); response.end(); return; }
  if (!boundedBody(request, response, publicApiRequestBodyLimit(url.pathname, request.method ?? "GET") ?? 50 * 1024 * 1024)) return;
  for (const name of Object.keys(request.headers)) {
    if (name.startsWith("cf-") || name.startsWith("x-forwarded-") || name === "forwarded"
      || name === STATUS_ORIGIN_HEADER || name === LAWYER_HOST_REQUEST_HEADER
      || name === "x-juro-client-ip" || name === INTERNAL_REQUEST_PATH_HEADER) delete request.headers[name];
  }
  request.headers["x-juro-client-ip"] = request.socket.remoteAddress ?? "127.0.0.1";
  request.headers[INTERNAL_REQUEST_PATH_HEADER] = `${url.pathname}${url.search}`;
  try {
    if (url.pathname.startsWith("/api/internal/admin/")) {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(",") : value);
      const webRequest = new Request(url, { method: request.method, headers,
        ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: Readable.toWeb(request), duplex: "half" }) } as RequestInit);
      const result = await handleInternalAdminRequest(webRequest, getSelfHostedRuntime());
      if (result) {
        response.writeHead(result.status, Object.fromEntries(result.headers));
        if (result.body) Readable.fromWeb(result.body as import("node:stream/web").ReadableStream).pipe(response);
        else response.end();
        return;
      }
      response.writeHead(404); response.end(); return;
    }
    await handle(request, response);
  } catch (error) {
    console.error("Request failed", error instanceof Error ? error.name : "UnknownError");
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
}).listen(port, "127.0.0.1", () => console.log(`Platform listening on http://127.0.0.1:${port}`));
