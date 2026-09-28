import { isIP } from "node:net";

export function validatePublicHosts(hosts, addresses) {
  if (!Array.isArray(hosts) || !hosts.length || new Set(hosts).size !== hosts.length
    || hosts.some(host => typeof host !== "string" || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host))) {
    throw Error("Public HTTPS requires explicit distinct DNS hostnames");
  }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(address => !isIP(address))) {
    throw Error("Public HTTPS requires explicit server IP addresses");
  }
}

export async function publicDnsReady(hosts, addresses, resolvers) {
  validatePublicHosts(hosts, addresses);
  if (!resolvers.length) throw Error("At least one DNS resolver is required");
  const expected = new Set(addresses);
  const results = await Promise.all(resolvers.flatMap(resolver => hosts.map(async host => {
    try {
      const families = await Promise.all(["resolve4", "resolve6"].map(async method => {
        try { return await resolver[method](host); }
        catch (error) { if (["ENODATA", "ENOTFOUND"].includes(error.code)) return []; throw error; }
      }));
      const actual = families.flat();
      return actual.length > 0 && actual.every(address => expected.has(address));
    } catch { return false; }
  })));
  return results.every(Boolean);
}
