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
  step?: BetaOnboardingStep;
  eventName?: string;
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
  if (body.householdId !== undefined && body.householdId !== null && typeof body.householdId !== "string") {
    throw new HttpError(400, "householdId must be a string or null");
  }
  if (body.step !== undefined && typeof body.step !== "string") {
    throw new HttpError(400, "step must be a string");
  }
  if (body.eventName !== undefined && typeof body.eventName !== "string") {
    throw new HttpError(400, "eventName must be a string");
  }

  return body as ProgressRequest;
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
      const payload: Record<string, unknown> = {
        user_id: user.id,
        household_id: body.householdId ?? null,
        step
      };
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
    if (body.householdId) {
      const { data: membership, error: membershipError } = await serviceClient
        .from("household_members")
        .select("household_id")
        .eq("household_id", body.householdId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new HttpError(403, "You do not belong to this household");
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
