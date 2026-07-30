import { nonNegative } from "./numbers.js";
import { FREQUENCIES } from "./types.js";
import type {
  BudgetBackup,
  BudgetState,
  DebtStrategy,
  Expense,
  Frequency,
  Goal,
  IncomeSource,
  NetWorthItem,
  NetWorthSnapshot,
  Transaction
} from "./types.js";

const DEFAULT_INCOMES: IncomeSource[] = [
  {
    id: "primary-income",
    label: "Primary income",
    amount: 0,
    frequency: "weekly",
    nextPayDate: ""
  },
  {
    id: "secondary-income",
    label: "Secondary income",
    amount: 0,
    frequency: "weekly",
    nextPayDate: ""
  },
  {
    id: "additional-income-1",
    label: "Additional income 1",
    amount: 0,
    frequency: "monthly",
    nextPayDate: ""
  },
  {
    id: "additional-income-2",
    label: "Additional income 2",
    amount: 0,
    frequency: "monthly",
    nextPayDate: ""
  }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function identifier(value: unknown, fallback: string): string {
  return text(value, fallback) || fallback;
}

function frequency(value: unknown, fallback: Frequency): Frequency {
  return typeof value === "string" && FREQUENCIES.includes(value as Frequency)
    ? value as Frequency
    : fallback;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normaliseIncome(value: Record<string, unknown>, index: number): IncomeSource {
  const defaults = DEFAULT_INCOMES[index] ?? {
    id: `income-${index + 1}`,
    label: `Income ${index + 1}`,
    amount: 0,
    frequency: "monthly" as const,
    nextPayDate: ""
  };

  return {
    id: identifier(value.id, defaults.id),
    label: text(value.label, defaults.label) || defaults.label,
    amount: nonNegative(value.amount),
    frequency: frequency(value.frequency, defaults.frequency),
    nextPayDate: text(value.nextPayDate)
  };
}

function normaliseExpense(value: Record<string, unknown>, index: number): Expense {
  const expense: Expense = {
    id: identifier(value.id, `expense-${index + 1}`),
    name: text(value.name, `Expense ${index + 1}`),
    category: text(value.category, "Other"),
    amount: nonNegative(value.amount),
    frequency: frequency(value.frequency, "monthly"),
    due: text(value.due),
    reservedAmount: nonNegative(value.reservedAmount)
  };

  if (value.debtBalance !== undefined) expense.debtBalance = nonNegative(value.debtBalance);
  if (value.interestRate !== undefined) expense.interestRate = nonNegative(value.interestRate);
  return expense;
}

function normaliseTransaction(value: Record<string, unknown>, index: number): Transaction {
  return {
    id: identifier(value.id, `transaction-${index + 1}`),
    date: text(value.date),
    description: text(value.description, "Transaction"),
    category: text(value.category, "Other"),
    amount: nonNegative(value.amount),
    type: value.type === "income" ? "income" : "expense",
    matchedExpenseId: text(value.matchedExpenseId)
  };
}

function normaliseGoal(value: Record<string, unknown>, index: number): Goal {
  return {
    id: identifier(value.id, `goal-${index + 1}`),
    name: text(value.name, `Goal ${index + 1}`),
    target: nonNegative(value.target),
    current: nonNegative(value.current),
    targetDate: text(value.targetDate)
  };
}

function normaliseNetWorthItem(value: Record<string, unknown>, index: number): NetWorthItem {
  return {
    id: identifier(value.id, `net-worth-${index + 1}`),
    name: text(value.name, `Item ${index + 1}`),
    owner: text(value.owner, "Household"),
    type: text(value.type, "Other"),
    kind: value.kind === "liability" ? "liability" : "asset",
    value: nonNegative(value.value)
  };
}

function normaliseNetWorthSnapshot(value: Record<string, unknown>): NetWorthSnapshot {
  return {
    date: text(value.date),
    value: Number.isFinite(Number(value.value)) ? Number(value.value) : 0
  };
}

export function createDefaultBudgetState(): BudgetState {
  return {
    schemaVersion: 1,
    household: {
      id: "local-household",
      name: "My household",
      currency: "AUD",
      locale: "en-AU"
    },
    incomes: DEFAULT_INCOMES.map((income) => ({ ...income })),
    savingsPlan: {
      allocationPercent: 10,
      startingSavings: 0,
      annualReturnPercent: 6,
      years: 10
    },
    debtPlan: {
      strategy: "avalanche",
      extraPayment: 0
    },
    paydayPlan: {
      payCycle: "weekly",
      nextPayday: "",
      billsAccountBalance: 0
    },
    transactions: [],
    goals: [],
    netWorthItems: [],
    netWorthHistory: [],
    expenses: []
  };
}

export function normaliseBudgetState(input: unknown): BudgetState {
  const source = isRecord(input) ? input : {};
  const household = isRecord(source.household) ? source.household : {};
  const savings = isRecord(source.savingsPlan) ? source.savingsPlan : {};
  const debt = isRecord(source.debtPlan) ? source.debtPlan : {};
  const payday = isRecord(source.paydayPlan) ? source.paydayPlan : {};
  const savedIncomes = records(source.incomes);
  const legacyIncome = source.incomeAmount !== undefined
    ? [{
        id: "primary-income",
        label: "Primary income",
        amount: source.incomeAmount,
        frequency: source.incomeFrequency
      }]
    : [];
  const incomeRecords = savedIncomes.length ? savedIncomes : legacyIncome;
  const incomes = incomeRecords.length
    ? incomeRecords.map(normaliseIncome)
    : DEFAULT_INCOMES.map((income) => ({ ...income }));
  const debtStrategy: DebtStrategy = debt.strategy === "snowball" ? "snowball" : "avalanche";

  return {
    schemaVersion: 1,
    household: {
      id: identifier(household.id, "local-household"),
      name: text(household.name, "My household"),
      currency: "AUD",
      locale: "en-AU"
    },
    incomes,
    savingsPlan: {
      allocationPercent: nonNegative(savings.allocationPercent, 10),
      startingSavings: nonNegative(savings.startingSavings),
      annualReturnPercent: nonNegative(savings.annualReturnPercent, 6),
      years: Math.max(Math.round(nonNegative(savings.years, 10)), 1)
    },
    debtPlan: {
      strategy: debtStrategy,
      extraPayment: nonNegative(debt.extraPayment)
    },
    paydayPlan: {
      payCycle: payday.payCycle === "fortnightly" ? "fortnightly" : "weekly",
      nextPayday: text(payday.nextPayday),
      billsAccountBalance: nonNegative(payday.billsAccountBalance)
    },
    transactions: records(source.transactions).map(normaliseTransaction),
    goals: records(source.goals).map(normaliseGoal),
    netWorthItems: records(source.netWorthItems).map(normaliseNetWorthItem),
    netWorthHistory: records(source.netWorthHistory).map(normaliseNetWorthSnapshot),
    expenses: records(source.expenses).map(normaliseExpense)
  };
}

export function parseBudgetBackup(input: unknown): BudgetState {
  if (!isRecord(input)) return createDefaultBudgetState();
  return normaliseBudgetState(input.state ?? input.budget ?? input);
}

export function createBudgetBackup(
  state: BudgetState,
  exportedAt = new Date().toISOString()
): BudgetBackup {
  return {
    format: "Harbourline Backup",
    version: 4,
    exportedAt,
    locale: "en-AU",
    currency: "AUD",
    state: normaliseBudgetState(state)
  };
}
