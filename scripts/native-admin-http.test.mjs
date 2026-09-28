import assert from "node:assert/strict";
import test from "node:test";
import { nativeAdminOrigin, nativeAdminRequestUrl } from "./native-admin-http.mjs";

test("native admin environments have distinct same-site HTTPS cookie hosts", () => {
  assert.equal(nativeAdminOrigin({DEPLOYMENT_ENVIRONMENT:"production"}), "https://admin.juro.uz:3443");
  assert.equal(nativeAdminOrigin({DEPLOYMENT_ENVIRONMENT:"staging"}), "https://admin.staging.juro.uz:3444");
  assert.equal(nativeAdminOrigin({PRIVATE_DEVELOPMENT:"true", ADMIN_PORT:"3102"}), "http://localhost:3102");
  assert.equal(nativeAdminOrigin({PUBLIC_SITE_URL:"https://preview.example.org"}), "https://admin.preview.example.org:3443");
  for (const origin of ["http://localhost:3002", "https://juro-admin.localhost:3443", "https://external.example", "https://localhost.example", "https://user@localhost", "https://localhost/path", "https://localhost?q=1", "https://admin.staging.juro.uz:3444"]) {
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
