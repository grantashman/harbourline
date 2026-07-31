import { createServiceRoleClient, HttpError } from "./beta.ts";

export const GOOGLE_CALENDAR_SCOPE = "openid email https://www.googleapis.com/auth/calendar.events";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: Uint8Array;
}

export interface GoogleCalendarConnection {
  user_id: string;
  google_subject: string;
  google_email: string | null;
  calendar_id: string;
  encrypted_refresh_token: string;
  refresh_token_nonce: string;
  scope: string;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  sync_error: string | null;
}

export class GoogleApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalised = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = `${normalised}${"=".repeat((4 - normalised.length % 4) % 4)}`;
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer(new TextEncoder().encode(value)));
  return base64UrlEncode(new Uint8Array(digest));
}

export function requireGoogleConfig(): GoogleConfig {
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET")?.trim();
  const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI")?.trim();
  const keyValue = Deno.env.get("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY")?.trim();
  if (!clientId || !clientSecret || !redirectUri || !keyValue) {
    throw new HttpError(503, "Google Calendar is not configured");
  }

  let tokenEncryptionKey: Uint8Array;
  try {
    tokenEncryptionKey = base64UrlDecode(keyValue);
  } catch {
    throw new HttpError(503, "Google Calendar encryption is not configured");
  }
  if (tokenEncryptionKey.length !== 32) {
    throw new HttpError(503, "Google Calendar encryption is not configured");
  }
  return { clientId, clientSecret, redirectUri, tokenEncryptionKey };
}

async function encryptionKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", arrayBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptRefreshToken(refreshToken: string, key: Uint8Array): Promise<{
  ciphertext: string;
  nonce: string;
}> {
  const nonceBytes = new Uint8Array(12);
  crypto.getRandomValues(nonceBytes);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: arrayBuffer(nonceBytes) },
    await encryptionKey(key),
    arrayBuffer(new TextEncoder().encode(refreshToken))
  );
  return {
    ciphertext: base64UrlEncode(new Uint8Array(encrypted)),
    nonce: base64UrlEncode(nonceBytes)
  };
}

export async function decryptRefreshToken(ciphertext: string, nonce: string, key: Uint8Array): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(base64UrlDecode(nonce)) },
    await encryptionKey(key),
    arrayBuffer(base64UrlDecode(ciphertext))
  );
  return new TextDecoder().decode(decrypted);
}

export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value.slice(0, 500);
}

export function googleAuthorizationUrl(config: GoogleConfig, state: string, codeChallenge: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  }).toString();
  return url.toString();
}

async function postGoogleForm(endpoint: string, values: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values)
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new GoogleApiError(response.status, "Google authorisation could not be completed");
  return payload;
}

export async function exchangeGoogleCode(
  config: GoogleConfig,
  code: string,
  codeVerifier: string
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const payload = await postGoogleForm("https://oauth2.googleapis.com/token", {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier
  });
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new GoogleApiError(502, "Google did not return an access token");
  return {
    accessToken,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null
  };
}

export async function refreshGoogleAccessToken(
  config: GoogleConfig,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const payload = await postGoogleForm("https://oauth2.googleapis.com/token", {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new GoogleApiError(502, "Google did not return an access token");
  return {
    accessToken,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null
  };
}

export async function fetchGoogleUser(accessToken: string): Promise<{ subject: string; email: string | null }> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.sub !== "string") {
    throw new GoogleApiError(response.status || 502, "Google account details could not be read");
  }
  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null
  };
}

export async function googleCalendarFetch(
  accessToken: string,
  endpoint: string,
  init: RequestInit = {}
): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new GoogleApiError(response.status, "Google Calendar request failed");
  return payload;
}

export async function requireActiveSubscription(userId: string): Promise<void> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("billing_subscriptions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(503, "Subscription status could not be checked");
  if (!data || !["active", "trialing"].includes(data.status)) {
    throw new HttpError(402, "An active Harbourline subscription is required");
  }
}

export function calendarEventsEndpoint(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

export async function listSyncedGoogleEvents(accessToken: string, calendarId: string): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(calendarEventsEndpoint(calendarId));
    url.searchParams.set("privateExtendedProperty", "harbourline_sync=1");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("maxResults", "2500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = await googleCalendarFetch(accessToken, url.toString());
    if (Array.isArray(payload.items)) {
      events.push(...payload.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")));
    }
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : undefined;
  } while (pageToken);
  return events;
}

export function connectionStatus(connection: GoogleCalendarConnection | null): Record<string, unknown> {
  return {
    connected: Boolean(connection),
    googleEmail: connection?.google_email ?? null,
    calendarId: connection?.calendar_id ?? null,
    lastSyncedAt: connection?.last_synced_at ?? null,
    error: connection?.sync_error ?? null
  };
}
