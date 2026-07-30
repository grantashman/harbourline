import { monthlyAmount } from "./frequencies.js";
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

export function calculateBudgetSummary(state: BudgetState): BudgetSummary {
  const monthlyIncome = state.incomes.reduce(
    (total, income) => total + monthlyAmount(income.amount, income.frequency),
    0
  );
  const monthlyExpenses = state.expenses.reduce(
    (total, expense) => total + monthlyAmount(expense.amount, expense.frequency),
    0
  );
  const monthlyRemaining = monthlyIncome - monthlyExpenses;

  return {
    monthlyIncome,
    monthlyExpenses,
    monthlyRemaining,
    monthlyShortfall: Math.max(-monthlyRemaining, 0),
    expenseRatio: monthlyIncome > 0 ? monthlyExpenses / monthlyIncome : 0,
    weeklyIncome: monthlyIncome * 12 / 52,
    weeklyExpenses: monthlyExpenses * 12 / 52,
    weeklyRemaining: monthlyRemaining * 12 / 52
  };
}

export function calculateCategoryTotals(state: BudgetState): CategoryTotal[] {
  const totals = state.expenses.reduce<Record<string, number>>((result, expense) => {
    const category = expense.category.trim() || "Other";
    result[category] = (result[category] ?? 0) + monthlyAmount(expense.amount, expense.frequency);
    return result;
  }, {});

  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);

  return Object.entries(totals)
    .map(([name, value]) => ({
      name,
      value,
      share: total > 0 ? value / total : 0
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
