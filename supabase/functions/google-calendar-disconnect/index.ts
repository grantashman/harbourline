import {
  createServiceRoleClient,
  errorResponse,
  jsonResponse,
  requireAuthenticatedUser
} from "../_shared/beta.ts";
import {
  calendarEventsEndpoint,
  decryptRefreshToken,
  googleCalendarFetch,
  GoogleApiError,
  listSyncedGoogleEvents,
  requireGoogleConfig,
  type GoogleCalendarConnection
} from "../_shared/google-calendar.ts";

async function revokeGoogleToken(refreshToken: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken })
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({ ok: true });
  if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json().catch(() => ({})) as { deleteEvents?: unknown };
    const deleteEvents = body.deleteEvents === true;
    const config = requireGoogleConfig();
    const admin = createServiceRoleClient();
    const { data: connection, error } = await admin
      .from("google_calendar_connections")
      .select("user_id, google_subject, google_email, calendar_id, encrypted_refresh_token, refresh_token_nonce, scope, created_at, updated_at, last_synced_at, sync_error")
      .eq("user_id", user.id)
      .maybeSingle() as { data: GoogleCalendarConnection | null; error: unknown };
    if (error) throw error;
    if (!connection) return jsonResponse({ disconnected: true });

    const refreshToken = await decryptRefreshToken(
      connection.encrypted_refresh_token,
      connection.refresh_token_nonce,
      config.tokenEncryptionKey
    );
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({})) as { access_token?: string };
    const accessToken = tokenPayload.access_token;
    if (deleteEvents && accessToken) {
      const syncedEvents = await listSyncedGoogleEvents(accessToken, connection.calendar_id);
      for (const event of syncedEvents) {
        if (typeof event.id !== "string") continue;
        try {
          await googleCalendarFetch(
            accessToken,
            `${calendarEventsEndpoint(connection.calendar_id)}/${encodeURIComponent(event.id)}`,
            { method: "DELETE" }
          );
        } catch (deleteError) {
          if (!(deleteError instanceof GoogleApiError) || ![404, 410].includes(deleteError.status)) throw deleteError;
        }
      }
    }
    await revokeGoogleToken(refreshToken);
    const { error: deleteError } = await admin.from("google_calendar_connections").delete().eq("user_id", user.id);
    if (deleteError) throw deleteError;
    return jsonResponse({ disconnected: true });
  } catch (error) {
    return errorResponse(error);
  }
});
