import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendLifecycleEmail } from "../_shared/beta-email.ts";

type StripeObject = Record<string, unknown>;

interface SubscriptionSnapshot {
  customerId: string | null;
  subscriptionId: string | null;
  status: string | null;
  priceId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  userId: string | null;
}

const subscriptionEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.finalization_failed"
]);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function asObject(value: unknown): StripeObject {
  return value && typeof value === "object" ? value as StripeObject : {};
}

function metadataUserId(object: StripeObject): string | null {
  const subscriptionDetails = asObject(object.subscription_details);
  return asString(asObject(object.metadata).user_id)
    ?? asString(asObject(subscriptionDetails.metadata).user_id)
    ?? asString(object.client_reference_id);
}

function toIso(seconds: unknown): string | null {
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;
}

function subscriptionIdFor(eventType: string, object: StripeObject): string | null {
  if (eventType.startsWith("customer.subscription.")) return asString(object.id);
  return asString(object.subscription);
}

async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  const fields = header.split(",").map((part) => part.split("=", 2));
  const timestamp = Number(fields.find(([key]) => key === "t")?.[1]);
  const signatures = fields
    .filter(([key, value]) => key === "v1" && Boolean(value))
    .map(([, value]) => value!);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !signatures.length) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`)
  );
  const expected = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return signatures.includes(expected);
}

async function stripeGetSubscription(subscriptionId: string, secret: string): Promise<StripeObject> {
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "Stripe subscription lookup failed");
  return asObject(payload);
}

function snapshotFromSubscription(subscription: StripeObject, fallback: StripeObject): SubscriptionSnapshot {
  const items = asObject(subscription.items);
  const firstItem = Array.isArray(items.data) ? asObject(items.data[0]) : {};
  const price = asObject(firstItem.price);
  return {
    customerId: asString(subscription.customer) ?? asString(fallback.customer),
    subscriptionId: asString(subscription.id) ?? asString(fallback.subscription),
    status: asString(subscription.status),
    priceId: asString(price.id),
    currentPeriodEnd: toIso(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    userId: metadataUserId(subscription) ?? metadataUserId(fallback)
  };
}

async function findKnownUserId(
  admin: ReturnType<typeof createClient>,
  subscriptionId: string | null,
  customerId: string | null
): Promise<string | null> {
  if (subscriptionId) {
    const { data } = await admin
      .from("billing_subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (data?.user_id) return String(data.user_id);
  }
  if (customerId) {
    const { data } = await admin
      .from("billing_subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (data?.user_id) return String(data.user_id);
  }
  return null;
}

function lifecycleEventName(previousStatus: string | null, nextStatus: string): string | null {
  if (previousStatus === nextStatus) return null;
  if (nextStatus === "active") return "subscription_activated";
  if (nextStatus === "past_due") return "subscription_past_due";
  if (nextStatus === "canceled") return "subscription_cancelled";
  return null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!signature || !webhookSecret || !(await verifySignature(payload, signature, webhookSecret))) {
    return new Response("Invalid signature", { status: 400 });
  }
  if (!stripeSecret) return new Response("Billing is not configured", { status: 503 });

  let event: StripeObject;
  try {
    event = asObject(JSON.parse(payload));
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  const eventId = asString(event.id);
  const eventType = asString(event.type);
  if (!eventId || !eventType) return new Response("Invalid event", { status: 400 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error: receivedError } = await admin
    .from("billing_events")
    .insert({ event_id: eventId, event_type: eventType });
  if (receivedError?.code === "23505") {
    const { data: existing, error: existingError } = await admin
      .from("billing_events")
      .select("processed_at")
      .eq("event_id", eventId)
      .maybeSingle();
    if (existingError) return new Response("Event status could not be loaded", { status: 500 });
    if (existing?.processed_at) return new Response("Already processed", { status: 200 });
  } else if (receivedError) {
    return new Response("Event could not be recorded", { status: 500 });
  }

  try {
    if (subscriptionEvents.has(eventType)) {
      const object = asObject(asObject(event.data).object);
      const subscriptionId = subscriptionIdFor(eventType, object);
      if (!subscriptionId) throw new Error("Subscription identifier was missing from billing event");

      const subscription = await stripeGetSubscription(subscriptionId, stripeSecret);
      const snapshot = snapshotFromSubscription(subscription, object);
      const userId = snapshot.userId ?? await findKnownUserId(admin, snapshot.subscriptionId, snapshot.customerId);
      if (!userId || !snapshot.subscriptionId || !snapshot.status) {
        throw new Error("Subscription could not be matched to a Harbourline account");
      }

      const { data: previousBilling, error: previousBillingError } = await admin
        .from("billing_subscriptions")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();
      if (previousBillingError) throw new Error(previousBillingError.message);
      const previousStatus = previousBilling?.status ?? null;

      const { error: subscriptionError } = await admin.from("billing_subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: snapshot.customerId,
        stripe_subscription_id: snapshot.subscriptionId,
        status: snapshot.status,
        price_id: snapshot.priceId,
        current_period_end: snapshot.currentPeriodEnd,
        cancel_at_period_end: snapshot.cancelAtPeriodEnd,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      if (subscriptionError) throw new Error(subscriptionError.message);

      const lifecycleEvent = lifecycleEventName(previousStatus, snapshot.status);
      if (lifecycleEvent) {
        const { error: lifecycleEventError } = await admin.from("beta_operational_events").insert({
          user_id: userId,
          event_name: lifecycleEvent
        });
        if (lifecycleEventError) throw new Error(lifecycleEventError.message);

        const { data: account, error: accountError } = await admin.auth.admin.getUserById(userId);
        if (accountError || !account.user?.email) {
          console.error("Lifecycle email could not be addressed", {
            kind: lifecycleEvent,
            message: accountError?.message ?? "No account email was available"
          });
        } else {
          await sendLifecycleEmail({
            recipient: account.user.email,
            previousStatus,
            nextStatus: snapshot.status,
            currentPeriodEnd: snapshot.currentPeriodEnd
          });
        }
      }
    }

    const { error: processedError } = await admin
      .from("billing_events")
      .update({ processed_at: new Date().toISOString(), last_error: null })
      .eq("event_id", eventId);
    if (processedError) throw new Error(processedError.message);
    return new Response("ok", { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing event could not be processed";
    console.error(message);
    await admin.from("billing_events").update({ last_error: message }).eq("event_id", eventId);
    return new Response("Billing event could not be processed", { status: 500 });
  }
});
