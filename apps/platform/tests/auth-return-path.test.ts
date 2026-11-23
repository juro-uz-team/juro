import assert from "node:assert/strict";
import { test } from "node:test";

import { authReturnDestination, safeAuthReturnPath } from "../lib/auth/return-path";

test("authentication keeps a local tool and its options", () => {
  const compare = "/uz/individual/document-review?mode=compare#result";
  assert.equal(authReturnDestination("/uz/individual/dashboard", compare), compare);
  assert.equal(
    authReturnDestination("https://lawyer.juro.uz/en/dashboard", "/en/workspace/consultation-schedule"),
    "https://lawyer.juro.uz/en/workspace/consultation-schedule",
  );
  assert.equal(
    authReturnDestination("https://lawyer.juro.uz/en/dashboard", compare),
    "https://lawyer.juro.uz/en/dashboard",
  );
});

test("return destinations reject external URLs and authentication loops", () => {
  for (const path of ["https://external.example", "//external.example", "/\\external.example", "/x/..//external.example", "/%2fexternal.example", "/%61pi/auth/logout", "/en/login", "/uz/auth/register", "/callback"]) {
    assert.equal(safeAuthReturnPath(path), null, path);
  }
});
