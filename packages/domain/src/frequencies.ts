import type { Frequency } from "./types.js";
import { finiteNumber } from "./numbers.js";
import { scaleMinor, parseMajorToMinor, minorToNumber, type CurrencyRegistry, DEFAULT_CURRENCY_REGISTRY } from "./currency.js";

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

const WEEKLY_RATIOS: Record<Frequency, readonly [bigint, bigint]> = {
  weekly: [1n, 1n],
  fortnightly: [1n, 2n],
  fourWeekly: [1n, 4n],
  monthly: [3n, 13n],
  quarterly: [1n, 13n],
  sixMonthly: [1n, 26n],
  yearly: [1n, 52n],
  once: [3n, 13n]
};

const FORTNIGHTLY_RATIOS: Record<Frequency, readonly [bigint, bigint]> = {
  weekly: [2n, 1n],
  fortnightly: [1n, 1n],
  fourWeekly: [1n, 2n],
  monthly: [6n, 13n],
  quarterly: [2n, 13n],
  sixMonthly: [1n, 13n],
  yearly: [1n, 26n],
  once: [6n, 13n]
};

const ANNUAL_RATIOS: Record<Frequency, readonly [bigint, bigint]> = {
  weekly: [52n, 1n],
  fortnightly: [26n, 1n],
  fourWeekly: [13n, 1n],
  monthly: [12n, 1n],
  quarterly: [4n, 1n],
  sixMonthly: [2n, 1n],
  yearly: [1n, 1n],
  once: [12n, 1n]
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

const FREQUENCY_RATIOS: Record<Frequency, readonly [bigint, bigint]> = {
  weekly: [52n, 12n],
  fortnightly: [26n, 12n],
  fourWeekly: [13n, 12n],
  monthly: [1n, 1n],
  quarterly: [1n, 3n],
  sixMonthly: [1n, 6n],
  yearly: [1n, 12n],
  once: [1n, 1n]
};

export function monthlyMinorAmountForCurrency(
  amount: unknown,
  frequency: Frequency,
  currency: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): string {
  return monthlyMinorAmount(parseMajorToMinor(amount, currency, registry, { allowNegative: true }), frequency);
}

export function weeklyMinorAmountForCurrency(
  amount: unknown,
  frequency: Frequency,
  currency: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): string {
  return weeklyMinorAmount(parseMajorToMinor(amount, currency, registry, { allowNegative: true }), frequency);
}

export function fortnightlyMinorAmountForCurrency(
  amount: unknown,
  frequency: Frequency,
  currency: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): string {
  return fortnightlyMinorAmount(parseMajorToMinor(amount, currency, registry, { allowNegative: true }), frequency);
}

export function annualMinorAmountForCurrency(
  amount: unknown,
  frequency: Frequency,
  currency: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): string {
  return annualMinorAmount(parseMajorToMinor(amount, currency, registry, { allowNegative: true }), frequency);
}

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

/** Convert a recurring amount already stored in minor units to a monthly amount. */
export function monthlyMinorAmount(amountMinor: string | bigint, frequency: Frequency): string {
  const [numerator, denominator] = FREQUENCY_RATIOS[frequency];
  return scaleMinor(amountMinor, numerator, denominator);
}

/** Convert a major-unit input through the currency's minor-unit boundary before scaling. */
export function weeklyAmountForCurrency(
  amount: unknown,
  frequency: Frequency,
  currency: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): number {
  return minorToNumber(weeklyMinorAmountForCurrency(amount, frequency, currency, registry), currency, registry);
}

export function fortnightlyAmountForCurrency(
  amount: unknown,
  frequency: Frequency,
  currency: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): number {
  return minorToNumber(fortnightlyMinorAmountForCurrency(amount, frequency, currency, registry), currency, registry);
}

export function monthlyAmountForCurrency(
  amount: unknown,
  frequency: Frequency,
  currency: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): number {
  return minorToNumber(monthlyMinorAmountForCurrency(amount, frequency, currency, registry), currency, registry);
}

export function annualAmountForCurrency(
  amount: unknown,
  frequency: Frequency,
  currency: string,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): number {
  return minorToNumber(annualMinorAmountForCurrency(amount, frequency, currency, registry), currency, registry);
}

export function weeklyMinorAmount(amountMinor: string | bigint, frequency: Frequency): string {
  const [numerator, denominator] = WEEKLY_RATIOS[frequency];
  return scaleMinor(amountMinor, numerator, denominator);
}

export function fortnightlyMinorAmount(amountMinor: string | bigint, frequency: Frequency): string {
  const [numerator, denominator] = FORTNIGHTLY_RATIOS[frequency];
  return scaleMinor(amountMinor, numerator, denominator);
}

export function annualMinorAmount(amountMinor: string | bigint, frequency: Frequency): string {
  const [numerator, denominator] = ANNUAL_RATIOS[frequency];
  return scaleMinor(amountMinor, numerator, denominator);
}

export function formatAud(value: unknown): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(finiteNumber(value));
}
