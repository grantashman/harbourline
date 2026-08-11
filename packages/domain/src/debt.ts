import {
  DEFAULT_CURRENCY_REGISTRY,
  minorToNumber,
  parseMajorToMinor,
  scaleMinorDecimal,
  type CurrencyRegistry
} from "./currency.js";
import { nonNegative } from "./numbers.js";
import type { DebtStrategy } from "./types.js";

export interface DebtAccount {
  id: string;
  name: string;
  balance: number;
  annualRate: number;
  minimumPayment: number;
}

export interface DebtTrajectoryPoint {
  month: number;
  balance: number;
}

export interface DebtSimulation {
  strategy: DebtStrategy;
  startingBalance: number;
  scheduledPayments: number;
  monthlyBudget: number;
  totalInterest: number;
  months: number;
  resolved: boolean;
  trajectory: DebtTrajectoryPoint[];
}

interface WorkingDebt extends DebtAccount {
  balanceMinor: bigint;
  minimumPaymentMinor: bigint;
}

function compareMinor(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function orderedDebts(debts: WorkingDebt[], strategy: DebtStrategy): WorkingDebt[] {
  return [...debts].sort((a, b) => {
    if (strategy === "snowball") {
      return compareMinor(a.balanceMinor, b.balanceMinor)
        || b.annualRate - a.annualRate
        || a.name.localeCompare(b.name);
    }
    return b.annualRate - a.annualRate
      || compareMinor(a.balanceMinor, b.balanceMinor)
      || a.name.localeCompare(b.name);
  });
}

export interface DebtSimulationOptions {
  currency?: string;
  registry?: CurrencyRegistry;
}

export function simulateDebtPlan(
  accounts: DebtAccount[],
  strategy: DebtStrategy,
  extraPayment = 0,
  maxMonths = 600,
  options: DebtSimulationOptions = {}
): DebtSimulation {
  const registry = options.registry ?? DEFAULT_CURRENCY_REGISTRY;
  const currency = options.currency ?? registry.defaultCurrency;
  const debts: WorkingDebt[] = accounts
    .map((debt) => ({
      ...debt,
      balance: nonNegative(debt.balance),
      annualRate: nonNegative(debt.annualRate),
      minimumPayment: nonNegative(debt.minimumPayment),
      balanceMinor: BigInt(parseMajorToMinor(nonNegative(debt.balance), currency, registry)),
      minimumPaymentMinor: BigInt(parseMajorToMinor(nonNegative(debt.minimumPayment), currency, registry))
    }))
    .filter((debt) => debt.balanceMinor > 0n && debt.minimumPaymentMinor > 0n);

  const startingBalanceMinor = debts.reduce((total, debt) => total + debt.balanceMinor, 0n);
  const scheduledPaymentsMinor = debts.reduce((total, debt) => total + debt.minimumPaymentMinor, 0n);
  const extraPaymentMinor = BigInt(parseMajorToMinor(nonNegative(extraPayment), currency, registry));
  const monthlyBudgetMinor = scheduledPaymentsMinor + extraPaymentMinor;
  const trajectory: DebtTrajectoryPoint[] = startingBalanceMinor > 0n
    ? [{ month: 0, balance: minorToNumber(startingBalanceMinor, currency, registry) }]
    : [];
  let totalInterestMinor = 0n;
  let months = 0;

  while (debts.some((debt) => debt.balanceMinor > 0n) && months < maxMonths) {
    months += 1;

    debts.forEach((debt) => {
      if (debt.balanceMinor <= 0n) return;
      const interestMinor = BigInt(scaleMinorDecimal(debt.balanceMinor, debt.annualRate, 1200n));
      debt.balanceMinor += interestMinor;
      totalInterestMinor += interestMinor;
    });

    let minimumsPaidMinor = 0n;
    debts.forEach((debt) => {
      if (debt.balanceMinor <= 0n) return;
      const paymentMinor = debt.minimumPaymentMinor < debt.balanceMinor
        ? debt.minimumPaymentMinor
        : debt.balanceMinor;
      debt.balanceMinor -= paymentMinor;
      minimumsPaidMinor += paymentMinor;
    });

    let rolloverMinor = monthlyBudgetMinor - minimumsPaidMinor;
    if (rolloverMinor < 0n) rolloverMinor = 0n;
    while (rolloverMinor > 0n) {
      const target = orderedDebts(
        debts.filter((debt) => debt.balanceMinor > 0n),
        strategy
      )[0];
      if (!target) break;
      const paymentMinor = rolloverMinor < target.balanceMinor
        ? rolloverMinor
        : target.balanceMinor;
      target.balanceMinor -= paymentMinor;
      rolloverMinor -= paymentMinor;
    }

    const balanceMinor = debts.reduce(
      (total, debt) => total + (debt.balanceMinor > 0n ? debt.balanceMinor : 0n),
      0n
    );
    if (months % 12 === 0 || balanceMinor <= 0n) {
      trajectory.push({
        month: months,
        balance: minorToNumber(balanceMinor, currency, registry)
      });
    }
  }

  return {
    strategy,
    startingBalance: minorToNumber(startingBalanceMinor, currency, registry),
    scheduledPayments: minorToNumber(scheduledPaymentsMinor, currency, registry),
    monthlyBudget: minorToNumber(monthlyBudgetMinor, currency, registry),
    totalInterest: minorToNumber(totalInterestMinor, currency, registry),
    months,
    resolved: !debts.some((debt) => debt.balanceMinor > 0n),
    trajectory
  };
}
