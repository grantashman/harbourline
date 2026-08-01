import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, configuredAppOrigin } from "../_shared/beta.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const authHeader = request.headers.get("Authorization");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader ?? "" } } }
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response("Unauthorised", { status: 401, headers: corsHeaders });

  const { data: billing, error: billingError } = await supabase
    .from("billing_subscriptions")
    .select("stripe_customer_id")
    .maybeSingle();
  if (billingError) return new Response("Billing status could not be loaded", { status: 500, headers: corsHeaders });
  if (!billing?.stripe_customer_id) {
    return new Response("No billing profile was found for this account.", { status: 404, headers: corsHeaders });
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const appUrl = configuredAppOrigin();
  if (!stripeSecret) return new Response("Billing is not configured", { status: 503, headers: corsHeaders });

  const form = new URLSearchParams({
    customer: billing.stripe_customer_id,
    return_url: `${appUrl}?billing=portal&account=signin`
  });
  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  const payload = await response.json();
  if (!response.ok) {
    return new Response(payload.error?.message ?? "Billing could not be opened", { status: 502, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ url: payload.url }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
