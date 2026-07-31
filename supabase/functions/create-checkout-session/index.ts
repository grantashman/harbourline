import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createServiceRoleClient } from "../_shared/beta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://harbourline-zeta.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function stripeValue(value: string): string {
  return value.trim();
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

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const priceId = Deno.env.get("STRIPE_PRICE_ID");
  const couponId = Deno.env.get("STRIPE_FIRST_MONTH_COUPON_ID");
  const appUrl = Deno.env.get("HARBOURLINE_APP_URL") ?? "https://harbourline-zeta.vercel.app/";
  if (!stripeSecret || !priceId) return new Response("Billing is not configured", { status: 503, headers: corsHeaders });

  const { data: existingBilling, error: billingError } = await supabase
    .from("billing_subscriptions")
    .select("stripe_customer_id, status")
    .maybeSingle();
  if (billingError) return new Response("Billing status could not be checked", { status: 500, headers: corsHeaders });
  if (existingBilling && ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(existingBilling.status)) {
    return new Response("An existing subscription needs to be managed from the billing portal.", { status: 409, headers: corsHeaders });
  }

  const admin = createServiceRoleClient();
  const { error: checkoutEventError } = await admin.from("beta_operational_events").insert({
    user_id: user.id,
    event_name: "checkout_started"
  });
  if (checkoutEventError) {
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
  if (couponId && !existingBilling?.stripe_customer_id) form.set("discounts[0][coupon]", stripeValue(couponId));

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  const payload = await response.json();
  if (!response.ok) return new Response(payload.error?.message ?? "Checkout could not be started", { status: 502, headers: corsHeaders });
  return new Response(JSON.stringify({ url: payload.url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
