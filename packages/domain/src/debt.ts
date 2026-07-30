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

function orderedDebts(debts: DebtAccount[], strategy: DebtStrategy): DebtAccount[] {
  return [...debts].sort((a, b) => {
    if (strategy === "snowball") {
      return a.balance - b.balance
        || b.annualRate - a.annualRate
        || a.name.localeCompare(b.name);
    }
    return b.annualRate - a.annualRate
      || a.balance - b.balance
      || a.name.localeCompare(b.name);
  });
}

export function simulateDebtPlan(
  accounts: DebtAccount[],
  strategy: DebtStrategy,
  extraPayment = 0,
  maxMonths = 600
): DebtSimulation {
  const debts = accounts
    .map((debt) => ({
      ...debt,
      balance: nonNegative(debt.balance),
      annualRate: nonNegative(debt.annualRate),
      minimumPayment: nonNegative(debt.minimumPayment)
    }))
    .filter((debt) => debt.balance > 0 && debt.minimumPayment > 0);

  const startingBalance = debts.reduce((total, debt) => total + debt.balance, 0);
  const scheduledPayments = debts.reduce((total, debt) => total + debt.minimumPayment, 0);
  const monthlyBudget = scheduledPayments + nonNegative(extraPayment);
  const trajectory: DebtTrajectoryPoint[] = startingBalance > 0
    ? [{ month: 0, balance: startingBalance }]
    : [];
  let totalInterest = 0;
  let months = 0;

  while (debts.some((debt) => debt.balance > 0.005) && months < maxMonths) {
    months += 1;

    debts.forEach((debt) => {
      if (debt.balance <= 0.005) return;
      const interest = debt.balance * debt.annualRate / 100 / 12;
      debt.balance += interest;
      totalInterest += interest;
    });

    let minimumsPaid = 0;
    debts.forEach((debt) => {
      if (debt.balance <= 0.005) return;
      const payment = Math.min(debt.minimumPayment, debt.balance);
      debt.balance -= payment;
      minimumsPaid += payment;
    });

    let rollover = Math.max(monthlyBudget - minimumsPaid, 0);
    while (rollover > 0.005) {
      const target = orderedDebts(
        debts.filter((debt) => debt.balance > 0.005),
        strategy
      )[0];
      if (!target) break;
      const payment = Math.min(rollover, target.balance);
      target.balance -= payment;
      rollover -= payment;
    }

    const balance = debts.reduce((total, debt) => total + Math.max(debt.balance, 0), 0);
    if (months % 12 === 0 || balance <= 0.005) {
      trajectory.push({ month: months, balance });
    }
  }

  return {
    strategy,
    startingBalance,
    scheduledPayments,
    monthlyBudget,
    totalInterest,
    months,
    resolved: !debts.some((debt) => debt.balance > 0.005),
    trajectory
  };
}
