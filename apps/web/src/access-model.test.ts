import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceAccess } from "./access-model.ts";

test("active signed-in members receive paid workspace access", () => {
  assert.equal(resolveWorkspaceAccess({ signedIn: true, billingReconciled: true, subscriptionActive: true }), "paid");
});

test("anonymous visitors receive local starter access", () => {
  assert.equal(resolveWorkspaceAccess({ signedIn: false, billingReconciled: false, subscriptionActive: null }), "free");
});

test("signed-in accounts without an active subscription remain local-only", () => {
  assert.equal(resolveWorkspaceAccess({ signedIn: true, billingReconciled: true, subscriptionActive: false }), "free");
});

test("plan checks fail closed while subscription status is loading", () => {
  assert.equal(resolveWorkspaceAccess({ signedIn: true, billingReconciled: false, subscriptionActive: null }), "free");
});

test("active rows remain local-only until billing is reconciled", () => {
  assert.equal(resolveWorkspaceAccess({ signedIn: true, billingReconciled: false, subscriptionActive: true }), "free");
});
