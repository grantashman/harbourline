import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const freeStarterSource = readFileSync(resolve(repositoryRoot, "apps/web/src/free-starter-flow.ts"), "utf8");
const onboardingSource = readFileSync(resolve(repositoryRoot, "apps/web/src/onboarding-flow.ts"), "utf8");
import {
  FREE_STARTER_MIN_EXPENSES,
  canCompleteFreeStarter,
  getFreeStarterStep
} from "./free-starter-activation.ts";

const income = { amount: 1200, nextPayDate: "2026-08-21" };
const expenses = Array.from({ length: FREE_STARTER_MIN_EXPENSES }, (_, index) => ({
  amount: 100 + index,
  name: `Bill ${index + 1}`
}));

test("keeps the free starter first-value threshold at three commitments", () => {
  assert.equal(FREE_STARTER_MIN_EXPENSES, 3);
});

test("starts at income when no usable payday income exists", () => {
  assert.equal(getFreeStarterStep({ incomes: [], expenses: [] }), "income");
  assert.equal(getFreeStarterStep({ incomes: [{ amount: 1200 }], expenses }), "income");
});

test("asks for recurring commitments after a dated income exists", () => {
  assert.equal(getFreeStarterStep({ incomes: [income], expenses: [] }), "bills");
  assert.equal(canCompleteFreeStarter({ incomes: [income], expenses: [] }), false);
});

test("reaches payday after the minimum useful plan is present", () => {
  const state = { incomes: [income], expenses };
  assert.equal(getFreeStarterStep(state), "payday");
  assert.equal(canCompleteFreeStarter(state), true);
});

test("announces changing next-step guidance through a stable live region", () => {
  assert.match(freeStarterSource, /class="release2-onboarding-next" aria-label="Next step" aria-live="polite"/);
  assert.match(freeStarterSource, /existingNext\.innerHTML = next\.innerHTML;[\s\S]*next\.replaceWith\(existingNext\)/);
  assert.match(onboardingSource, /class="release2-onboarding-next" aria-label="Next step" aria-live="polite"/);
  assert.match(onboardingSource, /existingNext\.innerHTML = next\.innerHTML;[\s\S]*next\.replaceWith\(existingNext\)/);
});

test("ignores zero-value income and expenses", () => {
  assert.equal(
    getFreeStarterStep({
      incomes: [{ amount: 0, nextPayDate: "2026-08-21" }],
      expenses: [...expenses, { amount: 0, name: "Empty" }]
    }),
    "income"
  );
});
