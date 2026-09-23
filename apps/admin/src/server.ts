import { createServer } from "node:http";
import { Readable } from "node:stream";
import application from "./worker";

if (process.env.PRIVATE_DEVELOPMENT !== "true") throw new Error("Admin requires private SSH access");
const port = Number(process.env.ADMIN_PORT ?? 3002);
const platformOrigin = process.env.APP_URL ?? "http://localhost:3000";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(platformOrigin)) throw new Error("Admin requires a local platform origin");
const env = {
  APP_ENV: "development",
  PLATFORM_ORIGIN: platformOrigin,
  ADMIN_INTERNAL_TOKEN: process.env.ADMIN_INTERNAL_TOKEN,
  PLATFORM_ADMIN_API: { fetch(request: Request) {
    const incoming = new URL(request.url);
    return fetch(new Request(new URL(incoming.pathname + incoming.search, platformOrigin), request), { redirect: "error" });
  } },
} as Env;

createServer(async (request, response) => {
  if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(request.headers.host ?? "")) {
    response.writeHead(403); response.end(); return;
  }
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 8192) { response.writeHead(413); response.end(); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(",") : value);
    const result = await application.fetch(new Request(`http://${request.headers.host}${request.url}`, {
      method: request.method, headers,
      ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: Buffer.concat(chunks) }),
    }), env);
    // Preserve separate Set-Cookie headers when establishing the admin session.
    result.headers.forEach((value, name) => { if (name !== "set-cookie") response.setHeader(name, value); });
    const cookies = result.headers.getSetCookie();
    if (cookies.length) response.setHeader("set-cookie", cookies);
    response.statusCode = result.status;
    if (result.body) Readable.fromWeb(result.body as import("node:stream/web").ReadableStream).pipe(response);
    else response.end();
  } catch {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
}).listen(port, "127.0.0.1", () => console.log(`Admin listening on http://127.0.0.1:${port}`));
