import assert from "node:assert/strict";
import test from "node:test";
import { parseApprovedAuthReturn } from "./auth-return-policy.ts";

const AUTH_STATE = "0123456789abcdef0123456789abcdef";

test("accepts each callback intent and the existing billing/account tuple", () => {
  assert.deepEqual(parseApprovedAuthReturn(new URLSearchParams("account=signin")), { account: "signin" });
  assert.deepEqual(parseApprovedAuthReturn(new URLSearchParams(`account=signin&state=${AUTH_STATE}`)), { account: "signin", state: AUTH_STATE });
  assert.deepEqual(parseApprovedAuthReturn(new URLSearchParams(`recovery=1&state=${AUTH_STATE}`)), { recovery: "1", state: AUTH_STATE });
  assert.deepEqual(parseApprovedAuthReturn(new URLSearchParams("billing=success")), { billing: "success" });
  assert.deepEqual(parseApprovedAuthReturn(new URLSearchParams("calendar=error")), { calendar: "error" });
  assert.deepEqual(
    parseApprovedAuthReturn(new URLSearchParams("billing=success&account=signin")),
    { account: "signin", billing: "success" }
  );
});

test("rejects duplicate, unknown, and mixed-intent callbacks", () => {
  for (const query of [
    "account=signin&account=signin",
    "billing=success&recovery=1",
    "account=signin&calendar=connected",
    "billing=success&unknown=value",
    "billing=unexpected",
    "recovery=1&utm_source=mail",
    "account=signin&state=short",
    "account=signin&state=" + AUTH_STATE + "&recovery=1"
  ]) {
    assert.equal(parseApprovedAuthReturn(new URLSearchParams(query)), null, query);
  }
});