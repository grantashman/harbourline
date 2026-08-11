export interface ExistingBillingSubscription {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface BillingReconciliationResult {
  active: boolean;
  reconciled: boolean;
  subscription: ExistingBillingSubscription | null;
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/**
 * A successful Stripe lookup with no matching subscription is a resolved free
 * account, not a billing lookup that is still in progress.
 */
export function noSubscriptionReconciliation(
  existingBilling: ExistingBillingSubscription | null
): BillingReconciliationResult {
  return {
    active: Boolean(existingBilling && ACTIVE_STATUSES.has(existingBilling.status)),
    reconciled: true,
    subscription: existingBilling
  };
}
