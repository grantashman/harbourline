import { createClient } from "@supabase/supabase-js";

// This page never boots the planner or reads budget data. Only the production
// marketing site can request a categorical advertising eligibility response.
const marketingOrigin = "https://www.harbourline.app";
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const client = url && key ? createClient(url, key, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;
let generation = 0;
let requestNonce: string | null = null;

async function report(): Promise<void> {
  const nonce = requestNonce;
  const current = ++generation;
  let status: "free" | "paid" | "unknown" = "unknown";
  try {
    // Fail closed if storage is unavailable rather than mistaking a paid user
    // for a guest. www and apex are same-site, so normal storage is shared with
    // the app origin without transferring tokens to the marketing origin.
    const probe = "harbourline-ad-storage-probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    if (client) {
      const session = await client.auth.getSession();
      if (session.error) throw session.error;
      if (!session.data.session) status = "free";
      else {
        const user = await client.auth.getUser();
        if (user.error || !user.data.user) throw user.error ?? new Error("No verified session");
        if (user.data.user.is_anonymous === true) status = "free";
        else if (user.data.user.is_anonymous === false) {
          // Existing server entitlement includes paid household members.
          const entitlement = await client.rpc("has_active_subscription");
          if (entitlement.error || typeof entitlement.data !== "boolean") {
            throw entitlement.error ?? new Error("Unknown entitlement");
          }
          status = entitlement.data ? "paid" : "free";
        }
      }
    }
  } catch { /* Unknown status never authorises advertising. */ }
  if (current === generation && nonce && nonce === requestNonce) {
    parent.postMessage({ type: "harbourline-ad-status", nonce, status }, marketingOrigin);
  }
}
window.addEventListener("message", (event: MessageEvent) => {
  if (event.origin !== marketingOrigin || event.source !== parent) return;
  const message = event.data;
  if (message?.type !== "harbourline-ad-check" || typeof message.nonce !== "string"
    || !/^[a-f0-9-]{36}$/.test(message.nonce)) return;
  requestNonce = message.nonce;
  void report();
});
client?.auth.onAuthStateChange(() => {
  // Never await Supabase calls inside its auth callback (auth lock).
  if (requestNonce) window.setTimeout(() => void report(), 0);
});
