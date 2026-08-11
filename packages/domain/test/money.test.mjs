import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CURRENCY_CONFIG,
  createCurrencyRegistry,
  createMoney,
  formatMoney,
  minorUnitStep,
  parseMajorToMinor,
  scaleMinor,
  monthlyMinorAmount,
  weeklyMinorAmount,
  annualMinorAmount,
  normaliseBudgetState,
  createDefaultBudgetState,
  parsePersistedBudgetState,
  serialiseBudgetState
} from "../dist/index.js";

describe("currency configuration", () => {
  it("keeps AUD enabled by default while leaving other currencies gated", () => {
    assert.deepEqual(DEFAULT_CURRENCY_CONFIG.enabledCurrencies, ["AUD"]);
    const registry = createCurrencyRegistry();
    assert.equal(registry.isEnabled("AUD"), true);
    assert.equal(registry.isEnabled("USD"), false);
  });

  it("preserves AUD when a deployment opts in another default currency", () => {
    const registry = createCurrencyRegistry({
      enabledCurrencies: ["USD"],
      defaultCurrency: "USD"
    });
    assert.deepEqual(registry.enabledCurrencies, ["AUD", "USD"]);
    assert.equal(registry.defaultCurrency, "USD");
    assert.equal(registry.isEnabled("AUD"), true);
  });

  it("falls back to the enabled default when legacy metadata is blank", () => {
    assert.equal(normaliseBudgetState({ household: { currency: "" } }).household.currency, "AUD");
  });

  it("requires complete metadata for custom currencies", () => {
    const registry = createCurrencyRegistry({
      enabledCurrencies: ["AUD", "XOF"],
      definitions: { XOF: { minorUnit: 0, defaultLocale: "fr-FR" } }
    });
    assert.deepEqual(registry.get("XOF"), { code: "XOF", minorUnit: 0, defaultLocale: "fr-FR" });
    assert.throws(() => createCurrencyRegistry({
      enabledCurrencies: ["XOF"],
      definitions: { XOF: { minorUnit: 0 } }
    }), /default locale/);
  });
});

describe("exact money representation", () => {
  it("parses decimal input to integer minor-unit strings with half-up rounding", () => {
    const registry = createCurrencyRegistry({ enabledCurrencies: ["AUD"] });
    assert.equal(parseMajorToMinor("12.345", "AUD", registry), "1235");
    assert.equal(parseMajorToMinor("-12.345", "AUD", registry), "-1235");
    assert.equal(parseMajorToMinor("0.1", "AUD", registry), "10");
    assert.equal(parseMajorToMinor("12", "AUD", registry), "1200");
  });

  it("uses each currency's native minor-unit precision", () => {
    const registry = createCurrencyRegistry({ enabledCurrencies: ["USD", "JPY", "BHD"] });
    assert.equal(parseMajorToMinor("1234.56", "USD", registry), "123456");
    assert.equal(parseMajorToMinor("1234.5", "JPY", registry), "1235");
    assert.equal(parseMajorToMinor("1.2345", "BHD", registry), "1235");
  });

  it("rejects disabled, malformed, and negative values when negative values are not allowed", () => {
    const registry = createCurrencyRegistry({ enabledCurrencies: ["AUD"] });
    assert.throws(() => parseMajorToMinor("1e3", "AUD", registry), /decimal amount/);
    assert.throws(() => parseMajorToMinor("1.00.1", "AUD", registry), /decimal amount/);
    assert.throws(() => parseMajorToMinor("-1.00", "AUD", registry, { allowNegative: false }), /Negative money amounts/);
    assert.throws(() => parseMajorToMinor("1.00", "USD", registry), /not enabled/);
  });

  it("scales minor units with deterministic half-up rounding and formats the result", () => {
    const registry = createCurrencyRegistry({ enabledCurrencies: ["AUD", "USD"] });
    const money = createMoney("USD", "100", registry);
    assert.deepEqual(scaleMinor(money.amountMinor, 1, 3), "33");
    assert.equal(formatMoney(createMoney("USD", "123456", registry), "en-US", registry), "$1,234.56");
  });
});

describe("exact recurring conversions", () => {
  it("rounds recurring conversions once at the minor-unit boundary", () => {
    const registry = createCurrencyRegistry({ enabledCurrencies: ["AUD"] });
    assert.equal(monthlyMinorAmount("10000", "weekly"), "43333");
    assert.equal(monthlyMinorAmount("10000", "yearly"), "833");
    assert.equal(monthlyMinorAmount("100", "monthly"), "100");
    assert.equal(formatMoney(createMoney("AUD", monthlyMinorAmount("10000", "weekly"), registry), "en-AU", registry), "$433.33");
  });

  it("does not compound rounding when converting directly to weekly or annual units", () => {
    assert.equal(weeklyMinorAmount("1", "fortnightly"), "1");
    assert.equal(weeklyMinorAmount("2", "fourWeekly"), "1");
    assert.equal(annualMinorAmount("1", "monthly"), "12");
  });
});

describe("portable state money migration", () => {
  it("stores all monetary leaves as minor-unit strings and restores them as AUD", () => {
    const state = createDefaultBudgetState();
    state.incomes[0].amount = 1218.005;
    state.expenses = [{
      id: "rent",
      name: "Rent",
      category: "Housing",
      amount: 500,
      frequency: "weekly",
      due: "",
      reservedAmount: 12.345
    }];
    state.paydayPlan.history = [{
      id: "payday-1",
      paydayDate: "2026-08-06",
      confirmedAt: "",
      income: 100,
      transfer: 20,
      savings: 10,
      extraDebt: 5,
      safeSpend: -1.25,
      billsPaid: 1
    }];

    const persisted = serialiseBudgetState(state);
    assert.equal(persisted.moneyRepresentation, "minor-unit-string");
    assert.equal(persisted.household.currency, "AUD");
    assert.equal(persisted.currency, "AUD");
    assert.equal(persisted.incomes[0].amount, "121801");
    assert.equal(persisted.expenses[0].reservedAmount, "1235");
    assert.equal(persisted.paydayPlan.history[0].safeSpend, "-125");

    const restored = parsePersistedBudgetState(persisted);
    assert.equal(restored.household.currency, "AUD");
    assert.equal(restored.incomes[0].amount, 1218.01);
    assert.equal(restored.expenses[0].reservedAmount, 12.35);
    assert.equal(restored.paydayPlan.history[0].safeSpend, -1.25);
  });

  it("rejects a persisted currency that is not in the configured allowlist", () => {
    const persisted = serialiseBudgetState(createDefaultBudgetState());
    persisted.household.currency = "USD";
    assert.throws(() => parsePersistedBudgetState(persisted), /not enabled/);
  });
});
