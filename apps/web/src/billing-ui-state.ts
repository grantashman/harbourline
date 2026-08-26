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
