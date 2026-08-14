export type FreeStarterStep = "income" | "bills" | "payday";

export const FREE_STARTER_MIN_EXPENSES = 3;

interface FreeStarterIncome {
  amount?: unknown;
  nextPayDate?: unknown;
}

interface FreeStarterExpense {
  amount?: unknown;
}

interface FreeStarterState {
  incomes?: unknown;
  expenses?: unknown;
}

function positiveNumber(value: unknown): boolean {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function hasReadyIncome(value: unknown): value is FreeStarterIncome {
  if (!value || typeof value !== "object") return false;
  const income = value as FreeStarterIncome;
  return positiveNumber(income.amount) && String(income.nextPayDate ?? "").trim().length > 0;
}

function positiveExpenses(value: unknown): FreeStarterExpense[] {
  if (!Array.isArray(value)) return [];
  return value.filter((expense): expense is FreeStarterExpense => (
    Boolean(expense) &&
    typeof expense === "object" &&
    positiveNumber((expense as FreeStarterExpense).amount)
  ));
}

export function getFreeStarterStep(state: FreeStarterState): FreeStarterStep {
  const incomes = Array.isArray(state?.incomes) ? state.incomes : [];
  if (!incomes.some(hasReadyIncome)) return "income";
  return positiveExpenses(state?.expenses).length >= FREE_STARTER_MIN_EXPENSES
    ? "payday"
    : "bills";
}

export function canCompleteFreeStarter(state: FreeStarterState): boolean {
  return getFreeStarterStep(state) === "payday";
}
