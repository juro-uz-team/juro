import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createPreparedTransportPair } from "../lib/legal-answer-workflow/prepared-transport";

test("full source reads use their own authenticated worker without changing candidate discovery", async () => {
  const calls: string[] = [];
  async function worker(name: string, token: string, pin: string) {
    const server = createServer((request, response) => {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      calls.push(`${name}${request.url}`);
      request.resume();
      response.writeHead(200, { "Content-Type": "application/json", "X-Juro-Worker-Sha256": pin });
      response.end(JSON.stringify({ worker: name }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return { server, configuration: { url: `http://127.0.0.1:${address.port}`, token, workerSha256: pin } };
  }
  const discovery = await worker("discovery", "d".repeat(32), "a".repeat(64));
  const sources = await worker("sources", "s".repeat(32), "b".repeat(64));
  try {
    const transport = createPreparedTransportPair({ discovery: discovery.configuration, sources: sources.configuration });
    const hash = "c".repeat(64);
    const artifacts = { packageSha256: hash, vectorCompletionSha256: hash, vectorIdentitySha256: hash,
      membershipSha256: hash, workIndexSha256: hash, navigationSha256: hash, sparseSha256: hash };
    const signal = AbortSignal.timeout(3000);
    assert.deepEqual(await transport.readExact({ artifacts, references: [[1, 2]] }, signal), { worker: "discovery" });
    assert.deepEqual(await transport.readSources({ artifacts, works: ["work"] }, signal), { worker: "sources" });
    assert.deepEqual(await transport.readAsset({ artifacts, work: hash }, signal), { worker: "sources" });
    assert.deepEqual(calls, ["discovery/read-exact", "sources/read-sources", "sources/read-asset"]);
  } finally {
    await Promise.all([discovery.server, sources.server].map(server => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()))));
  }
});
