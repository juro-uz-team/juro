import assert from "node:assert/strict";
import test from "node:test";
import { nativeAdminOrigin, nativeAdminRequestUrl } from "./native-admin-http.mjs";

test("native admin environments have distinct HTTPS loopback cookie hosts", () => {
  assert.equal(nativeAdminOrigin({DEPLOYMENT_ENVIRONMENT:"production"}), "https://juro-admin.localhost:3443");
  assert.equal(nativeAdminOrigin({DEPLOYMENT_ENVIRONMENT:"staging"}), "https://juro-staging-admin.localhost:3444");
  assert.equal(nativeAdminOrigin({PRIVATE_DEVELOPMENT:"true", ADMIN_PORT:"3102"}), "http://localhost:3102");
  for (const origin of ["http://localhost:3002", "https://external.example", "https://localhost.example", "https://user@localhost", "https://localhost/path", "https://localhost?q=1"]) {
    assert.throws(() => nativeAdminOrigin({DEPLOYMENT_ENVIRONMENT:"production", ADMIN_CONSOLE_ORIGIN:origin}));
  }
});

test("admin handoff uses its configured HTTPS origin and rejects path origin overrides", () => {
  const origin = nativeAdminOrigin({DEPLOYMENT_ENVIRONMENT:"staging"});
  assert.equal(nativeAdminRequestUrl(origin, "/auth/handoff?ticket=test").href, origin+"/auth/handoff?ticket=test");
  for (const path of ["//external.example/", "/\\external.example/", "https://external.example/", undefined]) {
    assert.throws(() => nativeAdminRequestUrl(origin, path));
  }
});
