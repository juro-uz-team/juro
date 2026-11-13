import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { env } from "./helpers/runtime-env";
import { publicProfileMediaIndexing, publicProfilePhotoRequest } from "../lib/platform/public-profile-media";
import robots from "../app/robots";
import { GET } from "../app/api/public/lawyers/[profileId]/photo/route";

const id = "aab13152-a225-4c1c-afd3-fb2475ae31ee";
const path = `/api/public/lawyers/${id}/photo`;
const production = { DEPLOYMENT_ENVIRONMENT: "production", PRIVATE_DEVELOPMENT: "false", PLATFORM_HOST_ROLE: "app" };
const previous = Object.fromEntries(Object.keys(production).map(key => [key, process.env[key]]));
const bytes = new Uint8Array([1, 2, 3]);
let published = true, objectSize = bytes.length, bucketReads = 0;
let queries: string[] = [];
beforeEach(() => {
  Object.assign(process.env, production);
  published = true; objectSize = bytes.length; bucketReads = 0; queries = [];
  env.DB = { prepare: (sql: string) => {
    queries.push(sql);
    return { bind: (value: string) => {
      assert.equal(value, id);
      return { first: async () => published ? { profilePhotoKey: "approved-photo", profilePhotoMime: "image/png", profilePhotoSha256: "published-sha256", profilePhotoSizeBytes: bytes.length } : null };
    } };
  } };
  env.BUCKET = { get: async (key: string) => { bucketReads++; assert.equal(key, "approved-photo"); return { size: objectSize, body: bytes, httpEtag: "published-etag" }; } };
});
after(() => {
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  delete env.DB; delete env.BUCKET;
});

test("only the canonical public photo path can opt out of the private-server indexing default", () => {
  assert.equal(publicProfilePhotoRequest({ method: "GET", url: path }, production), true);
  assert.equal(publicProfilePhotoRequest({ method: "HEAD", url: path + "?version=1" }, production), true);
  for (const url of ["/en/auth/login", "/api/platform/documents/private/photo", "/api/public/lawyers", path + "/private", "/api/public/lawyers/not-a-uuid/photo", "/api/public/lawyers/../photo"]) {
    assert.equal(publicProfilePhotoRequest({ method: "GET", url }, production), false, url);
  }
  assert.equal(publicProfilePhotoRequest({ method: "POST", url: path }, production), false);
  for (const environment of [{ ...production, DEPLOYMENT_ENVIRONMENT: "staging" }, { ...production, PRIVATE_DEVELOPMENT: "true" }, { ...production, PLATFORM_HOST_ROLE: "lawyer" }, { ...production, PLATFORM_HOST_ROLE: "status" }]) {
    assert.equal(publicProfileMediaIndexing(environment), false);
    assert.equal(publicProfilePhotoRequest({ method: "GET", url: path }, environment), false);
  }
});

test("robots permit public profile images without permitting application pages", () => {
  const rules = robots().rules;
  assert.deepEqual(rules, { userAgent: "*", disallow: "/", allow: "/api/public/lawyers/*/photo" });
  process.env.DEPLOYMENT_ENVIRONMENT = "staging";
  assert.deepEqual(robots().rules, { userAgent: "*", disallow: "/" });
});

test("an approved public photo may be indexed only after publication and object checks", async () => {
  const response = await GET(new Request("https://app.juro.uz" + path), { params: Promise.resolve({ profileId: id }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), "index, follow");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.match(queries[0], /status='public_approved'/);
  assert.match(queries[0], /marketplace_status='public_approved'/);
  assert.match(queries[0], /public_approved_at IS NOT NULL/);
  process.env.DEPLOYMENT_ENVIRONMENT = "staging";
  const staging = await GET(new Request("https://staging.app.juro.uz" + path), { params: Promise.resolve({ profileId: id }) });
  assert.match(staging.headers.get("x-robots-tag") ?? "", /noindex/);
});

test("unpublished, invalid and incomplete photos remain unavailable and nonindexable", async () => {
  published = false;
  const missing = await GET(new Request("https://app.juro.uz" + path), { params: Promise.resolve({ profileId: id }) });
  assert.equal(missing.status, 404); assert.match(missing.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.equal(bucketReads, 0);
  published = true; objectSize = 1;
  const incomplete = await GET(new Request("https://app.juro.uz" + path), { params: Promise.resolve({ profileId: id }) });
  assert.equal(incomplete.status, 404); assert.match(incomplete.headers.get("x-robots-tag") ?? "", /noindex/);
  queries = [];
  const invalid = await GET(new Request("https://app.juro.uz" + path), { params: Promise.resolve({ profileId: "private" }) });
  assert.equal(invalid.status, 404); assert.equal(queries.length, 0);
});
