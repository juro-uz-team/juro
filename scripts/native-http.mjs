import { isIP } from "node:net";

/** @param {Record<string, string | undefined>} environment @param {'platform'|'website'} service */
export function nativeHttpConfiguration(environment, service) {
  const port = Number(environment[service === "platform" ? "PORT" : "WEBSITE_PORT"] ?? (service === "platform" ? 3000 : 3001));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid application port");
  const privateMode = environment.PRIVATE_DEVELOPMENT === "true";
  if (privateMode) return { port, privateMode, origin: `http://localhost:${port}`, hosts: [`localhost:${port}`, `127.0.0.1:${port}`] };
  if (environment.NODE_ENV !== "production" || !["production", "staging"].includes(environment.DEPLOYMENT_ENVIRONMENT ?? "")) {
    throw new Error("Public services require an explicit production or staging deployment");
  }
  const origin = new URL(environment[service === "platform" ? "APP_URL" : "PUBLIC_SITE_URL"] ?? "");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.port || origin.pathname !== "/" || origin.search || origin.hash || isIP(origin.hostname) || !origin.hostname.includes(".")) {
    throw new Error("Public services require a canonical HTTPS origin");
  }
  return { port, privateMode, origin: origin.origin, hosts: [origin.host] };
}

/** Only the local reverse proxy may supply the original address. It must overwrite this header.
 * @param {import('node:http').IncomingMessage} request
 * @param {ReturnType<typeof nativeHttpConfiguration>} config
 */
export function normalizeNativeRequest(request, config) {
  const peer = request.socket.remoteAddress ?? "";
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) || !config.hosts.includes(request.headers.host ?? "")) return null;
  const proxyIp = request.headers["x-real-ip"];
  if (!config.privateMode && (typeof proxyIp !== "string" || !isIP(proxyIp))) return null;
  const path = request.url ?? "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  const url = new URL(path, config.origin);
  if (url.origin !== config.origin) return null;
  for (const name of Object.keys(request.headers)) {
    if (name.startsWith("cf-") || name.startsWith("x-forwarded-")
      || ["x-juro-client-ip", "x-juro-status-origin", "x-juro-lawyer-host", "x-juro-request-path", "forwarded", "x-real-ip"].includes(name)) delete request.headers[name];
  }
  request.headers["x-juro-client-ip"] = config.privateMode ? peer : proxyIp;
  request.headers["x-forwarded-proto"] = config.privateMode ? "http" : "https";
  request.headers["x-forwarded-host"] = request.headers.host;
  return url;
}
