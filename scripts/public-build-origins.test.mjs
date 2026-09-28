import assert from "node:assert/strict";
import test from "node:test";
import { publicBuildOrigins } from "./public-build-origins.mjs";

test("public website builds use the same canonical origins as their runtime", () => {
  for (const stage of [false, true]) {
    const environment = {DEPLOYMENT_ENVIRONMENT:stage?"staging":"production",
      APP_URL:stage?"https://staging.app.juro.uz":"https://app.juro.uz",
      PUBLIC_SITE_URL:stage?"https://staging.juro.uz":"https://juro.uz"};
    assert.deepEqual(publicBuildOrigins(environment), {
      NEXT_PUBLIC_PLATFORM_ORIGIN:environment.APP_URL,NEXT_PUBLIC_WEBSITE_ORIGIN:environment.PUBLIC_SITE_URL,
    });
    assert.throws(() => publicBuildOrigins({...environment,NEXT_PUBLIC_PLATFORM_ORIGIN:"http://localhost:3000"}));
    assert.throws(() => publicBuildOrigins({...environment,APP_URL:"https://app.juro.uz/path"}));
    assert.throws(() => publicBuildOrigins({...environment,PUBLIC_SITE_URL:"http://localhost:3001"}));
  }
  assert.deepEqual(publicBuildOrigins({PRIVATE_DEVELOPMENT:"true"}), {});
});
