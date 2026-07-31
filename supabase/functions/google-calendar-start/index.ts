import {
  createServiceRoleClient,
  errorResponse,
  HttpError,
  jsonResponse,
  requireAuthenticatedUser
} from "../_shared/beta.ts";
import {
  googleAuthorizationUrl,
  randomBase64Url,
  requireActiveSubscription,
  requireGoogleConfig,
  safeReturnPath,
  sha256Base64Url
} from "../_shared/google-calendar.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({ ok: true });
  if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);
  try {
    const user = await requireAuthenticatedUser(request);
    await requireActiveSubscription(user.id);
    const config = requireGoogleConfig();
    const body = await request.json().catch(() => ({})) as { returnPath?: unknown };
    const state = randomBase64Url(32);
    const codeVerifier = randomBase64Url(48);
    const stateHash = await sha256Base64Url(state);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const admin = createServiceRoleClient();
    const { error } = await admin.from("google_calendar_oauth_states").insert({
      state_hash: stateHash,
      user_id: user.id,
      code_verifier: codeVerifier,
      return_path: safeReturnPath(body.returnPath),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });
    if (error) throw new HttpError(503, "Google Calendar connection could not be prepared");
    return jsonResponse({ authorizationUrl: googleAuthorizationUrl(config, state, codeChallenge) });
  } catch (error) {
    return errorResponse(error);
  }
});
