import {
  BetaOnboardingProgress,
  BetaOnboardingStep,
  corsHeaders,
  createServiceRoleClient,
  errorResponse,
  HttpError,
  jsonResponse,
  requireAuthenticatedUser,
  validateClientBetaEvent,
  validateBetaOnboardingStep
} from "../_shared/beta.ts";
import { sendSignupNotification } from "../_shared/beta-email.ts";

type RequestAction = "get" | "progress" | "event" | "signup-notification";

interface ProgressRequest {
  action: RequestAction;
  householdId?: string | null;
  householdIdSupplied?: boolean;
  step?: BetaOnboardingStep;
  eventName?: string;
}

interface SignupEventRow {
  id: string;
  operator_notification_sent_at: string | null;
  signup_verified_at: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateHouseholdId(value: unknown, supplied: boolean): string | null | undefined {
  if (!supplied) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, "householdId must be a non-empty UUID or null");
  }
  return value;
}

function parseRequestBody(value: unknown): ProgressRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be an object");
  }

  const body = value as Record<string, unknown>;
  const allowedKeys = new Set(["action", "householdId", "step", "eventName"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new HttpError(400, "Request body contains unsupported fields");
  }
  if (
    body.action !== "get" &&
    body.action !== "progress" &&
    body.action !== "event" &&
    body.action !== "signup-notification"
  ) {
    throw new HttpError(400, "Unsupported beta action");
  }
  const householdId = validateHouseholdId(body.householdId, hasOwn(body, "householdId"));

  if (body.action === "get" || body.action === "signup-notification") {
    if (hasOwn(body, "householdId") || hasOwn(body, "step") || hasOwn(body, "eventName")) {
      throw new HttpError(400, `${body.action} does not accept progress or event fields`);
    }
    return { action: body.action };
  }

  if (body.action === "progress") {
    if (hasOwn(body, "eventName") || !hasOwn(body, "step")) {
      throw new HttpError(400, "progress requires step and does not accept eventName");
    }
    return {
      action: "progress",
      householdId,
      householdIdSupplied: hasOwn(body, "householdId"),
      step: validateBetaOnboardingStep(body.step)
    };
  }

  if (hasOwn(body, "step") || !hasOwn(body, "eventName")) {
    throw new HttpError(400, "event requires eventName and does not accept step");
  }
  return {
    action: "event",
    householdId,
    eventName: validateClientBetaEvent(body.eventName)
  };
}

async function requireHouseholdMembership(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  householdId: string,
  userId: string
): Promise<void> {
  const { data: membership, error } = await serviceClient
    .from("household_members")
    .select("household_id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!membership) throw new HttpError(403, "You do not belong to this household");
}

function toProgress(row: {
  household_id: string | null;
  step: BetaOnboardingStep;
  completed_at: string | null;
}): BetaOnboardingProgress {
  return {
    householdId: row.household_id,
    step: row.step,
    completedAt: row.completed_at
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

  try {
    const user = await requireAuthenticatedUser(request);
    const body = parseRequestBody(await request.json().catch(() => null));
    const serviceClient = createServiceRoleClient();

    if (body.action === "get") {
      const { data, error } = await serviceClient
        .from("beta_onboarding")
        .select("household_id, step, completed_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse({ message: "Onboarding progress was not found" }, 404);
      return jsonResponse(toProgress(data as Parameters<typeof toProgress>[0]));
    }

    if (body.action === "signup-notification") {
      const { data, error } = await serviceClient
        .from("beta_operational_events")
        .select("id, operator_notification_sent_at, signup_verified_at")
        .eq("user_id", user.id)
        .eq("event_name", "signup_completed")
        .maybeSingle();
      if (error) throw error;
      const eventRow = data as SignupEventRow | null;
      if (!eventRow?.signup_verified_at || eventRow.operator_notification_sent_at || !user.email) {
        return jsonResponse({ recorded: false }, 200);
      }
      const delivered = await sendSignupNotification({
        signupEmail: user.email,
        provider: typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : null,
        createdAt: user.created_at,
        idempotencyKey: `harbourline-signup-${user.id}`
      });
      if (!delivered) {
        throw new HttpError(503, "Signup notification delivery failed; retryable");
      }
      const { error: notificationError } = await serviceClient
        .from("beta_operational_events")
        .update({ operator_notification_sent_at: new Date().toISOString() })
        .eq("id", eventRow.id)
        .is("operator_notification_sent_at", null);
      if (notificationError) throw notificationError;
      return jsonResponse({ recorded: true }, 200);
    }

    if (body.action === "progress") {
      const step = validateBetaOnboardingStep(body.step);
      if (body.householdId !== null && body.householdId !== undefined) {
        await requireHouseholdMembership(serviceClient, body.householdId, user.id);
      }
      const payload: Record<string, unknown> = {
        user_id: user.id,
        step
      };
      if (body.householdIdSupplied) payload.household_id = body.householdId ?? null;
      if (step === "complete") payload.completed_at = new Date().toISOString();

      const { data, error } = await serviceClient
        .from("beta_onboarding")
        .upsert(payload, { onConflict: "user_id" })
        .select("household_id, step, completed_at")
        .single();
      if (error) throw error;
      return jsonResponse(toProgress(data as Parameters<typeof toProgress>[0]));
    }

    const eventName = validateClientBetaEvent(body.eventName);
    if (body.householdId !== null && body.householdId !== undefined) {
      await requireHouseholdMembership(serviceClient, body.householdId, user.id);
    }
    const { error } = await serviceClient.from("beta_operational_events").insert({
      user_id: user.id,
      household_id: body.householdId ?? null,
      event_name: eventName
    });
    if (error) throw error;
    return jsonResponse({ recorded: true }, 201);
  } catch (error) {
    return errorResponse(error);
  }
});
