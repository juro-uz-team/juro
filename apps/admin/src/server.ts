import { createServer } from "node:http";
import { Readable } from "node:stream";
import application from "./worker";
import { nativeAdminOrigin, nativeAdminRequestUrl } from "../../../scripts/native-admin-http.mjs";

if (process.env.PRIVATE_DEVELOPMENT !== "true" && !["production", "staging"].includes(process.env.DEPLOYMENT_ENVIRONMENT ?? "")) throw new Error("Admin requires an explicit native deployment");
const port = Number(process.env.ADMIN_PORT ?? 3002);
const adminOrigin = nativeAdminOrigin(process.env);
const platformOrigin = process.env.PLATFORM_INTERNAL_ORIGIN ?? `http://localhost:${process.env.PORT ?? 3000}`;
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(platformOrigin)) throw new Error("Admin requires a local platform origin");
const env = {
  APP_ENV: process.env.PRIVATE_DEVELOPMENT === "true" ? "development" : process.env.DEPLOYMENT_ENVIRONMENT,
  PLATFORM_ORIGIN: process.env.APP_URL ?? platformOrigin,
  ADMIN_INTERNAL_TOKEN: process.env.ADMIN_INTERNAL_TOKEN,
  ADMIN_CONSOLE_TOKEN: process.env.ADMIN_CONSOLE_TOKEN ?? process.env.ADMIN_INTERNAL_TOKEN,
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
    const result = await application.fetch(new Request(nativeAdminRequestUrl(adminOrigin, request.url), {
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
