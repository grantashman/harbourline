export interface StripePriceContract {
  id?: unknown;
  livemode?: unknown;
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

export const REVIEWED_STRIPE_UNIT_AMOUNT = 250;

/**
 * The subscription contract is deliberately fixed until a separately reviewed
 * pricing/catalogue change is released. Historical subscriptions may continue
 * after a Price is archived, so callers can disable the active check when
 * processing webhook/reconciliation events.
 */
export function isConfiguredStripePrice(
  price: StripePriceContract | null | undefined,
  expectedCurrency: string,
  expectedProductId: string,
  expectedPriceId: string,
  options: { requireActive?: boolean; expectedLiveMode?: boolean } = {}
): boolean {
  if (!price || typeof price !== "object") return false;
  const currency = expectedCurrency.trim().toLowerCase();
  const productId = expectedProductId.trim();
  const priceId = expectedPriceId.trim();
  const recurring = price.recurring && typeof price.recurring === "object"
    ? price.recurring as RecurringContract
    : null;
  return /^[a-z]{3}$/.test(currency)
    && productId.length > 0
    && priceId.length > 0
    && (options.expectedLiveMode === undefined || price.livemode === options.expectedLiveMode)
    && (options.requireActive === false || price.active === true)
    && price.id === priceId
    && price.currency === currency
    && price.type === "recurring"
    && price.unit_amount === REVIEWED_STRIPE_UNIT_AMOUNT
    && price.product === productId
    && recurring?.interval === "week"
    && recurring.interval_count === 1;
}
