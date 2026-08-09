import { withSupabase } from "npm:@supabase/server";
import {
  decryptRefreshToken,
  requireGoogleConfig,
  type GoogleCalendarConnection
} from "../_shared/google-calendar.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

const cancellableStripeStatuses = new Set([
  "active",
  "trialing",
  "past_due",
  "incomplete",
  "unpaid",
  "paused"
]);

async function cancelStripeSubscription(subscriptionId: string, secret: string): Promise<void> {
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secret}` }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error("Stripe subscription cancellation failed");
  }
}

async function revokeGoogleToken(refreshToken: string): Promise<void> {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken })
  });
  if (!response.ok && response.status !== 400) {
    throw new Error("Google authorisation revocation failed");
  }
}

const securedHandler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "DELETE") {
    return Response.json({ message: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (body?.confirmation !== "DELETE MY HARBOURLINE ACCOUNT") {
    return Response.json({ message: "Account deletion was not confirmed" }, { status: 400 });
  }

  const userId = context.userClaims?.id;
  if (!userId) {
    return Response.json({ message: "Authentication required" }, { status: 401 });
  }
  const { data: currentUser, error: currentUserError } = await context.supabase.auth.getUser();
  if (currentUserError || !currentUser.user || currentUser.user.id !== userId) {
    return Response.json({ message: "Authentication required" }, { status: 401 });
  }
  if (currentUser.user.is_anonymous !== false) {
    return Response.json({ message: "A verified account is required" }, { status: 403 });
  }

  const assurance = await context.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) {
    return Response.json({ message: "Could not verify account security" }, { status: 503 });
  }
  if (assurance.data.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2") {
    return Response.json(
      { message: "Complete two-step verification before deleting this account" },
      { status: 403 }
    );
  }

  const { data: ownedHouseholds, error: householdError } = await context.supabase
    .from("households")
    .select("id")
    .eq("created_by", userId)
    .limit(1);

  if (householdError) {
    return Response.json({ message: "Could not verify household ownership" }, { status: 503 });
  }
  if (ownedHouseholds?.length) {
    return Response.json(
      { message: "Transfer or delete owned households before deleting this account" },
      { status: 409 }
    );
  }

  const { data: billing, error: billingError } = await context.supabaseAdmin
    .from("billing_subscriptions")
    .select("stripe_subscription_id, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (billingError) {
    return Response.json({ message: "Could not verify billing cleanup" }, { status: 503 });
  }
  if (billing && cancellableStripeStatuses.has(billing.status)) {
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
    if (!stripeSecret || !billing.stripe_subscription_id) {
      return Response.json({ message: "Billing cleanup is not configured" }, { status: 503 });
    }
    try {
      await cancelStripeSubscription(billing.stripe_subscription_id, stripeSecret);
    } catch {
      return Response.json({ message: "Could not cancel the active subscription" }, { status: 502 });
    }
  }

  const { data: connection, error: connectionError } = await context.supabaseAdmin
    .from("google_calendar_connections")
    .select("user_id, google_subject, google_email, calendar_id, encrypted_refresh_token, refresh_token_nonce, scope, created_at, updated_at, last_synced_at, sync_error")
    .eq("user_id", userId)
    .maybeSingle() as { data: GoogleCalendarConnection | null; error: unknown };
  if (connectionError) {
    return Response.json({ message: "Could not verify Calendar cleanup" }, { status: 503 });
  }
  if (connection) {
    let refreshToken: string;
    try {
      const config = requireGoogleConfig();
      refreshToken = await decryptRefreshToken(
        connection.encrypted_refresh_token,
        connection.refresh_token_nonce,
        config.tokenEncryptionKey
      );
      await revokeGoogleToken(refreshToken);
    } catch {
      return Response.json({ message: "Could not revoke Google Calendar access" }, { status: 502 });
    }
  }

  const { error } = await context.supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    return Response.json({ message: "Account deletion could not be completed" }, { status: 500 });
  }

  return Response.json({ deleted: true });
});

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const response = await securedHandler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) {
      headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
