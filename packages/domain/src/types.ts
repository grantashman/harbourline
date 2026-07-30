export const FREQUENCIES = [
  "weekly",
  "fortnightly",
  "fourWeekly",
  "monthly",
  "quarterly",
  "sixMonthly",
  "yearly",
  "once"
] as const;

export type Frequency = (typeof FREQUENCIES)[number];

export type DebtStrategy = "avalanche" | "snowball";

export interface Household {
  id: string;
  name: string;
  currency: "AUD";
  locale: "en-AU";
}

export interface IncomeSource {
  id: string;
  label: string;
  amount: number;
  frequency: Frequency;
  nextPayDate: string;
}

export interface Expense {
  id: string;
  name: string;
  category: string;
  amount: number;
  frequency: Frequency;
  due: string;
  reservedAmount: number;
  debtBalance?: number;
  interestRate?: number;
}

export interface SavingsPlan {
  allocationPercent: number;
  startingSavings: number;
  annualReturnPercent: number;
  years: number;
}

export interface DebtPlan {
  strategy: DebtStrategy;
  extraPayment: number;
}

export interface PaydayPlan {
  payCycle: "weekly" | "fortnightly";
  nextPayday: string;
  billsAccountBalance: number;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  type: "income" | "expense";
  matchedExpenseId?: string;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
  targetDate: string;
}

export interface NetWorthItem {
  id: string;
  name: string;
  owner: string;
  type: string;
  kind: "asset" | "liability";
  value: number;
}

export interface NetWorthSnapshot {
  date: string;
  value: number;
}

export interface BudgetState {
  schemaVersion: 1;
  household: Household;
  incomes: IncomeSource[];
  savingsPlan: SavingsPlan;
  debtPlan: DebtPlan;
  paydayPlan: PaydayPlan;
  transactions: Transaction[];
  goals: Goal[];
  netWorthItems: NetWorthItem[];
  netWorthHistory: NetWorthSnapshot[];
  expenses: Expense[];
}

export interface BudgetBackup {
  format: "Harbourline Backup";
  version: 4;
  exportedAt: string;
  locale: "en-AU";
  currency: "AUD";
  state: BudgetState;
}

