import { isValidAuthCallbackState } from "./auth-callback-state.ts";

export type ApprovedAuthReturn = {
  account?: "signin";
  provider?: "google";
  code?: string;
  recovery?: "1";
  billing?: "success" | "cancelled" | "portal";
  calendar?: "connected" | "error";
  state?: string;
};

function hasExactlyOneValue(query: URLSearchParams, key: string, values: Set<string>): boolean {
  const entries = query.getAll(key);
  return entries.length === 1 && values.has(entries[0] ?? "");
}

/**
 * Accept only callback tuples emitted by Harbourline. This intentionally
 * rejects unknown keys, duplicate keys, and mixed intents other than the
 * existing billing/account return combination.
 */
export function parseApprovedAuthReturn(query: URLSearchParams): ApprovedAuthReturn | null {
  const keys = [...query.keys()];
  const uniqueKeys = new Set(keys);
  if (keys.length === 0 || uniqueKeys.size !== keys.length) return null;

  const isBillingAccount = uniqueKeys.size === 2 && uniqueKeys.has("billing") && uniqueKeys.has("account");
  const isAuthIntent = uniqueKeys.has("account") || uniqueKeys.has("recovery");
  const isAuthNavigation = uniqueKeys.size === 1 && uniqueKeys.has("account");
  const isGoogleAuthNavigation = uniqueKeys.size === 2 && uniqueKeys.has("account") && uniqueKeys.has("provider");
  const isAuthCodeCallback = uniqueKeys.size === 3 && uniqueKeys.has("account") && uniqueKeys.has("state") && uniqueKeys.has("code");
  const isAuthWithState = uniqueKeys.size === 2 &&
    isAuthIntent && uniqueKeys.has("state") && !(uniqueKeys.has("account") && uniqueKeys.has("recovery"));
  if (!isAuthNavigation && !isGoogleAuthNavigation && !isAuthCodeCallback && uniqueKeys.size !== 1 && !isBillingAccount && !isAuthWithState) return null;

  const allowedKeys = new Set(["account", "provider", "code", "recovery", "billing", "calendar", "state"]);
  if ([...uniqueKeys].some((key) => !allowedKeys.has(key))) return null;
  if (query.has("account") && !hasExactlyOneValue(query, "account", new Set(["signin"]))) return null;
  if (query.has("provider") && !hasExactlyOneValue(query, "provider", new Set(["google"]))) return null;
  if (query.has("code")) {
    const code = query.get("code");
    if (!code || !hasExactlyOneValue(query, "code", new Set([code]))) return null;
  }
  if (query.has("recovery") && !hasExactlyOneValue(query, "recovery", new Set(["1"]))) return null;
  if (query.has("billing") && !hasExactlyOneValue(query, "billing", new Set(["success", "cancelled", "portal"]))) return null;
  if (query.has("calendar") && !hasExactlyOneValue(query, "calendar", new Set(["connected", "error"]))) return null;
  if (query.has("state") && !hasExactlyOneValue(query, "state", new Set([query.get("state") ?? ""]))) return null;
  if (query.has("state") && !isValidAuthCallbackState(query.get("state"))) return null;
  if (query.has("state") && !isAuthIntent) return null;
  if (query.has("code") && !isAuthCodeCallback) return null;
  if (query.has("provider") && !query.has("account")) return null;
  if (isAuthIntent && !isAuthNavigation && !isGoogleAuthNavigation && !isAuthCodeCallback && !isBillingAccount && !query.has("state")) return null;

  return {
    ...(query.has("account") ? { account: "signin" as const } : {}),
    ...(query.has("provider") ? { provider: "google" as const } : {}),
    ...(query.has("code") ? { code: query.get("code") ?? "" } : {}),
    ...(query.has("recovery") ? { recovery: "1" as const } : {}),
    ...(query.has("billing") ? { billing: query.get("billing") as ApprovedAuthReturn["billing"] } : {}),
    ...(query.has("calendar") ? { calendar: query.get("calendar") as ApprovedAuthReturn["calendar"] } : {}),
    ...(query.has("state") ? { state: query.get("state") ?? undefined } : {})
  };
}

export function isApprovedAccountCallbackTransport(
  callback: ApprovedAuthReturn | null,
  hasHash: boolean
): boolean {
  if (callback?.account !== "signin") return false;
  if (callback.code && hasHash) return false;
  if (callback.state && !hasHash && !callback.code) return false;
  if (!callback.state && hasHash) return false;
  return true;
}