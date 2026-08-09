import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureServerError } from "./monitoring.ts";

export const BETA_EVENT_NAMES = [
  "checkout_started",
  "subscription_activated",
  "onboarding_started",
  "household_created",
  "income_added",
  "five_bills_added",
  "payday_viewed",
  "onboarding_completed",
  "support_requested",
  "signup_completed",
  "subscription_past_due",
  "subscription_cancelled"
] as const;

export type BetaEventName = (typeof BETA_EVENT_NAMES)[number];

export const CLIENT_BETA_EVENT_NAMES = [
  "onboarding_started",
  "household_created",
  "income_added",
  "five_bills_added",
  "payday_viewed",
  "onboarding_completed",
  "support_requested"
] as const;

export type ClientBetaEventName = (typeof CLIENT_BETA_EVENT_NAMES)[number];

export type BetaOnboardingStep =
  | "household"
  | "income"
  | "bills"
  | "payday"
  | "complete";

export interface BetaOnboardingProgress {
  householdId: string | null;
  step: BetaOnboardingStep;
  completedAt: string | null;
}

export interface BetaOperationsSnapshot {
  daily: Array<{ day: string; eventName: string; count: number }>;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  cancelledSubscriptions: number;
}

const defaultAppOrigin = "https://harbourline.app";
const allowedAppOrigins = new Set([
  "https://harbourline.app",
  "https://www.harbourline.app"
]);
const legacyAppOrigins = new Set(["https://harbourline-zeta.vercel.app"]);

export function configuredAppOrigin(): string {
  const appUrl = Deno.env.get("HARBOURLINE_APP_URL");
  if (!appUrl) return defaultAppOrigin;

  try {
    const origin = new URL(appUrl).origin;
    if (legacyAppOrigins.has(origin)) return defaultAppOrigin;
    return allowedAppOrigins.has(origin) ? origin : defaultAppOrigin;
  } catch {
    return defaultAppOrigin;
  }
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": configuredAppOrigin(),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const betaEventNames = new Set<string>(BETA_EVENT_NAMES);
const clientBetaEventNames = new Set<string>(CLIENT_BETA_EVENT_NAMES);
const onboardingSteps = new Set<BetaOnboardingStep>([
  "household",
  "income",
  "bills",
  "payday",
  "complete"
]);

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function validateBetaEvent(value: unknown): BetaEventName {
  if (typeof value !== "string" || !betaEventNames.has(value)) {
    throw new HttpError(400, "Unsupported beta event");
  }

  return value as BetaEventName;
}

export function validateClientBetaEvent(value: unknown): ClientBetaEventName {
  if (typeof value !== "string" || !clientBetaEventNames.has(value)) {
    throw new HttpError(400, "Unsupported client beta event");
  }

  return value as ClientBetaEventName;
}

export function validateBetaOnboardingStep(value: unknown): BetaOnboardingStep {
  if (typeof value !== "string" || !onboardingSteps.has(value as BetaOnboardingStep)) {
    throw new HttpError(400, "Unsupported onboarding step");
  }

  return value as BetaOnboardingStep;
}

export function parseOperatorEmails(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function requireAuthenticatedUser(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "Authentication required");
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new HttpError(503, "Authentication is not configured");
  }

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } }
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) {
    throw new HttpError(401, "Authentication required");
  }
  if (user.is_anonymous === true) {
    throw new HttpError(401, "A verified account is required");
  }

  return user;
}

export function createServiceRoleClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new HttpError(503, "Service access is not configured");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ message: error.message }, error.status);
  }

  void captureServerError(error, { function: "beta" });
  return jsonResponse({ message: "The request could not be completed" }, 500);
}
