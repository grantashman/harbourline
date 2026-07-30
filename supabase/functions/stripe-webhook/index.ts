import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2)));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return expected === parts.v1;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!signature || !secret || !(await verifySignature(payload, signature, secret))) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(payload);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error: eventError } = await admin.from("billing_events").insert({ event_id: event.id, event_type: event.type });
  if (eventError?.code === "23505") return new Response("Already processed", { status: 200 });
  if (eventError) return new Response("Event could not be recorded", { status: 500 });

  const object = event.data?.object ?? {};
  const userId = object.metadata?.user_id ?? object.subscription_details?.metadata?.user_id;
  if (userId && ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    const subscription = event.type === "checkout.session.completed" ? object : object;
    await admin.from("billing_subscriptions").upsert({
      user_id: userId,
      stripe_customer_id: subscription.customer ?? null,
      stripe_subscription_id: subscription.subscription ?? subscription.id ?? null,
      status: event.type === "checkout.session.completed" ? "active" : subscription.status,
      price_id: subscription.items?.data?.[0]?.price?.id ?? null,
      current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
  }
  return new Response("ok", { status: 200 });
});
