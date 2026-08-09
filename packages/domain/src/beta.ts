export const BETA_EVENT_NAMES = [
  "checkout_started",
  "subscription_activated",
  "onboarding_started",
  "household_created",
  "income_added",
  "five_bills_added",
  "payday_viewed",
  "onboarding_completed",
  "support_requested",
  "signup_completed",
  "subscription_past_due",
  "subscription_cancelled"
] as const;

export type BetaEventName = (typeof BETA_EVENT_NAMES)[number];

export type BetaOnboardingStep =
  | "household"
  | "income"
  | "bills"
  | "payday"
  | "complete";

export interface BetaOnboardingSnapshot {
  householdId: string | null;
  incomeCount: number;
  billCount: number;
  paydayViewed: boolean;
}

const BETA_EVENT_NAME_SET = new Set<string>(BETA_EVENT_NAMES);

function hasHousehold(snapshot: BetaOnboardingSnapshot): boolean {
  return Boolean(snapshot.householdId);
}

function hasIncome(snapshot: BetaOnboardingSnapshot): boolean {
  return snapshot.incomeCount > 0;
}

function hasBills(snapshot: BetaOnboardingSnapshot): boolean {
  return snapshot.billCount > 0;
}

function recordEvent(events: BetaEventName[], eventName: BetaEventName): void {
  if (BETA_EVENT_NAME_SET.has(eventName)) {
    events.push(eventName);
  }
}

export function deriveBetaOnboardingStep(
  snapshot: BetaOnboardingSnapshot
): BetaOnboardingStep {
  if (!hasHousehold(snapshot)) return "household";
  if (!hasIncome(snapshot)) return "income";
  if (!hasBills(snapshot)) return "bills";
  if (!snapshot.paydayViewed) return "payday";
  return "complete";
}

export function nextBetaMilestoneEvents(
  previous: BetaOnboardingSnapshot,
  next: BetaOnboardingSnapshot
): BetaEventName[] {
  const events: BetaEventName[] = [];

  if (!hasHousehold(previous) && hasHousehold(next)) {
    recordEvent(events, "household_created");
  }

  if (!hasIncome(previous) && hasIncome(next)) {
    recordEvent(events, "income_added");
  }

  if (previous.billCount < 5 && next.billCount >= 5) {
    recordEvent(events, "five_bills_added");
  }

  if (!previous.paydayViewed && next.paydayViewed) {
    recordEvent(events, "payday_viewed");
  }

  if (
    deriveBetaOnboardingStep(previous) !== "complete" &&
    deriveBetaOnboardingStep(next) === "complete"
  ) {
    recordEvent(events, "onboarding_completed");
  }

  return events;
}
