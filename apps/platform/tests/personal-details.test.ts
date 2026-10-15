import assert from "node:assert/strict";
import test from "node:test";
import { personalDetailsSchema } from "../lib/platform/personal-details";
test("optional personal details accept omission and clearing without inventing values", () => {
  assert.deepEqual(personalDetailsSchema.parse({ fullName: "Existing Name" }), {});
  assert.deepEqual(personalDetailsSchema.parse({ firstName: "  Komiljon ", lastName: "", middleName: "", birthDate: "", registeredAddress: "" }), { firstName: "Komiljon", lastName: "", middleName: "", birthDate: "", registeredAddress: "" });
});
test("personal details reject malformed dates, future dates, invalid types and excessive lengths", () => {
  for (const birthDate of ["2025-02-29", "2000-13-01", "2999-01-01", "01/01/2000"]) assert.equal(personalDetailsSchema.safeParse({ birthDate }).success, false);
  assert.equal(personalDetailsSchema.safeParse({ birthDate: "2000-02-29" }).success, true);
  for (const input of [{ firstName: " " }, { lastName: 42 }, { middleName: "x".repeat(81) }, { registeredAddress: "x".repeat(501) }]) assert.equal(personalDetailsSchema.safeParse(input).success, false);
});
