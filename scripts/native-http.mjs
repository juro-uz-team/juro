import { isIP } from "node:net";

/** @param {Record<string, string | undefined>} environment @param {'platform'|'website'} service */
export function nativeHttpConfiguration(environment, service) {
  const role = service === "platform" ? environment.PLATFORM_HOST_ROLE ?? "app" : "app";
  if (!["app", "lawyer", "status"].includes(role)) throw new Error("Invalid platform host role");
  const portKey = service === "website" ? "WEBSITE_PORT" : role === "lawyer" ? "LAWYER_PORT" : role === "status" ? "STATUS_PORT" : "PORT";
  const port = Number(environment[portKey] ?? ({PORT:3000, WEBSITE_PORT:3001, LAWYER_PORT:3003, STATUS_PORT:3004}[portKey]));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid application port");
  const privateMode = environment.PRIVATE_DEVELOPMENT === "true";
  if (privateMode && role !== "app") throw new Error("Additional domains require public deployment configuration");
  if (privateMode) return { port, privateMode, origin: `http://localhost:${port}`, hosts: [`localhost:${port}`, `127.0.0.1:${port}`], lawyerOrigin: undefined, statusOrigin: undefined };
  if (environment.NODE_ENV !== "production" || !["production", "staging"].includes(environment.DEPLOYMENT_ENVIRONMENT ?? "")) {
    throw new Error("Public services require an explicit production or staging deployment");
  }
  const origin = publicOrigin(environment[service === "platform" ? "APP_URL" : "PUBLIC_SITE_URL"] ?? "");
  const lawyerOrigin = service === "platform" && environment.LAWYER_URL ? publicOrigin(environment.LAWYER_URL).origin : undefined;
  const statusOrigin = service === "platform" && environment.STATUS_URL ? publicOrigin(environment.STATUS_URL).origin : undefined;
  const origins = [origin.origin, lawyerOrigin, statusOrigin].filter(value => value !== undefined);
  if (new Set(origins).size !== origins.length) throw new Error("Application, lawyer and status origins must be distinct");
  const listenerOrigin = role === "lawyer" ? lawyerOrigin : role === "status" ? statusOrigin : origin.origin;
  if (!listenerOrigin) throw new Error("Platform host role requires its configured origin");
  return { port, privateMode, origin: listenerOrigin, hosts: [new URL(listenerOrigin).host], lawyerOrigin, statusOrigin };
}

/** @param {string} value */
function publicOrigin(value) {
  const origin = new URL(value);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.port || origin.pathname !== "/" || origin.search || origin.hash || isIP(origin.hostname) || !origin.hostname.includes(".")) {
    throw new Error("Public services require a canonical HTTPS origin");
  }
  return origin;
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
  const origin = config.privateMode ? config.origin : `https://${request.headers.host}`;
  const url = new URL(path, origin);
  if (url.origin !== origin) return null;
  for (const name of Object.keys(request.headers)) {
    if (name.startsWith("cf-") || name.startsWith("x-forwarded-")
      || ["x-juro-client-ip", "x-juro-status-origin", "x-juro-lawyer-host", "x-juro-request-path", "forwarded", "x-real-ip"].includes(name)) delete request.headers[name];
  }
  request.headers["x-juro-client-ip"] = config.privateMode ? peer : proxyIp;
  request.headers["x-forwarded-proto"] = config.privateMode ? "http" : "https";
  request.headers["x-forwarded-host"] = request.headers.host;
  return url;
}
