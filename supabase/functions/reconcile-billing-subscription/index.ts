import { createServiceRoleClient, corsHeaders, errorResponse, HttpError, jsonResponse, requireAuthenticatedUser } from "../_shared/beta.ts";
import { isConfiguredStripePrice } from "../_shared/stripe-price-contract.ts";
import { noSubscriptionReconciliation } from "./reconciliation.ts";

type StripeObject = Record<string, unknown>;

const ACCESS_STATUSES = new Set(["active", "trialing"]);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function asObject(value: unknown): StripeObject {
  return value && typeof value === "object" ? value as StripeObject : {};
}

function toIso(seconds: unknown): string | null {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;
}

function metadataUserId(subscription: StripeObject): string | null {
  return asString(asObject(subscription.metadata).user_id)
    ?? asString(asObject(asObject(subscription.subscription_details).metadata).user_id);
}

function subscriptionSnapshot(subscription: StripeObject, customerId: string): {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
  priceId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
} {
  const items = asObject(subscription.items);
  const firstItem = Array.isArray(items.data) ? asObject(items.data[0]) : {};
  const price = asObject(firstItem.price);
  const subscriptionId = asString(subscription.id);
  const status = asString(subscription.status);
  if (!subscriptionId || !status) throw new HttpError(502, "Stripe returned an incomplete subscription.");

  return {
    stripeCustomerId: asString(subscription.customer) ?? customerId,
    stripeSubscriptionId: subscriptionId,
    status,
    priceId: asString(price.id),
    currentPeriodEnd: toIso(subscription.current_period_end) ?? toIso(firstItem.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end)
  };
}

async function stripeGet(path: string, params: Record<string, string>, secret: string): Promise<StripeObject> {
  const url = new URL(`https://api.stripe.com${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (key.endsWith("[]")) url.searchParams.append(key, value);
    else url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const payload = await response.json();
  if (!response.ok) throw new HttpError(502, payload.error?.message ?? "Stripe billing lookup failed.");
  return asObject(payload);
}

function reviewedPriceConfiguration(): { currency: string; productId: string; priceId: string; liveMode: boolean } {
  const currency = Deno.env.get("STRIPE_BILLING_CURRENCY")?.trim().toUpperCase() ?? "";
  const productId = Deno.env.get("STRIPE_PRODUCT_ID")?.trim() ?? "";
  const priceId = Deno.env.get("STRIPE_PRICE_ID")?.trim() ?? "";
  const liveMode = Deno.env.get("STRIPE_LIVE_MODE");
  if (!currency || !productId || !priceId || !liveMode || !["true", "false"].includes(liveMode)) {
    throw new HttpError(503, "Reviewed Stripe price configuration is incomplete.");
  }
  return { currency, productId, priceId, liveMode: liveMode === "true" };
}

function assertReviewedSubscription(subscription: StripeObject): void {
  const items = asObject(subscription.items);
  const itemsData = Array.isArray(items.data) ? items.data : [];
  if (itemsData.length !== 1) throw new HttpError(502, "Stripe returned an unexpected subscription price shape.");
  const price = asObject(asObject(itemsData[0]).price);
  const configuration = reviewedPriceConfiguration();
  if (!isConfiguredStripePrice(price, configuration.currency, configuration.productId, configuration.priceId, { requireActive: false, expectedLiveMode: configuration.liveMode })) {
    throw new HttpError(502, "Stripe subscription price does not match the reviewed subscription contract.");
  }
}

function customerEmail(customer: StripeObject): string | null {
  return asString(customer.email)?.trim().toLowerCase() ?? null;
}

async function subscriptionsForCustomer(customerId: string, secret: string): Promise<StripeObject[]> {
  const payload = await stripeGet("/v1/subscriptions", {
    customer: customerId,
    status: "all",
    limit: "100",
    "expand[]": "data.items.data.price"
  }, secret);
  return Array.isArray(payload.data) ? payload.data.map(asObject) : [];
}

function chooseSubscription(
  candidates: Array<{ customer: StripeObject; subscription: StripeObject }>,
  userId: string,
  email: string,
  existingCustomerId: string | null
): { customer: StripeObject; subscription: StripeObject } | null {
  const owned = candidates.find(({ subscription }) => metadataUserId(subscription) === userId);
  if (owned) return owned;

  const existingCustomer = existingCustomerId
    ? candidates.find(({ customer }) => customer.id === existingCustomerId)
    : null;
  if (existingCustomer) return existingCustomer;

  const matchingEmail = candidates.filter(({ customer, subscription }) =>
    customerEmail(customer) === email && !metadataUserId(subscription)
  );
  const statusRank = (status: unknown): number => {
    if (status === "active") return 5;
    if (status === "trialing") return 4;
    if (["past_due", "unpaid", "paused"].includes(String(status))) return 3;
    if (["incomplete", "incomplete_expired"].includes(String(status))) return 2;
    return 1;
  };
  return matchingEmail
    .sort((left, right) => statusRank(right.subscription.status) - statusRank(left.subscription.status)
      || Number(right.subscription.created ?? 0) - Number(left.subscription.created ?? 0))[0] ?? null;
}

async function hasHouseholdCloudAccess(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  stripeSecret: string
): Promise<boolean> {
  const { data: memberships, error: membershipError } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId);
  if (membershipError) throw new HttpError(500, "Household access could not be reconciled.");
  const householdIds = [...new Set((memberships ?? []).map((row) => row.household_id).filter(Boolean))];
  if (!householdIds.length) return false;

  const { data: householdMembers, error: householdMemberError } = await admin
    .from("household_members")
    .select("user_id")
    .in("household_id", householdIds);
  if (householdMemberError) throw new HttpError(500, "Household access could not be reconciled.");
  const memberIds = [...new Set((householdMembers ?? []).map((row) => row.user_id).filter(Boolean))];
  if (!memberIds.length) return false;

  const { data: activeSubscriptions, error: subscriptionError } = await admin
    .from("billing_subscriptions")
    .select("user_id, stripe_subscription_id, price_id")
    .in("user_id", memberIds)
    .in("status", ["active", "trialing"])
    .limit(100);
  if (subscriptionError) throw new HttpError(500, "Household access could not be reconciled.");
  const reviewedPriceId = reviewedPriceConfiguration().priceId;
  for (const candidate of activeSubscriptions ?? []) {
    if (candidate.price_id !== reviewedPriceId || typeof candidate.stripe_subscription_id !== "string") continue;
    try {
      const subscription = await stripeGet(
        `/v1/subscriptions/${encodeURIComponent(candidate.stripe_subscription_id)}`,
        { "expand[]": "items.data.price" },
        stripeSecret
      );
      assertReviewedSubscription(subscription);
      if (ACCESS_STATUSES.has(String(subscription.status))) return true;
    } catch (error) {
      if (error instanceof HttpError && error.status === 503) throw error;
    }
  }
  return false;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const user = await requireAuthenticatedUser(request);
    const email = user.email?.trim().toLowerCase();
    if (!email) throw new HttpError(400, "This account does not have an email address.");

    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecret) throw new HttpError(503, "Billing is not configured.");

    const admin = createServiceRoleClient();
    const { data: existingBilling, error: billingError } = await admin
      .from("billing_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .maybeSingle();
    if (billingError) throw new HttpError(500, "Billing status could not be loaded.");

    const inheritedHouseholdAccess = await hasHouseholdCloudAccess(admin, user.id, stripeSecret);
    if (inheritedHouseholdAccess) {
      return jsonResponse({
        active: true,
        reconciled: true,
        subscription: existingBilling && ACCESS_STATUSES.has(existingBilling.status)
          ? existingBilling
          : null
      });
    }

    const customers = existingBilling?.stripe_customer_id
      ? [await stripeGet(`/v1/customers/${encodeURIComponent(existingBilling.stripe_customer_id)}`, {}, stripeSecret)]
      : ((await stripeGet("/v1/customers", { email, limit: "100" }, stripeSecret)).data as unknown[] ?? []).map(asObject);

    const candidates: Array<{ customer: StripeObject; subscription: StripeObject }> = [];
    for (const customer of customers) {
      const customerId = asString(customer.id);
      if (!customerId) continue;
      for (const subscription of await subscriptionsForCustomer(customerId, stripeSecret)) {
        candidates.push({ customer, subscription });
      }
    }

    const reviewedCandidates = candidates.filter(({ subscription }) => {
      try {
        assertReviewedSubscription(subscription);
        return true;
      } catch (error) {
        if (error instanceof HttpError && error.status === 503) throw error;
        return false;
      }
    });
    const chosen = chooseSubscription(reviewedCandidates, user.id, email, existingBilling?.stripe_customer_id ?? null);
    if (!chosen) {
      return jsonResponse(noSubscriptionReconciliation(existingBilling));
    }

    const snapshot = subscriptionSnapshot(chosen.subscription, String(chosen.customer.id));
    const { error: upsertError } = await admin.from("billing_subscriptions").upsert({
      user_id: user.id,
      stripe_customer_id: snapshot.stripeCustomerId,
      stripe_subscription_id: snapshot.stripeSubscriptionId,
      status: snapshot.status,
      price_id: snapshot.priceId,
      current_period_end: snapshot.currentPeriodEnd,
      cancel_at_period_end: snapshot.cancelAtPeriodEnd,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
    if (upsertError) throw new HttpError(500, "Billing status could not be reconciled.");

    const subscription = {
      stripe_customer_id: snapshot.stripeCustomerId,
      status: snapshot.status,
      current_period_end: snapshot.currentPeriodEnd,
      cancel_at_period_end: snapshot.cancelAtPeriodEnd
    };
    return jsonResponse({
      active: ACCESS_STATUSES.has(snapshot.status),
      reconciled: true,
      subscription
    });
  } catch (error) {
    return errorResponse(error);
  }
});
