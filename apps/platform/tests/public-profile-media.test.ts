import assert from "node:assert/strict";
import test from "node:test";
import { env } from "./helpers/runtime-env";
import robots from "../app/robots";
import { GET } from "../app/api/platform/lawyers/[lawyerId]/photo/route";

test("workspace profile photos require authentication before reading stored media", async () => {
  const lawyerId = "aab13152-a225-4c1c-afd3-fb2475ae31ee";
  let bucketReads = 0;
  env.BUCKET = { get: async () => { bucketReads++; } };
  try {
    const response = await GET(new Request(`https://app.juro.uz/api/platform/lawyers/${lawyerId}/photo`), { params: Promise.resolve({ lawyerId }) });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(bucketReads, 0);
  } finally {
    delete env.BUCKET;
  }
});

test("robots close the app host to search crawlers", () => {
  assert.deepEqual(robots().rules, { userAgent: "*", disallow: "/" });
});
