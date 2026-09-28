import assert from "node:assert/strict";
import test from "node:test";
import { nativeHttpConfiguration, normalizeNativeRequest } from "./native-http.mjs";
const environment = { NODE_ENV: "production", DEPLOYMENT_ENVIRONMENT: "production", APP_URL: "https://app.juro.uz" };
const config = nativeHttpConfiguration(environment, "platform");
function request(headers = {}, peer = "127.0.0.1", url = "/ru/login") {
  return { headers: { host: "app.juro.uz", "x-real-ip": "203.0.113.1", ...headers }, socket: { remoteAddress: peer }, url };
}
test("public listeners require explicit environment and canonical HTTPS origin", () => {
  for (const change of [{NODE_ENV:"development"}, {DEPLOYMENT_ENVIRONMENT:""}, {APP_URL:"http://app.juro.uz"}, {APP_URL:"https://app.juro.uz/path"}]) assert.throws(() => nativeHttpConfiguration({...environment,...change}, "platform"));
});
test("only the local proxy with the exact host and one valid client IP is accepted", () => {
  for (const req of [request({},"203.0.113.2"),request({host:"evil.example"}), request({"x-real-ip":undefined}), request({"x-real-ip":"1.1.1.1,2.2.2.2"}),request({},"127.0.0.1","//evil.example/")]) assert.equal(normalizeNativeRequest(req, config),null);
  const req=request({"cf-connecting-ip":"1.2.3.4","x-juro-client-ip":"1.2.3.4","x-forwarded-host":"evil.example","x-forwarded-proto":"http","x-juro-status-origin":"https://evil.example","x-juro-csrf":"1"});
  assert.equal(normalizeNativeRequest(req,config)?.origin,"https://app.juro.uz");
  assert.equal(req.headers["x-juro-client-ip"],"203.0.113.1");
  assert.equal(req.headers["x-forwarded-proto"],"https");
  assert.equal(req.headers["x-forwarded-host"],"app.juro.uz");
  assert.equal(req.headers["cf-connecting-ip"],undefined);
  assert.equal(req.headers["x-juro-status-origin"],undefined);
  assert.equal(req.headers["x-juro-csrf"],"1");
});
test("private SSH mode retains localhost access and rejects a public hostname", () => {
  const local=nativeHttpConfiguration({PRIVATE_DEVELOPMENT:"true"},"platform");
  assert.equal(normalizeNativeRequest(request(),local),null);
  assert.equal(normalizeNativeRequest(request({host:"localhost:3000","x-real-ip":undefined}),local)?.origin,"http://localhost:3000");
});
