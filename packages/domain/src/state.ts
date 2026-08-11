import { DEFAULT_CURRENCY_REGISTRY, minorToMajor, parseMajorToMinor, type CurrencyRegistry } from "./currency.js";
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
  PaydayChecklist,
  PaydayRecord,
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
    value: Number.isFinite(Number(value.value ?? value.total)) ? Number(value.value ?? value.total) : 0
  };
}

function normalisePaydayChecklist(value: unknown): PaydayChecklist {
  const source = isRecord(value) ? value : {};
  return {
    paydayDate: text(source.paydayDate),
    billsTransferConfirmed: source.billsTransferConfirmed === true,
    savingsDebtConfirmed: source.savingsDebtConfirmed === true,
    safeSpendConfirmed: source.safeSpendConfirmed === true,
    confirmedAt: text(source.confirmedAt)
  };
}

function normalisePaydayRecord(value: Record<string, unknown>, index: number): PaydayRecord {
  return {
    id: identifier(value.id, `payday-${index + 1}`),
    paydayDate: text(value.paydayDate),
    confirmedAt: text(value.confirmedAt),
    income: nonNegative(value.income),
    transfer: nonNegative(value.transfer),
    savings: nonNegative(value.savings),
    extraDebt: nonNegative(value.extraDebt),
    safeSpend: Number.isFinite(Number(value.safeSpend)) ? Number(value.safeSpend) : 0,
    billsPaid: Math.max(Math.round(nonNegative(value.billsPaid)), 0)
  };
}

export function createDefaultBudgetState(options: {
  registry?: CurrencyRegistry;
  currency?: string;
  locale?: string;
  timeZone?: string;
} = {}): BudgetState {
  const registry = options.registry ?? DEFAULT_CURRENCY_REGISTRY;
  const currency = options.currency ?? registry.defaultCurrency;
  const definition = registry.get(currency);
  return {
    schemaVersion: 1,
    showExpenseNamesOnCalendar: false,
    household: {
      id: "local-household",
      name: "My household",
      currency,
      locale: options.locale ?? definition.defaultLocale,
      timeZone: options.timeZone ?? "Australia/Sydney"
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
      billsAccountBalance: 0,
      checklist: {
        paydayDate: "",
        billsTransferConfirmed: false,
        savingsDebtConfirmed: false,
        safeSpendConfirmed: false,
        confirmedAt: ""
      },
      history: []
    },
    transactions: [],
    goals: [],
    netWorthItems: [],
    netWorthHistory: [],
    expenses: []
  };
}

export function normaliseBudgetState(input: unknown, options: {
  registry?: CurrencyRegistry;
  defaultCurrency?: string;
  defaultLocale?: string;
  defaultTimeZone?: string;
} = {}): BudgetState {
  const registry = options.registry ?? DEFAULT_CURRENCY_REGISTRY;
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
  const configuredCurrency = household.currency ?? source.currency ?? options.defaultCurrency ?? registry.defaultCurrency;
  const currency = typeof configuredCurrency === "string" && configuredCurrency.trim()
    ? registry.get(configuredCurrency).code
    : registry.defaultCurrency;
  const currencyDefinition = registry.get(currency);

  return {
    schemaVersion: 1,
    showExpenseNamesOnCalendar: source.showExpenseNamesOnCalendar === true,
    household: {
      id: identifier(household.id, "local-household"),
      name: text(household.name, "My household"),
      currency,
      locale: text(household.locale, options.defaultLocale ?? currencyDefinition.defaultLocale),
      timeZone: text(household.timeZone, options.defaultTimeZone ?? "Australia/Sydney")
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
      billsAccountBalance: nonNegative(payday.billsAccountBalance),
      checklist: normalisePaydayChecklist(payday.checklist),
      history: records(payday.history).map(normalisePaydayRecord)
    },
    transactions: records(source.transactions).map(normaliseTransaction),
    goals: records(source.goals).map(normaliseGoal),
    netWorthItems: records(source.netWorthItems).map(normaliseNetWorthItem),
    netWorthHistory: records(source.netWorthHistory).map(normaliseNetWorthSnapshot),
    expenses: records(source.expenses).map(normaliseExpense)
  };
}

const MONEY_ARRAY_FIELDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["incomes", ["amount"]],
  ["expenses", ["amount", "reservedAmount", "debtBalance"]],
  ["transactions", ["amount"]],
  ["goals", ["target", "current"]],
  ["netWorthItems", ["value"]],
  ["netWorthHistory", ["value"]]
];

function cloneRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : {};
}

function transformMoneyFields(
  state: Record<string, unknown>,
  currency: string,
  registry: CurrencyRegistry,
  transform: (value: unknown, currency: string, registry: CurrencyRegistry) => unknown
): void {
  for (const [collectionName, fieldNames] of MONEY_ARRAY_FIELDS) {
    const collection = Array.isArray(state[collectionName]) ? state[collectionName] : [];
    for (const item of collection) {
      if (!isRecord(item)) continue;
      for (const fieldName of fieldNames) {
        if (item[fieldName] !== undefined) item[fieldName] = transform(item[fieldName], currency, registry);
      }
    }
  }
  const nestedFields: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["savingsPlan", ["startingSavings"]],
    ["debtPlan", ["extraPayment"]],
    ["paydayPlan", ["billsAccountBalance"]]
  ];
  for (const [objectName, fieldNames] of nestedFields) {
    const object = isRecord(state[objectName]) ? state[objectName] : {};
    for (const fieldName of fieldNames) {
      if (object[fieldName] !== undefined) object[fieldName] = transform(object[fieldName], currency, registry);
    }
  }
  const payday = isRecord(state.paydayPlan) ? state.paydayPlan : {};
  const history = Array.isArray(payday.history) ? payday.history : [];
  for (const item of history) {
    if (!isRecord(item)) continue;
    for (const fieldName of ["income", "transfer", "savings", "extraDebt", "safeSpend"]) {
      if (item[fieldName] !== undefined) item[fieldName] = transform(item[fieldName], currency, registry);
    }
  }
}

function encodeMoneyValue(value: unknown, currency: string, registry: CurrencyRegistry): string {
  return parseMajorToMinor(value, currency, registry);
}

function decodeMoneyValue(value: unknown, currency: string, registry: CurrencyRegistry): number {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)$/.test(value.trim())) {
    throw new Error("Persisted minor-unit money values must be integer strings.");
  }
  const major = Number(minorToMajor(value, currency, registry));
  if (!Number.isFinite(major)) throw new Error("Persisted money value is outside the supported numeric range.");
  return major;
}

/**
 * Serialise a runtime budget into the portable, exact-money representation.
 * Legacy runtime fields remain major-unit numbers for rendering compatibility;
 * persistence stores every monetary leaf as a decimal integer string.
 */
export function serialiseBudgetState(
  state: BudgetState,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): Record<string, unknown> {
  const normalised = normaliseBudgetState(state, { registry });
  const serialised = cloneRecord(normalised);
  serialised.schemaVersion = 4;
  serialised.moneyRepresentation = "minor-unit-string";
  const currency = normalised.household.currency;
  serialised.currency = currency;
  serialised.locale = normalised.household.locale;
  transformMoneyFields(serialised, currency, registry, encodeMoneyValue);
  return serialised;
}

/** Read both legacy decimal-number states and the exact minor-unit schema. */
export function parsePersistedBudgetState(
  input: unknown,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): BudgetState {
  const source = cloneRecord(input);
  const household = isRecord(source.household) ? source.household : {};
  const currency = typeof household.currency === "string"
    ? household.currency
    : typeof source.currency === "string"
      ? source.currency
      : registry.defaultCurrency;
  registry.get(currency);
  if (source.moneyRepresentation === "minor-unit-string") {
    transformMoneyFields(source, currency, registry, decodeMoneyValue);
  }
  return normaliseBudgetState({ ...source, household: { ...household, currency } }, { registry });
}

export function parseBudgetBackup(
  input: unknown,
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): BudgetState {
  if (!isRecord(input)) return createDefaultBudgetState({ registry });
  return parsePersistedBudgetState(input.state ?? input.budget ?? input, registry);
}

export function createBudgetBackup(
  state: BudgetState,
  exportedAt = new Date().toISOString(),
  registry: CurrencyRegistry = DEFAULT_CURRENCY_REGISTRY
): BudgetBackup {
  const normalised = normaliseBudgetState(state, { registry });
  return {
    format: "Harbourline Backup",
    version: 5,
    exportedAt,
    locale: normalised.household.locale,
    currency: normalised.household.currency,
    state: serialiseBudgetState(normalised, registry)
  };
}
