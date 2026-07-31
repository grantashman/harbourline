export type BetaOnboardingStep = "household" | "income" | "bills" | "payday" | "complete";

export type BetaEventName =
  | "onboarding_started"
  | "household_created"
  | "income_added"
  | "five_bills_added"
  | "payday_viewed"
  | "onboarding_completed"
  | "support_requested";

export interface BetaOnboardingProgress {
  householdId: string | null;
  step: BetaOnboardingStep;
  completedAt: string | null;
}

export interface BetaOperationsSnapshot {
  daily: Array<{ day: string; eventName: string; count: number }>;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  cancelledSubscriptions: number;
}
