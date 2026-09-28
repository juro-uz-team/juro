import assert from "node:assert/strict";
import test from "node:test";
import { publicDnsReady, validatePublicHosts } from "./public-dns-readiness.mjs";

const resolver = (v4, v6 = []) => ({ resolve4: async () => v4, resolve6: async () => v6 });
test("activation waits for every resolver and rejects stale IPv4 or IPv6 destinations", async () => {
  const hosts = ["juro.uz", "app.juro.uz"];
  assert.equal(await publicDnsReady(hosts, ["92.5.9.31"], [resolver(["92.5.9.31"])]), true);
  assert.equal(await publicDnsReady(hosts, ["92.5.9.31"], [resolver(["92.5.9.31"]), resolver(["192.0.2.1"])]), false);
  assert.equal(await publicDnsReady(hosts, ["92.5.9.31"], [resolver(["92.5.9.31"], ["2001:db8::1"])]), false);
  assert.equal(await publicDnsReady(hosts, ["92.5.9.31"], [resolver([])]), false);
});
test("missing address families are allowed, but resolver failures and a missing host delay activation", async () => {
  const missing = code => { throw Object.assign(Error(), { code }); };
  assert.equal(await publicDnsReady(["juro.uz"], ["92.5.9.31"], [{resolve4: async () => ["92.5.9.31"], resolve6: async () => missing("ENODATA")}]), true);
  assert.equal(await publicDnsReady(["juro.uz"], ["92.5.9.31"], [{resolve4: async () => missing("ETIMEOUT"), resolve6: async () => []}]), false);
  assert.equal(await publicDnsReady(["juro.uz", "app.juro.uz"], ["92.5.9.31"], [{resolve4: async host => host === "juro.uz" ? ["92.5.9.31"] : [], resolve6: async () => []}]), false);
});
test("empty or malformed activation configuration fails closed", async () => {
  for (const hosts of [[], ["https://juro.uz"], ["juro.uz", "juro.uz"], ["*.juro.uz"]]) assert.throws(() => validatePublicHosts(hosts, ["92.5.9.31"]));
  assert.throws(() => validatePublicHosts(["juro.uz"], []));
  await assert.rejects(publicDnsReady(["juro.uz"], ["92.5.9.31"], []));
});
