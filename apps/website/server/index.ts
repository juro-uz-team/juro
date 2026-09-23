import { createServer } from "node:http";
import next from "next";

if (process.env.PRIVATE_DEVELOPMENT !== "true") throw new Error("Website requires private SSH access");
const port = Number(process.env.WEBSITE_PORT ?? 3001);
const app = next({ dev: process.env.NODE_ENV !== "production", hostname: "localhost", port });
await app.prepare();
const handle = app.getRequestHandler();
createServer(async (request, response) => {
  if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(request.headers.host ?? "")) {
    response.writeHead(403); response.end(); return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  request.headers["x-juro-request-path"] = url.pathname;
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.setHeader("Content-Security-Policy", "default-src 'self'; manifest-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' http://localhost:3000; img-src 'self' data: blob: http://localhost:3000; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'") + "; connect-src 'self' ws://localhost:*; media-src 'self' blob:");
  try { await handle(request, response); }
  catch { if (!response.headersSent) response.writeHead(500); response.end(); }
}).listen(port, "127.0.0.1", () => console.log(`Website listening on http://127.0.0.1:${port}`));
