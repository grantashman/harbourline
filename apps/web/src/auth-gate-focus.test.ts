import assert from "node:assert/strict";
import test from "node:test";
import { getFocusWrapTarget } from "./auth-gate-focus.ts";

test("focus trap wraps forward from the final gate action", () => {
  const first = "sign-in";
  const last = "create-account";
  assert.equal(getFocusWrapTarget([first, last], last, false), first);
});

test("focus trap wraps backward from the first gate action", () => {
  const first = "sign-in";
  const last = "create-account";
  assert.equal(getFocusWrapTarget([first, last], first, true), last);
});

test("focus trap leaves focus unchanged away from a boundary", () => {
  const first = "sign-in";
  const middle = "help";
  const last = "create-account";
  assert.equal(getFocusWrapTarget([first, middle, last], middle, false), null);
  assert.equal(getFocusWrapTarget([], null, false), null);
});
