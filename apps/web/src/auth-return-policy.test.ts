import assert from "node:assert/strict";
import test from "node:test";
import {
  isApprovedAccountCallbackTransport,
  parseApprovedAuthReturn,
  parseAuthProviderError
} from "./auth-return-policy.ts";

const AUTH_STATE = "0123456789abcdef0123456789abcdef";
const FLOW_ID = "abcdef0123456789abcdef0123456789";

test("accepts each callback intent and the existing billing/account tuple", () => {
  assert.deepEqual(parseApprovedAuthReturn(new URLSearchParams("account=signin")), { account: "signin" });
  assert.deepEqual(
    parseApprovedAuthReturn(new URLSearchParams("account=signin&provider=google")),
    { account: "signin", provider: "google" }
  );
  assert.deepEqual(
    parseApprovedAuthReturn(new URLSearchParams(`account=signin&state=${AUTH_STATE}&code=oauth-code&sb_flow_id=${FLOW_ID}`)),
    { account: "signin", state: AUTH_STATE, code: "oauth-code", flowId: FLOW_ID }
  );
  assert.deepEqual(parseApprovedAuthReturn(new URLSearchParams(`account=signin&state=${AUTH_STATE}&code=oauth-code`)), { account: "signin", state: AUTH_STATE, code: "oauth-code" });
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
    "account=signin&provider=github",
    "provider=google",
    "account=signin&provider=google&state=" + AUTH_STATE,
    "account=signin&code=oauth-code",
    "account=signin&state=" + AUTH_STATE + "&code=",
    "account=signin&state=" + AUTH_STATE + "&code=oauth-code&provider=google",
    "account=signin&state=" + AUTH_STATE + "&code=oauth-code&sb_flow_id=short",
    "account=signin&state=" + AUTH_STATE + "&recovery=1"
  ]) {
    assert.equal(parseApprovedAuthReturn(new URLSearchParams(query)), null, query);
  }
});

test("allows a PKCE code callback without an implicit-flow hash", () => {
  const callback = parseApprovedAuthReturn(
    new URLSearchParams(`account=signin&state=${AUTH_STATE}&code=oauth-code&sb_flow_id=${FLOW_ID}`)
  );
  assert.equal(isApprovedAccountCallbackTransport(callback, false), true);
  assert.equal(isApprovedAccountCallbackTransport(callback, true), false);
  assert.equal(
    isApprovedAccountCallbackTransport(
      parseApprovedAuthReturn(new URLSearchParams(`account=signin&state=${AUTH_STATE}`)),
      false
    ),
    false
  );
});

test("accepts a Supabase provider error without classifying it as a magic-link callback", () => {
  assert.deepEqual(
    parseAuthProviderError(new URLSearchParams(
      `account=signin&state=${AUTH_STATE}&error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code&sb_flow_id=${FLOW_ID}`
    )),
    {
      account: "signin",
      state: AUTH_STATE,
      flowId: FLOW_ID,
      error: "server_error",
      errorCode: "unexpected_failure",
      errorDescription: "Unable to exchange external code"
    }
  );
  assert.equal(parseAuthProviderError(new URLSearchParams("error=access_denied&error_description=cancelled"))?.error, "access_denied");
});

test("rejects unsafe or mixed provider errors", () => {
  for (const query of [
    `account=signin&state=${AUTH_STATE}&error=server_error&unknown=value`,
    `account=signin&state=${AUTH_STATE}&error=server.error`,
    `state=${AUTH_STATE}&error=server_error`,
    `account=signin&error=server_error&sb_flow_id=${FLOW_ID}`
  ]) {
    assert.equal(parseAuthProviderError(new URLSearchParams(query)), null, query);
  }
});
