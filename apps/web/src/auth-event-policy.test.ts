import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldNotifySignupForAuthEvent,
  shouldPreserveRecoveryForSession
} from "./auth-event-policy.ts";

test("initial session hydration never sends a signup notification", () => {
  assert.equal(shouldNotifySignupForAuthEvent("INITIAL_SESSION", false, false), false);
});

test("signed-in events can retry an unsent signup notification", () => {
  assert.equal(shouldNotifySignupForAuthEvent("SIGNED_IN", false, false), true);
});

test("recovery events never send a signup notification", () => {
  assert.equal(shouldNotifySignupForAuthEvent("SIGNED_IN", true, true), false);
  assert.equal(shouldNotifySignupForAuthEvent("PASSWORD_RECOVERY", false, true), false);
});

test("recovery state suppresses a later signed-in event after password update", () => {
  assert.equal(shouldNotifySignupForAuthEvent("SIGNED_IN", false, false, "user-a", "user-a"), false);
  assert.equal(shouldNotifySignupForAuthEvent("SIGNED_IN", false, false, "user-a", "user-b"), true);
});

test("normal auth events do not bind a recovery marker to an account", () => {
  assert.equal(shouldPreserveRecoveryForSession(true, null, "user-a", "SIGNED_IN"), false);
  assert.equal(shouldPreserveRecoveryForSession(true, "user-a", "user-a", "TOKEN_REFRESHED"), false);
  assert.equal(shouldPreserveRecoveryForSession(true, "user-b", "user-a", "PASSWORD_RECOVERY"), true);
});

test("recovery state is preserved during initial hydration", () => {
  assert.equal(shouldPreserveRecoveryForSession(true, null, "user-a"), true);
  assert.equal(shouldPreserveRecoveryForSession(true, "user-a", "user-a"), true);
  assert.equal(shouldPreserveRecoveryForSession(true, "user-a", "user-b"), false);
});
