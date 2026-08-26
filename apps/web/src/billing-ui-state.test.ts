import assert from "node:assert/strict";
import test from "node:test";
import {
  billingRefreshNotice,
  resolveBillingPlanState,
  shouldOpenFreeStarter
} from "./billing-ui-state.ts";

test("shows checking only while billing reconciliation is still unresolved", () => {
  assert.equal(resolveBillingPlanState({
    billingReconciled: false,
    subscriptionActive: null,
    billingConfirmationPending: false,
    paymentNeedsAttention: false,
    billingLookupError: false
  }), "checking");
});

test("shows an actionable error when billing lookup fails", () => {
  assert.equal(resolveBillingPlanState({
    billingReconciled: false,
    subscriptionActive: null,
    billingConfirmationPending: false,
    paymentNeedsAttention: false,
    billingLookupError: true
  }), "error");
});

test("treats a concrete but unreconciled negative result as an actionable error", () => {
  assert.equal(resolveBillingPlanState({
    billingReconciled: false,
    subscriptionActive: false,
    billingConfirmationPending: false,
    paymentNeedsAttention: false,
    billingLookupError: false
  }), "error");
});

test("keeps a resolved free account out of checking", () => {
  assert.equal(resolveBillingPlanState({
    billingReconciled: true,
    subscriptionActive: false,
    billingConfirmationPending: false,
    paymentNeedsAttention: false,
    billingLookupError: false
  }), "not-started");
});

test("preserves active and payment-attention states", () => {
  assert.equal(resolveBillingPlanState({
    billingReconciled: true,
    subscriptionActive: true,
    billingConfirmationPending: false,
    paymentNeedsAttention: false,
    billingLookupError: false
  }), "active");
  assert.equal(resolveBillingPlanState({
    billingReconciled: true,
    subscriptionActive: false,
    billingConfirmationPending: false,
    paymentNeedsAttention: true,
    billingLookupError: false
  }), "attention");
});

test("uses an outcome-specific retry notice", () => {
  assert.equal(
    billingRefreshNotice("not-started"),
    "No active subscription found. Your local starter remains available on this device."
  );
  assert.equal(
    billingRefreshNotice("attention"),
    "Payment needs attention. Manage your subscription to update your payment method."
  );
  assert.equal(
    billingRefreshNotice("error"),
    "We couldn’t check your cloud plan. Your local starter remains available; retry when you’re ready."
  );
});

test("opens Getting Started only for a confirmed free account or billing lookup failure", () => {
  const base = {
    billingReconciled: true,
    subscriptionActive: false,
    billingConfirmationPending: false,
    paymentNeedsAttention: false,
    billingLookupError: false
  };
  assert.equal(shouldOpenFreeStarter(base), true);
  assert.equal(shouldOpenFreeStarter({ ...base, billingConfirmationPending: true }), false);
  assert.equal(shouldOpenFreeStarter({ ...base, paymentNeedsAttention: true }), false);
  assert.equal(shouldOpenFreeStarter({ ...base, billingReconciled: false }), false);
  assert.equal(shouldOpenFreeStarter({ ...base, billingLookupError: true }), true);
});
