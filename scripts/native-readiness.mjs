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
