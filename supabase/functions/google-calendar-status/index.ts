import {
  createServiceRoleClient,
  errorResponse,
  jsonResponse,
  requireAuthenticatedUser
} from "../_shared/beta.ts";
import { connectionStatus } from "../_shared/google-calendar.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({ ok: true });
  if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);
  try {
    const user = await requireAuthenticatedUser(request);
    const admin = createServiceRoleClient();
    const { data, error } = await admin
      .from("google_calendar_connections")
      .select("user_id, google_subject, google_email, calendar_id, encrypted_refresh_token, refresh_token_nonce, scope, created_at, updated_at, last_synced_at, sync_error")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return jsonResponse(connectionStatus(data));
  } catch (error) {
    return errorResponse(error);
  }
});
