import type { Frequency } from "./types.js";
import { finiteNumber } from "./numbers.js";

export const FREQUENCY_MULTIPLIERS: Record<Frequency, number> = {
  weekly: 52 / 12,
  fortnightly: 26 / 12,
  fourWeekly: 13 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  sixMonthly: 1 / 6,
  yearly: 1 / 12,
  once: 1
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  fourWeekly: "Every 4 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  sixMonthly: "Every 6 months",
  yearly: "Yearly",
  once: "One-off"
};

export function monthlyAmount(amount: unknown, frequency: Frequency): number {
  return finiteNumber(amount) * FREQUENCY_MULTIPLIERS[frequency];
}

export function weeklyAmount(amount: unknown, frequency: Frequency): number {
  return monthlyAmount(amount, frequency) * 12 / 52;
}

export function fortnightlyAmount(amount: unknown, frequency: Frequency): number {
  return monthlyAmount(amount, frequency) * 12 / 26;
}

export function annualAmount(amount: unknown, frequency: Frequency): number {
  return monthlyAmount(amount, frequency) * 12;
}

export function formatAud(value: unknown): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(finiteNumber(value));
}
