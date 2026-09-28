import { createServer } from "node:http";
import next from "next";
import { nativeHttpConfiguration, normalizeNativeRequest } from "../../../scripts/native-http.mjs";

const config = nativeHttpConfiguration(process.env, "website");
const { port } = config;
const platformOrigin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
const app = next({ dev: process.env.NODE_ENV !== "production", hostname: new URL(config.origin).hostname, port: config.privateMode ? port : 443 });
await app.prepare();
const handle = app.getRequestHandler();
createServer(async (request, response) => {
  const url = normalizeNativeRequest(request, config);
  if (!url) {
    response.writeHead(403); response.end(); return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
  request.headers["x-juro-request-path"] = url.pathname;
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.setHeader("X-Frame-Options", "DENY");
  if (config.privateMode || process.env.DEPLOYMENT_ENVIRONMENT === "staging") response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.setHeader("Content-Security-Policy", `default-src 'self'; manifest-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' ${platformOrigin}; img-src 'self' data: blob: ${platformOrigin}; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'` + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'") + "; connect-src 'self' ws://localhost:*; media-src 'self' blob:");
  try { await handle(request, response); }
  catch { if (!response.headersSent) response.writeHead(500); response.end(); }
}).listen(port, "127.0.0.1", () => console.log(`Website listening on http://127.0.0.1:${port}`));
