import assert from "node:assert/strict";
import test from "node:test";
import { shouldTrackVerifiedSession } from "./session-analytics-policy.ts";

test("tracks the first verified session for an account", () => {
  assert.equal(shouldTrackVerifiedSession(null, "user-1"), true);
});

test("does not retrack the same verified session user", () => {
  assert.equal(shouldTrackVerifiedSession("user-1", "user-1"), false);
});

test("allows a later account session after sign-out", () => {
  assert.equal(shouldTrackVerifiedSession(null, "user-2"), true);
  assert.equal(shouldTrackVerifiedSession("user-1", null), false);
});
