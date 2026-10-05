import { request } from "node:http";

/** Probe the loopback listener while preserving its canonical public Host.
 * @param {number|string} port
 * @param {string} path
 * @param {Record<string,string>} headers
 * @returns {Promise<boolean>}
 */
export function nativeListenerReady(port, path, headers = {}) {
  return new Promise(resolve => {
    const probe = request({hostname:"127.0.0.1",port,path,headers,signal:AbortSignal.timeout(1000)}, response => {
      response.resume();
      response.on("error", () => resolve(false));
      response.on("end", () => resolve(response.statusCode >= 200 && response.statusCode < 400));
    });
    probe.on("error", () => resolve(false));
    probe.end();
  });
}

/** Exercise server-rendered authentication inside the installed service sandbox.
 * Static assets can be healthy while runtime initialization fails on every page. */
export function nativeLoginReady(port, headers = {}) {
  return new Promise(resolve => {
    const probe = request({hostname:"127.0.0.1",port,path:"/login",headers,signal:AbortSignal.timeout(10000)}, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; if (body.length > 2 * 1024 * 1024) { response.destroy(); resolve(false); } });
      response.on("error", () => resolve(false));
      response.on("end", () => resolve(response.statusCode === 200
        && /<input\b[^>]*type="email"/.test(body) && /<form\b/.test(body)
        && !body.includes("This page couldn’t load")));
    });
    probe.on("error", () => resolve(false));probe.end();
  });
}

/** Require the Control Center health contract, not merely an open listener. */
export function nativeAdminHealthReady(response, environment) {
  if (response.status !== 200) return false;
  try {
    const health = JSON.parse(response.body);
    return health.status === "ok" && health.environment === environment;
  } catch { return false; }
}

/** Public health never substitutes for the unauthenticated admin access boundary. */
export async function verifyNativeAdminBoundary(probe) {
  const root = await probe("/");
  if (root.status !== 303 || root.headers.location !== "/login") throw Error("Admin root must redirect to its local login");
  const login = await probe("/login");
  if (login.status !== 200 || !login.body.includes("Control Center") || !login.body.includes('name="email"')) throw Error("Admin login form is unavailable");
  const api = await probe("/api/overview");
  if (api.status !== 403) throw Error("Admin API must reject unauthenticated access");
  let denial;
  try { denial = JSON.parse(api.body); } catch { throw Error("Admin API denial must be JSON"); }
  if (denial.code !== "ACCESS_DENIED") throw Error("Admin API denial contract changed");
}
