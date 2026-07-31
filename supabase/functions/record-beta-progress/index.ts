import {
  BetaOnboardingProgress,
  BetaOnboardingStep,
  corsHeaders,
  createServiceRoleClient,
  errorResponse,
  HttpError,
  jsonResponse,
  requireAuthenticatedUser,
  validateBetaEvent,
  validateBetaOnboardingStep
} from "../_shared/beta.ts";

type RequestAction = "get" | "progress" | "event";

interface ProgressRequest {
  action: RequestAction;
  householdId?: string | null;
  householdIdSupplied?: boolean;
  step?: BetaOnboardingStep;
  eventName?: string;
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
  if (body.action !== "get" && body.action !== "progress" && body.action !== "event") {
    throw new HttpError(400, "Unsupported beta action");
  }
  const householdId = validateHouseholdId(body.householdId, hasOwn(body, "householdId"));

  if (body.action === "get") {
    if (hasOwn(body, "householdId") || hasOwn(body, "step") || hasOwn(body, "eventName")) {
      throw new HttpError(400, "get does not accept progress or event fields");
    }
    return { action: "get" };
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
    eventName: validateBetaEvent(body.eventName)
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

    const eventName = validateBetaEvent(body.eventName);
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
