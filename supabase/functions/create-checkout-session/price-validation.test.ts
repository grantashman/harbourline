import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConfiguredStripePrice } from "./price-validation.ts";

describe("Stripe billing price contract", () => {
  it("accepts an active weekly recurring price in the configured currency", () => {
    assert.equal(isConfiguredStripePrice({
      active: true,
      id: "price_reviewed",
      livemode: true,
      currency: "aud",
      type: "recurring",
      unit_amount: 250,
      product: "prod_reviewed",
      recurring: { interval: "week", interval_count: 1 }
    }, "AUD", "prod_reviewed", "price_reviewed"), true);
  });

  it("rejects inactive, one-time, wrong-currency, and non-weekly prices", () => {
    const base = {
      active: true,
      id: "price_reviewed",
      livemode: true,
      currency: "aud",
      type: "recurring",
      unit_amount: 250,
      product: "prod_reviewed",
      recurring: { interval: "week", interval_count: 1 }
    };
    assert.equal(isConfiguredStripePrice({ ...base, active: false }, "AUD", "prod_reviewed", "price_reviewed"), false);
    assert.equal(isConfiguredStripePrice({ ...base, type: "one_time" }, "AUD", "prod_reviewed", "price_reviewed"), false);
    assert.equal(isConfiguredStripePrice({ ...base, currency: "usd" }, "AUD", "prod_reviewed", "price_reviewed"), false);
    assert.equal(isConfiguredStripePrice({ ...base, unit_amount: 300 }, "AUD", "prod_reviewed", "price_reviewed"), false);
    assert.equal(isConfiguredStripePrice({ ...base, product: "prod_other" }, "AUD", "prod_reviewed", "price_reviewed"), false);
    assert.equal(isConfiguredStripePrice({ ...base, id: "price_other" }, "AUD", "prod_reviewed", "price_reviewed"), false);
    assert.equal(isConfiguredStripePrice({ ...base, livemode: false }, "AUD", "prod_reviewed", "price_reviewed", { expectedLiveMode: true }), false);
    assert.equal(isConfiguredStripePrice({ ...base, active: false }, "AUD", "prod_reviewed", "price_reviewed", { requireActive: false }), true);
    assert.equal(isConfiguredStripePrice({ ...base, recurring: { interval: "month", interval_count: 1 } }, "AUD", "prod_reviewed", "price_reviewed"), false);
    assert.equal(isConfiguredStripePrice(null, "AUD", "prod_reviewed", "price_reviewed"), false);
  });
});
