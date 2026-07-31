import {
  createServiceRoleClient,
  errorResponse,
  HttpError,
  jsonResponse,
  requireAuthenticatedUser
} from "../_shared/beta.ts";
import {
  calendarEventsEndpoint,
  connectionStatus,
  decryptRefreshToken,
  encryptRefreshToken,
  googleCalendarFetch,
  GoogleApiError,
  listSyncedGoogleEvents,
  refreshGoogleAccessToken,
  requireActiveSubscription,
  requireGoogleConfig,
  type GoogleCalendarConnection
} from "../_shared/google-calendar.ts";

interface InputEvent {
  id: string;
  summary: string;
  startDate: string;
  endDate: string;
}

function validateEvents(value: unknown): InputEvent[] {
  if (!Array.isArray(value) || value.length > 800) throw new HttpError(400, "Calendar event input is invalid");
  const events = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new HttpError(400, "Calendar event input is invalid");
    const event = candidate as Partial<InputEvent>;
    if (
      typeof event.id !== "string" || !/^[a-v0-9-]{5,1024}$/.test(event.id) ||
      (event.summary !== "Harbourline payday" && event.summary !== "Harbourline bill due") ||
      typeof event.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(event.startDate) ||
      typeof event.endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(event.endDate) ||
      event.endDate <= event.startDate
    ) throw new HttpError(400, "Calendar event input is invalid");
    return {
      id: event.id,
      summary: event.summary,
      startDate: event.startDate,
      endDate: event.endDate
    };
  });
  return [...new Map(events.map((event) => [event.id, event])).values()];
}

function eventBody(event: InputEvent): Record<string, unknown> {
  const payday = event.summary === "Harbourline payday";
  return {
    id: event.id,
    summary: event.summary,
    description: payday
      ? "Planned payday from Harbourline. Open Harbourline for private budget details."
      : "Planned bill due date from Harbourline. Open Harbourline for private budget details.",
    start: { date: event.startDate },
    end: { date: event.endDate },
    reminders: { useDefault: false },
    extendedProperties: {
      private: {
        harbourline_sync: "1",
        harbourline_id: event.id
      }
    }
  };
}

async function refreshTokenIfNeeded(
  config: ReturnType<typeof requireGoogleConfig>,
  connection: GoogleCalendarConnection,
  admin: ReturnType<typeof createServiceRoleClient>
): Promise<string> {
  const refreshToken = await decryptRefreshToken(
    connection.encrypted_refresh_token,
    connection.refresh_token_nonce,
    config.tokenEncryptionKey
  );
  const refreshed = await refreshGoogleAccessToken(config, refreshToken);
  if (refreshed.refreshToken) {
    const encrypted = await encryptRefreshToken(refreshed.refreshToken, config.tokenEncryptionKey);
    await admin.from("google_calendar_connections").update({
      encrypted_refresh_token: encrypted.ciphertext,
      refresh_token_nonce: encrypted.nonce,
      updated_at: new Date().toISOString()
    }).eq("user_id", connection.user_id);
  }
  return refreshed.accessToken;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({ ok: true });
  if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);
  let userId = "";
  try {
    const user = await requireAuthenticatedUser(request);
    userId = user.id;
    await requireActiveSubscription(user.id);
    const config = requireGoogleConfig();
    const body = await request.json().catch(() => ({})) as { events?: unknown };
    const desiredEvents = validateEvents(body.events);
    const admin = createServiceRoleClient();
    const { data: connection, error: connectionError } = await admin
      .from("google_calendar_connections")
      .select("user_id, google_subject, google_email, calendar_id, encrypted_refresh_token, refresh_token_nonce, scope, created_at, updated_at, last_synced_at, sync_error")
      .eq("user_id", user.id)
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) throw new HttpError(409, "Connect Google Calendar before syncing");

    const accessToken = await refreshTokenIfNeeded(config, connection, admin);
    const existing = await listSyncedGoogleEvents(accessToken, connection.calendar_id);
    const existingById = new Map(
      existing.flatMap((event) => typeof event.id === "string" ? [[event.id, event] as const] : [])
    );
    const desiredIds = new Set(desiredEvents.map((event) => event.id));
    for (const event of desiredEvents) {
      const endpoint = `${calendarEventsEndpoint(connection.calendar_id)}/${encodeURIComponent(event.id)}`;
      if (existingById.has(event.id)) {
        await googleCalendarFetch(accessToken, endpoint, {
          method: "PUT",
          body: JSON.stringify(eventBody(event))
        });
      } else {
        await googleCalendarFetch(accessToken, calendarEventsEndpoint(connection.calendar_id), {
          method: "POST",
          body: JSON.stringify(eventBody(event))
        });
      }
    }
    for (const event of existing) {
      if (typeof event.id !== "string" || desiredIds.has(event.id)) continue;
      try {
        await googleCalendarFetch(
          accessToken,
          `${calendarEventsEndpoint(connection.calendar_id)}/${encodeURIComponent(event.id)}`,
          { method: "DELETE" }
        );
      } catch (error) {
        if (!(error instanceof GoogleApiError) || ![404, 410].includes(error.status)) throw error;
      }
    }
    const lastSyncedAt = new Date().toISOString();
    const { error: updateError } = await admin.from("google_calendar_connections").update({
      last_synced_at: lastSyncedAt,
      sync_error: null,
      updated_at: lastSyncedAt
    }).eq("user_id", user.id);
    if (updateError) throw updateError;
    return jsonResponse({ ...connectionStatus(connection), lastSyncedAt, error: null });
  } catch (error) {
    if (userId) {
      try {
        const admin = createServiceRoleClient();
        await admin.from("google_calendar_connections").update({
          sync_error: "Google Calendar sync failed. Reconnect and try again.",
          updated_at: new Date().toISOString()
        }).eq("user_id", userId);
      } catch {
        // Keep the original failure response generic.
      }
    }
    return errorResponse(error);
  }
});
