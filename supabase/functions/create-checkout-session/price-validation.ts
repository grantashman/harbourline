export interface StripePriceContract {
  active?: unknown;
  currency?: unknown;
  type?: unknown;
  unit_amount?: unknown;
  product?: unknown;
  recurring?: unknown;
}

interface RecurringContract {
  interval?: unknown;
  interval_count?: unknown;
}

/**
 * Checkout is intentionally limited to the reviewed weekly subscription price.
 * Budget currencies do not trigger FX or change the Stripe catalogue price.
 */
export function isConfiguredStripePrice(
  price: StripePriceContract | null | undefined,
  expectedCurrency: string,
  expectedProductId: string
): boolean {
  if (!price || typeof price !== "object") return false;
  const currency = expectedCurrency.trim().toLowerCase();
  const recurring = price.recurring && typeof price.recurring === "object"
    ? price.recurring as RecurringContract
    : null;
  return /^[a-z]{3}$/.test(currency)
    && price.active === true
    && price.currency === currency
    && price.type === "recurring"
    && price.unit_amount === 250
    && price.product === expectedProductId.trim()
    && recurring?.interval === "week"
    && recurring.interval_count === 1;
}
