import assert from "node:assert/strict";
import test from "node:test";
import { shouldOpenAccountPanelForAuthResult } from "./account-entry-policy.ts";

const base = {
  authCallbackRejected: false,
  plainAccountNavigation: false,
  providerError: false,
  dialogOpen: false
};

test("opens the sign-in panel for plain account navigation", () => {
  assert.equal(shouldOpenAccountPanelForAuthResult({
    ...base,
    plainAccountNavigation: true
  }), true);
});

test("does not reopen the account panel for an accepted auth callback", () => {
  assert.equal(shouldOpenAccountPanelForAuthResult(base), false);
});

test("keeps the account panel available for a rejected auth callback", () => {
  assert.equal(shouldOpenAccountPanelForAuthResult({
    ...base,
    authCallbackRejected: true
  }), true);
});

test("opens the account panel for a provider error with its notice", () => {
  assert.equal(shouldOpenAccountPanelForAuthResult({
    ...base,
    providerError: true
  }), true);
});

test("does not reopen an already open account panel", () => {
  assert.equal(shouldOpenAccountPanelForAuthResult({
    ...base,
    authCallbackRejected: true,
    dialogOpen: true
  }), false);
});
