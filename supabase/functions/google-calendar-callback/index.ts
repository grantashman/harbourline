import {
  configuredAppOrigin,
  createServiceRoleClient
} from "../_shared/beta.ts";
import {
  encryptRefreshToken,
  exchangeGoogleCode,
  fetchGoogleUser,
  requireGoogleConfig,
  sha256Base64Url
} from "../_shared/google-calendar.ts";

function redirect(returnPath: string, result: "connected" | "error"): Response {
  const url = new URL(returnPath, configuredAppOrigin());
  url.searchParams.set("calendar", result);
  return new Response(null, {
    status: 303,
    headers: { Location: url.toString(), "Cache-Control": "no-store" }
  });
}

Deno.serve(async (request) => {
  const fallback = new URL("/", configuredAppOrigin()).pathname;
  if (request.method !== "GET") return redirect(fallback, "error");
  const query = new URL(request.url).searchParams;
  const state = query.get("state") ?? "";
  const code = query.get("code") ?? "";
  const stateHash = state ? await sha256Base64Url(state) : "";
  const admin = createServiceRoleClient();
  let returnPath = fallback;
  try {
    if (!stateHash) return redirect(returnPath, "error");
    const { data: stateRow } = await admin
      .from("google_calendar_oauth_states")
      .select("state_hash, user_id, code_verifier, return_path, expires_at")
      .eq("state_hash", stateHash)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!stateRow) return redirect(returnPath, "error");
    returnPath = stateRow.return_path || fallback;
    await admin.from("google_calendar_oauth_states").delete().eq("state_hash", stateHash);
    if (!code || query.get("error")) return redirect(returnPath, "error");

    const config = requireGoogleConfig();
    const tokens = await exchangeGoogleCode(config, code, stateRow.code_verifier);
    const googleUser = await fetchGoogleUser(tokens.accessToken);
    const { data: existing } = await admin
      .from("google_calendar_connections")
      .select("encrypted_refresh_token, refresh_token_nonce, calendar_id")
      .eq("user_id", stateRow.user_id)
      .maybeSingle();
    let encryptedRefreshToken = existing?.encrypted_refresh_token;
    let refreshTokenNonce = existing?.refresh_token_nonce;
    if (tokens.refreshToken) {
      const encrypted = await encryptRefreshToken(tokens.refreshToken, config.tokenEncryptionKey);
      encryptedRefreshToken = encrypted.ciphertext;
      refreshTokenNonce = encrypted.nonce;
    }
    if (!encryptedRefreshToken || !refreshTokenNonce) return redirect(returnPath, "error");
    const { error } = await admin.from("google_calendar_connections").upsert({
      user_id: stateRow.user_id,
      google_subject: googleUser.subject,
      google_email: googleUser.email,
      calendar_id: existing?.calendar_id ?? "primary",
      encrypted_refresh_token: encryptedRefreshToken,
      refresh_token_nonce: refreshTokenNonce,
      scope: "openid email https://www.googleapis.com/auth/calendar.events",
      updated_at: new Date().toISOString(),
      sync_error: null
    }, { onConflict: "user_id" });
    if (error) throw error;
    return redirect(returnPath, "connected");
  } catch {
    return redirect(returnPath, "error");
  }
});
