import {
  DEFAULT_CURRENCY_REGISTRY,
  minorToNumber,
  parseMajorToMinor,
  scaleMinorDecimal,
  type CurrencyRegistry
} from "./currency.js";
import { clamp, nonNegative } from "./numbers.js";

export interface SavingsProjectionInput {
  monthlyIncome: number;
  monthlyExpenses: number;
  debtExtraPayment: number;
  allocationPercent: number;
  startingSavings: number;
  annualReturnPercent: number;
  years: number;
  currency?: string;
  registry?: CurrencyRegistry;
}

export interface SavingsYear {
  year: number;
  balance: number;
}

export interface SavingsProjection {
  monthlyIncome: number;
  monthlyExpenses: number;
  remaining: number;
  debtExtraPayment: number;
  allocationPercent: number;
  monthlyContribution: number;
  startingBalance: number;
  annualReturn: number;
  years: number;
  balance: number;
  contributions: number;
  compoundGrowth: number;
  gap: number;
  yearly: SavingsYear[];
}

export function projectSavings(input: SavingsProjectionInput): SavingsProjection {
  const registry = input.registry ?? DEFAULT_CURRENCY_REGISTRY;
  const currency = input.currency ?? registry.defaultCurrency;
  const monthlyIncomeMinor = BigInt(parseMajorToMinor(nonNegative(input.monthlyIncome), currency, registry));
  const monthlyExpensesMinor = BigInt(parseMajorToMinor(nonNegative(input.monthlyExpenses), currency, registry));
  const debtExtraPaymentMinor = BigInt(parseMajorToMinor(nonNegative(input.debtExtraPayment), currency, registry));
  const allocationPercent = clamp(input.allocationPercent, 0, 100);
  const monthlyContributionMinor = BigInt(scaleMinorDecimal(monthlyIncomeMinor, allocationPercent, 100n));
  const startingBalanceMinor = BigInt(parseMajorToMinor(nonNegative(input.startingSavings), currency, registry));
  const annualReturn = nonNegative(input.annualReturnPercent) / 100;
  const years = Math.max(Math.round(nonNegative(input.years, 1)), 1);
  const months = years * 12;
  const remainingMinor = monthlyIncomeMinor - monthlyExpensesMinor;
  const yearly: SavingsYear[] = [];
  let balanceMinor = startingBalanceMinor;

  for (let month = 1; month <= months; month += 1) {
    const interestMinor = BigInt(scaleMinorDecimal(balanceMinor, nonNegative(input.annualReturnPercent), 1200n));
    balanceMinor += interestMinor + monthlyContributionMinor;
    if (month % 12 === 0) {
      yearly.push({
        year: month / 12,
        balance: minorToNumber(balanceMinor, currency, registry)
      });
    }
  }

  const contributionsMinor = monthlyContributionMinor * BigInt(months);
  const compoundGrowthMinor = balanceMinor - startingBalanceMinor - contributionsMinor;
  const availableMinor = remainingMinor - debtExtraPaymentMinor > 0n
    ? remainingMinor - debtExtraPaymentMinor
    : 0n;
  const gapMinor = monthlyContributionMinor > availableMinor
    ? monthlyContributionMinor - availableMinor
    : 0n;

  return {
    monthlyIncome: minorToNumber(monthlyIncomeMinor, currency, registry),
    monthlyExpenses: minorToNumber(monthlyExpensesMinor, currency, registry),
    remaining: minorToNumber(remainingMinor, currency, registry),
    debtExtraPayment: minorToNumber(debtExtraPaymentMinor, currency, registry),
    allocationPercent,
    monthlyContribution: minorToNumber(monthlyContributionMinor, currency, registry),
    startingBalance: minorToNumber(startingBalanceMinor, currency, registry),
    annualReturn,
    years,
    balance: minorToNumber(balanceMinor, currency, registry),
    contributions: minorToNumber(contributionsMinor, currency, registry),
    compoundGrowth: minorToNumber(compoundGrowthMinor > 0n ? compoundGrowthMinor : 0n, currency, registry),
    gap: minorToNumber(gapMinor, currency, registry),
    yearly
  };
}
