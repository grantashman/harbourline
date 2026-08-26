import assert from "node:assert/strict";
import test from "node:test";
import { shouldOpenAccountPanelForAuthResult } from "./account-entry-policy.ts";

test("does not cover a valid auth callback with the account panel", () => {
  assert.equal(shouldOpenAccountPanelForAuthResult({ authCallbackRejected: false, dialogOpen: false }), false);
});

test("keeps the account panel available for a rejected auth callback", () => {
  assert.equal(shouldOpenAccountPanelForAuthResult({ authCallbackRejected: true, dialogOpen: false }), true);
});

test("does not reopen an already open account panel", () => {
  assert.equal(shouldOpenAccountPanelForAuthResult({ authCallbackRejected: true, dialogOpen: true }), false);
});
