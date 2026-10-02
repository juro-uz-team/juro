import assert from "node:assert/strict";
import test from "node:test";
import { adminEmail } from "../lib/auth/control-admin-auth";

test("control administrator mailbox uses the approved default and preserves runtime configuration", () => {
  const previous = process.env.ADMIN_ALLOWED_EMAIL;
  try {
    delete process.env.ADMIN_ALLOWED_EMAIL;
    assert.equal(adminEmail(), "muzaffarbekmurodoff@gmail.com");
    assert.notEqual(adminEmail(), "muzaffarbekmurodov@gmail.com");

    process.env.ADMIN_ALLOWED_EMAIL = " Operator@Example.com ";
    assert.equal(adminEmail(), "operator@example.com");
  } finally {
    if (previous === undefined) delete process.env.ADMIN_ALLOWED_EMAIL;
    else process.env.ADMIN_ALLOWED_EMAIL = previous;
  }
});
