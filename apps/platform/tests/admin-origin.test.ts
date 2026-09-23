import assert from "node:assert/strict";
import test from "node:test";
import {validAdminOrigin} from "../lib/auth/admin-origin";

test("HTTP admin handoffs require the explicit private development boundary", () => {
  const previous=process.env.PRIVATE_DEVELOPMENT;
  try {
    process.env.PRIVATE_DEVELOPMENT="true";
    assert.equal(validAdminOrigin(new URL("http://localhost:3002"),"development"),true);
    for(const environment of ["staging","production",undefined])assert.equal(validAdminOrigin(new URL("http://localhost:3002"),environment),false);
    for(const address of ["http://remote.example:3002","http://localhost:3002/path","http://localhost:3002?redirect=remote","http://user@localhost:3002"])assert.equal(validAdminOrigin(new URL(address),"development"),false);
    process.env.PRIVATE_DEVELOPMENT="false";
    assert.equal(validAdminOrigin(new URL("http://localhost:3002"),"development"),false);
    assert.equal(validAdminOrigin(new URL("https://admin.example"),"production"),true);
  } finally {if(previous===undefined)delete process.env.PRIVATE_DEVELOPMENT;else process.env.PRIVATE_DEVELOPMENT=previous}
});
