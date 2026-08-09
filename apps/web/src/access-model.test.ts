import assert from "node:assert/strict";
import test from "node:test";
import { isVerifiedAccountUser, resolveWorkspaceAccess } from "./access-model.ts";

test("only non-anonymous Supabase users count as verified accounts", () => {
  assert.equal(isVerifiedAccountUser({ is_anonymous: false }), true);
  assert.equal(isVerifiedAccountUser({ is_anonymous: true }), false);
  assert.equal(isVerifiedAccountUser({}), false);
  assert.equal(isVerifiedAccountUser(null), false);
});

test("active signed-in members receive paid workspace access", () => {
  assert.equal(resolveWorkspaceAccess({ signedIn: true, billingReconciled: true, subscriptionActive: true }), "paid");
});

test("anonymous visitors must authenticate before receiving starter access", () => {
  assert.equal(resolveWorkspaceAccess({ signedIn: false, billingReconciled: false, subscriptionActive: null }), "signed-out");
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
