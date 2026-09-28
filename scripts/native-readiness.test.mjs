import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { nativeListenerReady } from "./native-readiness.mjs";
import { nativeHttpConfiguration, normalizeNativeRequest } from "./native-http.mjs";

test("readiness reaches the real public Host gate over loopback", async () => {
  const config = nativeHttpConfiguration({NODE_ENV:"production",DEPLOYMENT_ENVIRONMENT:"production",APP_URL:"https://app.juro.uz"},"platform");
  const server = createServer((request,response) => {
    const accepted = normalizeNativeRequest(request,config);
    response.writeHead(accepted && request.url === "/robots.txt" ? 200 : 403);
    response.end();
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const port = server.address().port;
  try {
    assert.equal(await nativeListenerReady(port,"/robots.txt",{host:"app.juro.uz","x-real-ip":"127.0.0.1"}),true);
    assert.equal(await nativeListenerReady(port,"/robots.txt",{host:"wrong.example","x-real-ip":"127.0.0.1"}),false);
    assert.equal(await nativeListenerReady(port,"/robots.txt"),false);
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await nativeListenerReady(port,"/robots.txt"),false);
});

test("readiness times out a listener that does not respond", async () => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  try { assert.equal(await nativeListenerReady(server.address().port,"/robots.txt"),false); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
