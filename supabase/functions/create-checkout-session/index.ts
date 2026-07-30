import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  const form = new URLSearchParams({
    mode: "subscription",
    success_url: `${appUrl}?billing=success&account=signin`,
    cancel_url: `${appUrl}?billing=cancelled&account=signin`,
    customer_email: user.email ?? "",
    "line_items[0][price]": stripeValue(priceId),
    "line_items[0][quantity]": "1",
    "subscription_data[metadata][user_id]": user.id,
    "metadata[user_id]": user.id
  });
  if (couponId) form.set("discounts[0][coupon]", stripeValue(couponId));

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
