import { DEFAULT_CURRENCY_REGISTRY, minorToNumber, sumMinor, type CurrencyRegistry } from "./currency.js";
import {
  monthlyMinorAmountForCurrency,
  weeklyMinorAmountForCurrency
} from "./frequencies.js";
import type { BudgetState } from "./types.js";

export interface BudgetSummary {
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyRemaining: number;
  monthlyShortfall: number;
  expenseRatio: number;
  weeklyIncome: number;
  weeklyExpenses: number;
  weeklyRemaining: number;
}

export interface CategoryTotal {
  name: string;
  value: number;
  share: number;
}

export function calculateBudgetSummary(
  state: BudgetState,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): BudgetSummary {
  const currency = state.household.currency;
  const monthlyIncomeMinor = sumMinor(state.incomes.map((income) => (
    monthlyMinorAmountForCurrency(income.amount, income.frequency, currency, registry)
  )));
  const monthlyExpensesMinor = sumMinor(state.expenses.map((expense) => (
    monthlyMinorAmountForCurrency(expense.amount, expense.frequency, currency, registry)
  )));
  const weeklyIncomeMinor = sumMinor(state.incomes.map((income) => (
    weeklyMinorAmountForCurrency(income.amount, income.frequency, currency, registry)
  )));
  const weeklyExpensesMinor = sumMinor(state.expenses.map((expense) => (
    weeklyMinorAmountForCurrency(expense.amount, expense.frequency, currency, registry)
  )));
  const monthlyRemainingMinor = BigInt(monthlyIncomeMinor) - BigInt(monthlyExpensesMinor);
  const weeklyRemainingMinor = BigInt(weeklyIncomeMinor) - BigInt(weeklyExpensesMinor);
  const monthlyIncome = minorToNumber(monthlyIncomeMinor, currency, registry);
  const monthlyExpenses = minorToNumber(monthlyExpensesMinor, currency, registry);
  const monthlyRemaining = minorToNumber(monthlyRemainingMinor, currency, registry);
  const weeklyIncome = minorToNumber(weeklyIncomeMinor, currency, registry);
  const weeklyExpenses = minorToNumber(weeklyExpensesMinor, currency, registry);

  return {
    monthlyIncome,
    monthlyExpenses,
    monthlyRemaining,
    monthlyShortfall: Math.max(-monthlyRemaining, 0),
    expenseRatio: monthlyIncome > 0 ? monthlyExpenses / monthlyIncome : 0,
    weeklyIncome,
    weeklyExpenses,
    weeklyRemaining: minorToNumber(weeklyRemainingMinor, currency, registry)
  };
}

export function calculateCategoryTotals(
  state: BudgetState,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): CategoryTotal[] {
  const currency = state.household.currency;
  const totals = new Map<string, string>();
  for (const expense of state.expenses) {
    const category = expense.category.trim() || "Other";
    const amountMinor = monthlyMinorAmountForCurrency(
      expense.amount,
      expense.frequency,
      currency,
      registry
    );
    totals.set(category, sumMinor([totals.get(category) ?? "0", amountMinor]));
  }

  const totalMinor = sumMinor(totals.values());
  const total = BigInt(totalMinor);
  return [...totals.entries()]
    .map(([name, valueMinor]) => ({
      name,
      value: minorToNumber(valueMinor, currency, registry),
      share: total > 0n ? Number(BigInt(valueMinor)) / Number(total) : 0
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
