import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annualAmount,
  calculateBudgetSummary,
  calculateCategoryTotals,
  createBudgetBackup,
  createDefaultBudgetState,
  deriveBetaOnboardingStep,
  formatAud,
  fortnightlyAmount,
  monthlyAmount,
  nextBetaMilestoneEvents,
  normaliseBudgetState,
  parseBudgetBackup,
  projectSavings,
  simulateDebtPlan,
  weeklyAmount
} from "../dist/index.js";

const closeTo = (actual, expected, precision = 2) => {
  const tolerance = 10 ** -precision / 2;
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`
  );
};

describe("frequency conversion", () => {
  it("normalises Australian household payment cycles", () => {
    closeTo(monthlyAmount(100, "weekly"), 433.333333, 5);
    closeTo(monthlyAmount(100, "fortnightly"), 216.666667, 5);
    assert.equal(monthlyAmount(1200, "yearly"), 100);
    assert.equal(monthlyAmount(300, "quarterly"), 100);
    assert.equal(monthlyAmount(100, "monthly"), 100);
  });

  it("converts any supported frequency to weekly, fortnightly and annual figures", () => {
    assert.equal(weeklyAmount(5200, "yearly"), 100);
    assert.equal(fortnightlyAmount(5200, "yearly"), 200);
    assert.equal(annualAmount(100, "weekly"), 5200);
  });

  it("formats values in Australian dollars", () => {
    assert.match(formatAud(1234.5), /^\$1,234\.50$/);
  });
});

describe("budget summary", () => {
  it("shows surplus and weekly provision for a funded household", () => {
    const state = createDefaultBudgetState();
    state.incomes[0] = {
      ...state.incomes[0],
      amount: 1218,
      frequency: "weekly"
    };
    state.expenses = [
      {
        id: "rent",
        name: "Rent",
        category: "Housing",
        amount: 500,
        frequency: "weekly",
        due: "",
        reservedAmount: 0
      },
      {
        id: "insurance",
        name: "Insurance",
        category: "Insurance",
        amount: 1200,
        frequency: "yearly",
        due: "",
        reservedAmount: 0
      }
    ];

    const summary = calculateBudgetSummary(state);

    closeTo(summary.monthlyIncome, 5278, 2);
    closeTo(summary.monthlyExpenses, 2266.67, 2);
    closeTo(summary.monthlyRemaining, 3011.33, 2);
    assert.equal(summary.monthlyShortfall, 0);
    closeTo(summary.weeklyExpenses, 523.08, 2);
  });

  it("reports a shortfall without presenting it as a surplus", () => {
    const state = createDefaultBudgetState();
    state.incomes[0] = {
      ...state.incomes[0],
      amount: 1000,
      frequency: "monthly"
    };
    state.expenses = [{
      id: "rent",
      name: "Rent",
      category: "Housing",
      amount: 1200,
      frequency: "monthly",
      due: "",
      reservedAmount: 0
    }];

    const summary = calculateBudgetSummary(state);

    assert.equal(summary.monthlyRemaining, -200);
    assert.equal(summary.monthlyShortfall, 200);
    assert.equal(summary.expenseRatio, 1.2);
  });

  it("groups expense categories by monthly value", () => {
    const state = createDefaultBudgetState();
    state.expenses = [
      {
        id: "rent",
        name: "Rent",
        category: "Housing",
        amount: 2000,
        frequency: "monthly",
        due: "",
        reservedAmount: 0
      },
      {
        id: "power",
        name: "Power",
        category: "Utilities",
        amount: 300,
        frequency: "quarterly",
        due: "",
        reservedAmount: 0
      }
    ];

    const categories = calculateCategoryTotals(state);

    assert.deepEqual(
      { name: categories[0].name, value: categories[0].value },
      { name: "Housing", value: 2000 }
    );
    assert.deepEqual(
      { name: categories[1].name, value: categories[1].value },
      { name: "Utilities", value: 100 }
    );
    closeTo(categories[0].share + categories[1].share, 1, 8);
  });
});

describe("savings projection", () => {
  it("compounds monthly contributions and reports growth separately", () => {
    const projection = projectSavings({
      monthlyIncome: 5000,
      monthlyExpenses: 3500,
      debtExtraPayment: 250,
      allocationPercent: 10,
      startingSavings: 10000,
      annualReturnPercent: 6,
      years: 10
    });

    assert.equal(projection.monthlyContribution, 500);
    assert.equal(projection.contributions, 60000);
    assert.ok(projection.balance > 70000);
    assert.ok(projection.compoundGrowth > 0);
    assert.equal(projection.yearly.length, 10);
    assert.equal(projection.gap, 0);
  });

  it("identifies an unaffordable savings allocation", () => {
    const projection = projectSavings({
      monthlyIncome: 3000,
      monthlyExpenses: 2800,
      debtExtraPayment: 100,
      allocationPercent: 20,
      startingSavings: 0,
      annualReturnPercent: 0,
      years: 1
    });

    assert.equal(projection.monthlyContribution, 600);
    assert.equal(projection.gap, 500);
    assert.equal(projection.balance, 7200);
  });

  it("keeps repeated cent contributions exact", () => {
    const projection = projectSavings({
      monthlyIncome: 0.01,
      monthlyExpenses: 0,
      debtExtraPayment: 0,
      allocationPercent: 100,
      startingSavings: 0,
      annualReturnPercent: 0,
      years: 1
    });

    assert.equal(projection.monthlyContribution, 0.01);
    assert.equal(projection.contributions, 0.12);
    assert.equal(projection.balance, 0.12);
  });
});

const debts = [
  {
    id: "card",
    name: "Credit card",
    balance: 5000,
    annualRate: 20,
    minimumPayment: 150
  },
  {
    id: "car",
    name: "Car loan",
    balance: 12000,
    annualRate: 7,
    minimumPayment: 300
  }
];

describe("debt simulation", () => {
  it("resolves configured debts and records annual trajectory points", () => {
    const result = simulateDebtPlan(debts, "avalanche", 200);

    assert.equal(result.resolved, true);
    assert.equal(result.startingBalance, 17000);
    assert.equal(result.monthlyBudget, 650);
    assert.ok(result.months > 0);
    assert.ok(result.months < 600);
    assert.ok(result.totalInterest > 0);
    closeTo(result.trajectory.at(-1)?.balance ?? Number.NaN, 0, 2);
  });

  it("shows the benefit of an additional monthly repayment", () => {
    const baseline = simulateDebtPlan(debts, "avalanche", 0);
    const accelerated = simulateDebtPlan(debts, "avalanche", 300);

    assert.ok(accelerated.months < baseline.months);
    assert.ok(accelerated.totalInterest < baseline.totalInterest);
  });

  it("caps a non-amortising plan instead of claiming it is resolved", () => {
    const result = simulateDebtPlan([{
      id: "slow",
      name: "Slow debt",
      balance: 10000,
      annualRate: 24,
      minimumPayment: 10
    }], "avalanche");

    assert.equal(result.resolved, false);
    assert.equal(result.months, 600);
  });
});

describe("budget state migration", () => {
  it("keeps calendar expense titles private unless explicitly enabled", () => {
    assert.equal(createDefaultBudgetState().showExpenseNamesOnCalendar, false);
    assert.equal(
      normaliseBudgetState({ showExpenseNamesOnCalendar: true }).showExpenseNamesOnCalendar,
      true
    );
    assert.equal(
      normaliseBudgetState({ showExpenseNamesOnCalendar: "true" }).showExpenseNamesOnCalendar,
      false
    );
  });

  it("migrates the original single-income format", () => {
    const migrated = normaliseBudgetState({
      incomeAmount: 1218,
      incomeFrequency: "weekly",
      expenses: [{
        name: "Rent",
        amount: 500,
        frequency: "weekly",
        category: "Housing"
      }]
    });

    assert.equal(migrated.schemaVersion, 1);
    assert.deepEqual(
      {
        amount: migrated.incomes[0].amount,
        frequency: migrated.incomes[0].frequency
      },
      {
        amount: 1218,
        frequency: "weekly"
      }
    );
    assert.deepEqual(
      {
        name: migrated.expenses[0].name,
        amount: migrated.expenses[0].amount,
        reservedAmount: migrated.expenses[0].reservedAmount
      },
      {
        name: "Rent",
        amount: 500,
        reservedAmount: 0
      }
    );
  });

  it("accepts the existing version 3 backup envelope", () => {
    const migrated = parseBudgetBackup({
      format: "Harbourline Backup",
      version: 3,
      state: {
        incomes: [{
          id: "grant",
          label: "Salary",
          amount: 1218,
          frequency: "weekly",
          nextPayDate: "2026-08-06"
        }],
        expenses: []
      }
    });

    assert.deepEqual(
      {
        id: migrated.incomes[0].id,
        label: migrated.incomes[0].label,
        amount: migrated.incomes[0].amount
      },
      {
        id: "grant",
        label: "Salary",
        amount: 1218
      }
    );
  });

  it("normalises payday checklist and confirmation history", () => {
    const migrated = normaliseBudgetState({
      paydayPlan: {
        payCycle: "fortnightly",
        nextPayday: "2026-08-06",
        billsAccountBalance: 420,
        checklist: {
          paydayDate: "2026-08-06",
          billsTransferConfirmed: true,
          savingsDebtConfirmed: false,
          safeSpendConfirmed: true,
          confirmedAt: "2026-08-06T01:00:00.000Z"
        },
        history: [{
          id: "payday-1",
          paydayDate: "2026-07-23",
          confirmedAt: "2026-07-23T01:00:00.000Z",
          income: 1800,
          transfer: 600,
          savings: 180,
          extraDebt: 50,
          safeSpend: 970,
          billsPaid: 2
        }]
      }
    });

    assert.deepEqual(migrated.paydayPlan.checklist, {
      paydayDate: "2026-08-06",
      billsTransferConfirmed: true,
      savingsDebtConfirmed: false,
      safeSpendConfirmed: true,
      confirmedAt: "2026-08-06T01:00:00.000Z"
    });
    assert.deepEqual(migrated.paydayPlan.history[0], {
      id: "payday-1",
      paydayDate: "2026-07-23",
      confirmedAt: "2026-07-23T01:00:00.000Z",
      income: 1800,
      transfer: 600,
      savings: 180,
      extraDebt: 50,
      safeSpend: 970,
      billsPaid: 2
    });
  });

  it("creates a versioned portable backup", () => {
    const backup = createBudgetBackup(
      createDefaultBudgetState(),
      "2026-07-30T00:00:00.000Z"
    );

    assert.deepEqual(
      {
        format: backup.format,
        version: backup.version,
        exportedAt: backup.exportedAt,
        currency: backup.currency
      },
      {
        format: "Harbourline Backup",
        version: 5,
        exportedAt: "2026-07-30T00:00:00.000Z",
        currency: "AUD"
      }
    );
    assert.equal(backup.state.schemaVersion, 2);
  });
});

describe("paid beta onboarding", () => {
  it("moves from household to income, bills and payday", () => {
    assert.equal(
      deriveBetaOnboardingStep({
        householdId: null,
        incomeCount: 0,
        billCount: 0,
        paydayViewed: false
      }),
      "household"
    );
    assert.equal(
      deriveBetaOnboardingStep({
        householdId: "household-1",
        incomeCount: 0,
        billCount: 0,
        paydayViewed: false
      }),
      "income"
    );
    assert.equal(
      deriveBetaOnboardingStep({
        householdId: "household-1",
        incomeCount: 1,
        billCount: 0,
        paydayViewed: false
      }),
      "bills"
    );
    assert.equal(
      deriveBetaOnboardingStep({
        householdId: "household-1",
        incomeCount: 1,
        billCount: 1,
        paydayViewed: false
      }),
      "payday"
    );
  });

  it("emits only new privacy-safe milestones", () => {
    assert.deepEqual(
      nextBetaMilestoneEvents(
        {
          householdId: "household-1",
          incomeCount: 0,
          billCount: 0,
          paydayViewed: false
        },
        {
          householdId: "household-1",
          incomeCount: 1,
          billCount: 5,
          paydayViewed: true
        }
      ),
      [
        "income_added",
        "five_bills_added",
        "payday_viewed",
        "onboarding_completed"
      ]
    );
  });
});
