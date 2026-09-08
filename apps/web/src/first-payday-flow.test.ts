import assert from "node:assert/strict";
import test from "node:test";
import { firstPaydayProgress } from "./first-payday-flow.ts";

test("starts with income when there is no usable income", () => {
  assert.deepEqual(firstPaydayProgress({ hasIncome: false, commitmentCount: 0 }), {
    currentStep: "income",
    completedSteps: 0,
    totalSteps: 3,
    percent: 0,
    nextAction: "Add income",
    nextActionDetail: "Start with the take-home amount and date of your next pay."
  });
});

test("keeps partial commitments actionable", () => {
  assert.deepEqual(firstPaydayProgress({ hasIncome: true, commitmentCount: 1 }), {
    currentStep: "commitments",
    completedSteps: 1,
    totalSteps: 3,
    percent: 33,
    nextAction: "Add 2 commitments",
    nextActionDetail: "Add the regular costs that shape what this pay needs to cover."
  });
});

test("moves a complete setup into payday review", () => {
  assert.deepEqual(firstPaydayProgress({ hasIncome: true, commitmentCount: 3 }), {
    currentStep: "payday",
    completedSteps: 2,
    totalSteps: 3,
    percent: 67,
    nextAction: "Review your payday plan",
    nextActionDetail: "Check what to set aside and what is safe to spend until the next pay."
  });
});

test("reports a confirmed payday plan as complete", () => {
  assert.deepEqual(firstPaydayProgress({ hasIncome: true, commitmentCount: 3, paydayConfirmed: true }), {
    currentStep: "payday",
    completedSteps: 3,
    totalSteps: 3,
    percent: 100,
    nextAction: "Payday plan confirmed",
    nextActionDetail: "Your next pay has a clear plan. Revisit it when real spending changes."
  });
});

test("uses a custom commitment threshold and never returns negative progress", () => {
  assert.deepEqual(firstPaydayProgress({ hasIncome: true, commitmentCount: 0, minimumCommitments: 1 }), {
    currentStep: "commitments",
    completedSteps: 1,
    totalSteps: 3,
    percent: 33,
    nextAction: "Add 1 commitment",
    nextActionDetail: "Add the regular costs that shape what this pay needs to cover."
  });
});
