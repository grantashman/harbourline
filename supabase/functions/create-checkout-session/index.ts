import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, createServiceRoleClient, configuredAppOrigin } from "../_shared/beta.ts";
import { isConfiguredStripePrice } from "./price-validation.ts";

function stripeValue(value: string): string {
  return value.trim();
}

function checkoutIdempotencyKey(userId: string): string {
  const window = Math.floor(Date.now() / (5 * 60 * 1000));
  return `harbourline-checkout-${userId}-${window}`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const authHeader = request.headers.get("Authorization");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader ?? "" } } }
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return new Response("Unauthorised", { status: 401, headers: corsHeaders });
  if (user.is_anonymous !== false) return new Response("A verified account is required", { status: 403, headers: corsHeaders });

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const priceId = Deno.env.get("STRIPE_PRICE_ID");
  const productId = Deno.env.get("STRIPE_PRODUCT_ID");
  const billingCurrency = (Deno.env.get("STRIPE_BILLING_CURRENCY") ?? "aud").trim().toLowerCase();
  const appUrl = configuredAppOrigin();
  if (!stripeSecret || !priceId || !productId) return new Response("Billing is not configured", { status: 503, headers: corsHeaders });
  if (!/^[a-z]{3}$/.test(billingCurrency)) return new Response("Billing currency is misconfigured", { status: 500, headers: corsHeaders });

  // Budget currencies are independent from the subscription price currency.
  // Verify the configured Stripe Price rather than attempting an FX conversion.
  let priceResponse: Response;
  let pricePayload: unknown;
  try {
    priceResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${stripeSecret}` },
      signal: AbortSignal.timeout(8_000)
    });
    pricePayload = await priceResponse.json();
  } catch {
    return new Response("Billing price could not be verified", { status: 502, headers: corsHeaders });
  }
  if (!priceResponse.ok || !isConfiguredStripePrice(pricePayload as Record<string, unknown>, billingCurrency, productId)) {
    return new Response("Billing price does not match the reviewed subscription contract", { status: 502, headers: corsHeaders });
  }

  const { data: existingBilling, error: billingError } = await supabase
    .from("billing_subscriptions")
    .select("stripe_customer_id, status")
    .maybeSingle();
  if (billingError) return new Response("Billing status could not be checked", { status: 500, headers: corsHeaders });
  if (existingBilling && ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(existingBilling.status)) {
    return new Response("An existing subscription needs to be managed from the billing portal.", { status: 409, headers: corsHeaders });
  }

  const admin = createServiceRoleClient();
  const idempotencyKey = checkoutIdempotencyKey(user.id);
  const { error: checkoutEventError } = await admin.from("beta_operational_events").insert({
    user_id: user.id,
    event_name: "checkout_started",
    source_checkout_key: idempotencyKey
  });
  if (checkoutEventError && checkoutEventError.code !== "23505") {
    return new Response("Checkout activity could not be recorded", { status: 500, headers: corsHeaders });
  }

  const form = new URLSearchParams({
    mode: "subscription",
    success_url: `${appUrl}?billing=success&account=signin`,
    cancel_url: `${appUrl}?billing=cancelled&account=signin`,
    "line_items[0][price]": stripeValue(priceId),
    "line_items[0][quantity]": "1",
    "subscription_data[metadata][user_id]": user.id,
    "metadata[user_id]": user.id,
    client_reference_id: user.id,
    "managed_payments[enabled]": "false"
  });
  if (existingBilling?.stripe_customer_id) {
    form.set("customer", existingBilling.stripe_customer_id);
  } else if (user.email) {
    form.set("customer_email", user.email);
  }
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey
    },
    body: form
  });
  const payload = await response.json();
  if (!response.ok) return new Response(payload.error?.message ?? "Checkout could not be started", { status: 502, headers: corsHeaders });
  return new Response(JSON.stringify({ url: payload.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
