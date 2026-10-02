import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { nativeListenerReady, nativeAdminHealthReady, verifyNativeAdminBoundary } from "./native-readiness.mjs";
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


test("admin readiness requires the expected environment and a valid health payload", () => {
  const response = {status:200,body:JSON.stringify({status:"ok",environment:"production"})};
  assert.equal(nativeAdminHealthReady(response,"production"),true);
  assert.equal(nativeAdminHealthReady(response,"staging"),false);
  assert.equal(nativeAdminHealthReady({...response,status:503},"production"),false);
  assert.equal(nativeAdminHealthReady({...response,body:"<html>login</html>"},"production"),false);
  assert.equal(nativeAdminHealthReady({...response,body:JSON.stringify({status:"failed",environment:"production"})},"production"),false);
});

test("admin qualification accepts the current login boundary and rejects the obsolete redirect or open API", async () => {
  const responses = {
    "/":{status:303,headers:{location:"/login"},body:""},
    "/login":{status:200,headers:{},body:'<h1>Control Center</h1><input name="email" type="email">'},
    "/api/overview":{status:403,headers:{},body:JSON.stringify({code:"ACCESS_DENIED"})},
  };
  const calls=[];
  await verifyNativeAdminBoundary(async path => {calls.push(path);return responses[path];});
  assert.deepEqual(calls,["/","/login","/api/overview"]);
  const changed = (path, response) => name => Promise.resolve(name===path?response:responses[name]);
  await assert.rejects(verifyNativeAdminBoundary(changed("/",{status:303,headers:{location:"https://app.juro.uz/ru/admin/console?reason=admin-session"}})),/local login/);
  await assert.rejects(verifyNativeAdminBoundary(changed("/login",{status:200,body:"unrelated page"})),/login form/);
  await assert.rejects(verifyNativeAdminBoundary(changed("/api/overview",{status:200,body:"{}"})),/reject unauthenticated/);
  await assert.rejects(verifyNativeAdminBoundary(changed("/api/overview",{status:403,body:"not JSON"})),/must be JSON/);
});
