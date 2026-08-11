import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lifecycleEmailFor, sendLifecycleEmail, type LifecycleEmailKind } from "../_shared/beta-email.ts";
import { captureServerError } from "../_shared/monitoring.ts";

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
  return asString(object.subscription) ?? asString(asObject(object.subscription).id);
}

async function verifySignature(payload: string, header: string, secret: string): Promise<boolean> {
  try {
    const fields = header.split(",").map((part) => part.trim().split("=", 2));
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
  } catch {
    return false;
  }
}

async function stripeGetSubscription(subscriptionId: string, secret: string): Promise<StripeObject> {
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(8_000)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "Stripe subscription lookup failed");
  return asObject(payload);
}

async function withTimeout<T>(operation: PromiseLike<T>, milliseconds = 8_000): Promise<T> {
  return Promise.race([
    Promise.resolve(operation),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Supabase operation timed out")), milliseconds);
    })
  ]);
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
    currentPeriodEnd: toIso(subscription.current_period_end) ?? toIso(firstItem.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    userId: metadataUserId(subscription) ?? metadataUserId(fallback)
  };
}

async function findKnownUserId(
  admin: SupabaseClient<any>,
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

interface BillingEventLifecycle {
  lifecycle_event_name: string | null;
  lifecycle_user_id: string | null;
  lifecycle_email_kind: LifecycleEmailKind | null;
  lifecycle_event_recorded_at: string | null;
  lifecycle_email_sent_at: string | null;
}

async function deliverLifecycleEmail(
  admin: SupabaseClient<any>,
  eventId: string,
  claimToken: string,
  lifecycle: BillingEventLifecycle,
  currentPeriodEnd: string | null
): Promise<boolean> {
  if (!lifecycle.lifecycle_email_kind || !lifecycle.lifecycle_user_id || lifecycle.lifecycle_email_sent_at) return false;

  try {
    const { data: account, error: accountError } = await withTimeout(
      admin.auth.admin.getUserById(lifecycle.lifecycle_user_id)
    );
    if (accountError || !account.user?.email) {
      console.error("Lifecycle email could not be addressed", {
        kind: lifecycle.lifecycle_email_kind,
        message: accountError?.message ?? "No account email was available"
      });
      return false;
    }

    const wasSent = await sendLifecycleEmail({
      kind: lifecycle.lifecycle_email_kind,
      recipient: account.user.email,
      previousStatus: null,
      nextStatus: "active",
      currentPeriodEnd,
      idempotencyKey: `harbourline-lifecycle-${eventId}-${lifecycle.lifecycle_email_kind}`
    });
    if (!wasSent) return false;

    const { error: sentAtError } = await admin
      .from("billing_events")
      .update({ lifecycle_email_sent_at: new Date().toISOString() })
      .eq("event_id", eventId)
      .eq("processing_token", claimToken)
      .is("lifecycle_email_sent_at", null);
    if (sentAtError) {
      console.error("Lifecycle email delivery could not be recorded", { kind: lifecycle.lifecycle_email_kind });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Lifecycle email work failed", {
      kind: lifecycle.lifecycle_email_kind,
      message: error instanceof Error ? error.message : "unknown error"
    });
    return false;
  }
}

async function releaseBillingEventClaim(
  admin: SupabaseClient<any>,
  eventId: string,
  claimToken: string,
  errorMessage: string,
  eventType: string
): Promise<boolean> {
  const releasePayload = {
    target_event_id: eventId,
    claim_token: claimToken,
    error_message: errorMessage
  };
  try {
    const releaseResult = await Promise.race([
      admin.rpc("release_billing_event_claim", releasePayload),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Billing claim release timed out")), 3_000);
      })
    ]) as { data: unknown; error: { message?: string } | null };
    if (releaseResult.error) throw new Error(releaseResult.error.message ?? "Billing claim release failed");
    if (releaseResult.data !== true) throw new Error("Billing claim release did not release the claimed event");
    return true;
  } catch (releaseError) {
    try {
      const fallbackResult = await Promise.race([
        admin
          .from("billing_events")
          .update({
            processing_started_at: null,
            processing_token: null,
            last_error: errorMessage.slice(0, 1000)
          })
          .eq("event_id", eventId)
          .eq("processing_token", claimToken)
          .select("event_id"),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Billing claim fallback release timed out")), 3_000);
        })
      ]) as { data: Array<{ event_id: string }> | null; error: { message?: string } | null };
      if (fallbackResult.error) throw new Error(fallbackResult.error.message ?? "Billing claim fallback release failed");
      if (!fallbackResult.data?.some((row) => row.event_id === eventId)) {
        throw new Error("Billing claim fallback release did not release the claimed event");
      }
      return true;
    } catch (fallbackError) {
      console.error("Stripe billing claim release failed", {
        event_type: eventType,
        message: fallbackError instanceof Error ? fallbackError.message : "unknown error",
        initial_message: releaseError instanceof Error ? releaseError.message : "unknown error"
      });
      return false;
    }
  }
}

async function completeBillingEventClaim(
  admin: SupabaseClient<any>,
  eventId: string,
  claimToken: string
): Promise<void> {
  const { data: completed, error } = await Promise.race([
    admin.rpc("complete_billing_event_claim", {
      target_event_id: eventId,
      claim_token: claimToken
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Billing claim completion timed out")), 3_000);
    })
  ]) as { data: unknown; error: { message?: string } | null };
  if (error || completed !== true) {
    throw new Error(error?.message ?? "Billing event claim could not be completed");
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const signatureValid = signature && webhookSecret
    ? await verifySignature(payload, signature, webhookSecret)
    : false;
  if (!signatureValid) {
    console.error("Stripe webhook signature rejected", {
      has_signature_header: Boolean(signature),
      has_webhook_secret: Boolean(webhookSecret),
      signature_fields: signature?.split(",").map((part) => part.trim().split("=", 1)[0]) ?? []
    });
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
  const eventCreatedAt = toIso(event.created);
  if (!eventId || !eventType || !eventCreatedAt) return new Response("Invalid event", { status: 400 });

  const admin = createClient<any>(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const claimToken = crypto.randomUUID();
  let claimRows: unknown = null;
  let claimError: { message?: string } | null = null;
  try {
    const claimResult = await Promise.race([
      admin.rpc("claim_billing_event", {
        target_event_id: eventId,
        target_event_type: eventType,
        claim_token: claimToken
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Billing claim acquisition timed out")), 3_000);
      })
    ]) as { data: unknown; error: { message?: string } | null };
    claimRows = claimResult.data;
    claimError = claimResult.error;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing event claim could not be acquired";
    const released = await releaseBillingEventClaim(admin, eventId, claimToken, message, eventType);
    await captureServerError(error, { function: "stripe-webhook", event_type: eventType });
    if (!released) {
      await captureServerError(new Error("Billing claim release requires operational replay"), {
        function: "stripe-webhook",
        event_type: eventType
      });
    }
    return new Response("Event could not be recorded", { status: 500 });
  }
  const claim = Array.isArray(claimRows)
    ? claimRows[0] as { claimed?: boolean; processed?: boolean } | undefined
    : null;
  if (claimError || !claim) {
    const error = new Error(claimError?.message ?? "Billing event claim response was invalid");
    const released = await releaseBillingEventClaim(admin, eventId, claimToken, error.message, eventType);
    await captureServerError(error, { function: "stripe-webhook", event_type: eventType });
    if (!released) {
      await captureServerError(new Error("Billing claim release requires operational replay"), {
        function: "stripe-webhook",
        event_type: eventType
      });
    }
    return new Response("Event could not be recorded", { status: 500 });
  }
  if (claim.claimed !== true) {
    if (claim.processed === true) return new Response("Already processed", { status: 200 });
    return new Response("Event is already being processed", { status: 500 });
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

      const { data: orderingRows, error: orderingError } = await admin.rpc("apply_billing_subscription_snapshot", {
        target_user_id: userId,
        target_customer_id: snapshot.customerId,
        target_subscription_id: snapshot.subscriptionId,
        target_status: snapshot.status,
        target_price_id: snapshot.priceId,
        target_current_period_end: snapshot.currentPeriodEnd,
        target_cancel_at_period_end: snapshot.cancelAtPeriodEnd,
        target_event_created_at: eventCreatedAt,
        target_event_id: eventId
      });
      const ordering = Array.isArray(orderingRows)
        ? orderingRows[0] as { applied?: boolean; previous_status?: string | null } | undefined
        : null;
      if (orderingError || !ordering || typeof ordering.applied !== "boolean") {
        throw new Error(orderingError?.message ?? "Billing subscription ordering could not be applied");
      }

      const { data: billingEvent, error: billingEventError } = await admin
        .from("billing_events")
        .select("lifecycle_event_name, lifecycle_user_id, lifecycle_email_kind, lifecycle_event_recorded_at, lifecycle_email_sent_at")
        .eq("event_id", eventId)
        .eq("processing_token", claimToken)
        .single();
      if (billingEventError || !billingEvent) throw new Error(billingEventError?.message ?? "Billing event claim could not be loaded");

      let lifecycle = billingEvent as BillingEventLifecycle;
      if (!ordering.applied) {
        await completeBillingEventClaim(admin, eventId, claimToken);
        return new Response("ok", { status: 200 });
      }

      const previousStatus = ordering.previous_status ?? null;
      if (!lifecycle.lifecycle_event_name) {
        const lifecycleEvent = lifecycleEventName(previousStatus, snapshot.status);
        if (lifecycleEvent) {
          const emailKind = lifecycleEmailFor({ previousStatus, nextStatus: snapshot.status })?.kind ?? null;
          const { data: plannedLifecycle, error: planError } = await admin
            .from("billing_events")
            .update({
              lifecycle_event_name: lifecycleEvent,
              lifecycle_user_id: userId,
              lifecycle_email_kind: emailKind
            })
            .eq("event_id", eventId)
            .eq("processing_token", claimToken)
            .select("lifecycle_event_name, lifecycle_user_id, lifecycle_email_kind, lifecycle_event_recorded_at, lifecycle_email_sent_at")
            .single();
          if (planError || !plannedLifecycle) throw new Error(planError?.message ?? "Lifecycle event could not be planned");
          lifecycle = plannedLifecycle as BillingEventLifecycle;
        }
      }

      if (lifecycle.lifecycle_event_name && lifecycle.lifecycle_user_id) {
        const { error: lifecycleEventError } = await admin.from("beta_operational_events").insert({
          user_id: lifecycle.lifecycle_user_id,
          event_name: lifecycle.lifecycle_event_name,
          source_billing_event_id: eventId
        });
        if (lifecycleEventError && lifecycleEventError.code !== "23505") {
          throw new Error(lifecycleEventError.message);
        }

        const { error: recordedError } = await admin
          .from("billing_events")
          .update({ lifecycle_event_recorded_at: new Date().toISOString() })
          .eq("event_id", eventId)
          .eq("processing_token", claimToken)
          .is("lifecycle_event_recorded_at", null);
        if (recordedError) throw new Error(recordedError.message);

        lifecycle = { ...lifecycle, lifecycle_event_recorded_at: new Date().toISOString() };
        await deliverLifecycleEmail(admin, eventId, claimToken, lifecycle, snapshot.currentPeriodEnd);
      }
    }

    await completeBillingEventClaim(admin, eventId, claimToken);
    return new Response("ok", { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Billing event could not be processed";
    console.error("Stripe webhook processing failed", { event_type: eventType, message });
    const released = await releaseBillingEventClaim(admin, eventId, claimToken, message, eventType);
    await captureServerError(error, { function: "stripe-webhook", event_type: eventType });
    if (!released) {
      await captureServerError(new Error("Billing claim release requires operational replay"), {
        function: "stripe-webhook",
        event_type: eventType
      });
    }
    return new Response("Billing event could not be processed", { status: 500 });
  }
});
