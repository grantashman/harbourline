export type BillingPlanState = "active" | "pending" | "checking" | "attention" | "not-started" | "error";

export interface BillingPlanStateInput {
  billingReconciled: boolean;
  subscriptionActive: boolean | null;
  billingConfirmationPending: boolean;
  paymentNeedsAttention: boolean;
  billingLookupError: boolean;
}

export function resolveBillingPlanState(input: BillingPlanStateInput): BillingPlanState {
  if (input.billingLookupError) return "error";
  if (!input.billingReconciled && input.subscriptionActive !== null && !input.billingConfirmationPending) return "error";
  if (!input.billingReconciled || input.subscriptionActive === null) return "checking";
  if (input.subscriptionActive) return "active";
  if (input.billingConfirmationPending) return "pending";
  if (input.paymentNeedsAttention) return "attention";
  return "not-started";
}

export function shouldOpenFreeStarter(input: BillingPlanStateInput): boolean {
  if (input.billingLookupError) return true;
  return Boolean(
    input.billingReconciled &&
    !input.subscriptionActive &&
    !input.billingConfirmationPending &&
    !input.paymentNeedsAttention
  );
}

export function billingRefreshNotice(state: BillingPlanState): string {
  switch (state) {
    case "active":
      return "Payment confirmed. Your Harbourline plan is active.";
    case "pending":
      return "Your payment is still being confirmed. Check again shortly.";
    case "attention":
      return "Payment needs attention. Manage your subscription to update your payment method.";
    case "error":
      return "We couldn’t check your cloud plan. Your local starter remains available; retry when you’re ready.";
    case "not-started":
      return "No active subscription found. Your local starter remains available on this device.";
    case "checking":
      return "Your plan is still being checked. Check again shortly.";
  }
}
