import assert from "node:assert/strict";
import test from "node:test";
import { resolveBillingPlanState } from "./billing-ui-state.ts";

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
