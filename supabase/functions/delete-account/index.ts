import { withSupabase } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

const securedHandler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "DELETE") {
    return Response.json({ message: "Method not allowed" }, { status: 405 });
  }

  const userId = context.userClaims?.sub;
  if (!userId) {
    return Response.json({ message: "Authentication required" }, { status: 401 });
  }

  const assurance = await context.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) {
    return Response.json({ message: "Could not verify account security" }, { status: 503 });
  }
  if (
    assurance.data.nextLevel === "aal2"
    && assurance.data.currentLevel !== "aal2"
  ) {
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
