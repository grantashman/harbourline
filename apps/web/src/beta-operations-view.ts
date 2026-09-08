import type { BetaOperationsSnapshot } from "./beta-types";

export const BETA_FUNNEL_EVENTS = [
  ["signup", "Verified accounts"],
  ["onboarding_started", "Started onboarding"],
  ["income_added", "Added income"],
  ["five_bills_added", "Added five commitments"],
  ["payday_viewed", "Viewed payday plan"],
  ["onboarding_completed", "Completed onboarding"]
] as const;

export interface BetaOperationsView {
  funnel: Array<{ eventName: string; label: string; count: number }>;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  cancelledSubscriptions: number;
  recentDays: Array<{ day: string; count: number }>;
}

export function projectBetaOperations(snapshot: BetaOperationsSnapshot): BetaOperationsView {
  const totals = new Map<string, number>();
  for (const row of snapshot.daily) totals.set(row.eventName, (totals.get(row.eventName) ?? 0) + row.count);
  const funnel = BETA_FUNNEL_EVENTS.map(([eventName, label]) => ({
    eventName,
    label,
    count: totals.get(eventName) ?? 0
  }));
  const days = new Map<string, number>();
  for (const row of snapshot.daily) days.set(row.day, (days.get(row.day) ?? 0) + row.count);
  const recentDays = [...days.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 7)
    .map(([day, count]) => ({ day, count }));
  return {
    funnel,
    activeSubscriptions: snapshot.activeSubscriptions,
    pastDueSubscriptions: snapshot.pastDueSubscriptions,
    cancelledSubscriptions: snapshot.cancelledSubscriptions,
    recentDays
  };
}
