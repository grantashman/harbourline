import { clamp, nonNegative } from "./numbers.js";

export interface SavingsProjectionInput {
  monthlyIncome: number;
  monthlyExpenses: number;
  debtExtraPayment: number;
  allocationPercent: number;
  startingSavings: number;
  annualReturnPercent: number;
  years: number;
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
  const monthlyIncome = nonNegative(input.monthlyIncome);
  const monthlyExpenses = nonNegative(input.monthlyExpenses);
  const remaining = monthlyIncome - monthlyExpenses;
  const debtExtraPayment = nonNegative(input.debtExtraPayment);
  const allocationPercent = clamp(input.allocationPercent, 0, 100);
  const monthlyContribution = monthlyIncome * allocationPercent / 100;
  const startingBalance = nonNegative(input.startingSavings);
  const annualReturn = nonNegative(input.annualReturnPercent) / 100;
  const years = Math.max(Math.round(nonNegative(input.years, 1)), 1);
  const monthlyReturn = annualReturn / 12;
  const months = years * 12;
  const yearly: SavingsYear[] = [];
  let balance = startingBalance;

  for (let month = 1; month <= months; month += 1) {
    balance = balance * (1 + monthlyReturn) + monthlyContribution;
    if (month % 12 === 0) {
      yearly.push({ year: month / 12, balance });
    }
  }

  const contributions = monthlyContribution * months;

  return {
    monthlyIncome,
    monthlyExpenses,
    remaining,
    debtExtraPayment,
    allocationPercent,
    monthlyContribution,
    startingBalance,
    annualReturn,
    years,
    balance,
    contributions,
    compoundGrowth: Math.max(balance - startingBalance - contributions, 0),
    gap: Math.max(monthlyContribution - Math.max(remaining - debtExtraPayment, 0), 0),
    yearly
  };
}
