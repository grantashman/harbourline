import { isValidAuthCallbackState } from "./auth-callback-state.ts";

const AUTH_FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const AUTH_ERROR_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type ApprovedAuthReturn = {
  account?: "signin";
  provider?: "google";
  code?: string;
  flowId?: string;
  recovery?: "1";
  billing?: "success" | "cancelled" | "portal";
  calendar?: "connected" | "error";
  state?: string;
};

export type AuthProviderError = {
  account: "signin" | null;
  error: string;
  errorCode: string | null;
  errorDescription: string | null;
  flowId: string | null;
  state: string | null;
};

function hasExactlyOneValue(query: URLSearchParams, key: string, values: Set<string>): boolean {
  const entries = query.getAll(key);
  return entries.length === 1 && values.has(entries[0] ?? "");
}

function hasSafeSingleValue(query: URLSearchParams, key: string, pattern: RegExp): boolean {
  const entries = query.getAll(key);
  return entries.length === 1 && pattern.test(entries[0] ?? "");
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
  const isAuthCodeCallback =
    uniqueKeys.has("account") &&
    uniqueKeys.has("state") &&
    uniqueKeys.has("code") &&
    (uniqueKeys.size === 3 || (uniqueKeys.size === 4 && uniqueKeys.has("sb_flow_id")));
  const isAuthWithState = uniqueKeys.size === 2 &&
    isAuthIntent && uniqueKeys.has("state") && !(uniqueKeys.has("account") && uniqueKeys.has("recovery"));
  if (!isAuthNavigation && !isGoogleAuthNavigation && !isAuthCodeCallback && uniqueKeys.size !== 1 && !isBillingAccount && !isAuthWithState) return null;

  const allowedKeys = new Set(["account", "provider", "code", "sb_flow_id", "recovery", "billing", "calendar", "state"]);
  if ([...uniqueKeys].some((key) => !allowedKeys.has(key))) return null;
  if (query.has("account") && !hasExactlyOneValue(query, "account", new Set(["signin"]))) return null;
  if (query.has("provider") && !hasExactlyOneValue(query, "provider", new Set(["google"]))) return null;
  if (query.has("code")) {
    const code = query.get("code");
    if (!code || !hasExactlyOneValue(query, "code", new Set([code]))) return null;
  }
  if (query.has("sb_flow_id") && !hasSafeSingleValue(query, "sb_flow_id", AUTH_FLOW_ID_PATTERN)) return null;
  if (query.has("recovery") && !hasExactlyOneValue(query, "recovery", new Set(["1"]))) return null;
  if (query.has("billing") && !hasExactlyOneValue(query, "billing", new Set(["success", "cancelled", "portal"]))) return null;
  if (query.has("calendar") && !hasExactlyOneValue(query, "calendar", new Set(["connected", "error"]))) return null;
  if (query.has("state") && !hasExactlyOneValue(query, "state", new Set([query.get("state") ?? ""]))) return null;
  if (query.has("state") && !isValidAuthCallbackState(query.get("state"))) return null;
  if (query.has("state") && !isAuthIntent) return null;
  if (query.has("code") && !isAuthCodeCallback) return null;
  if (query.has("sb_flow_id") && !isAuthCodeCallback) return null;
  if (query.has("provider") && !query.has("account")) return null;
  if (isAuthIntent && !isAuthNavigation && !isGoogleAuthNavigation && !isAuthCodeCallback && !isBillingAccount && !query.has("state")) return null;

  return {
    ...(query.has("account") ? { account: "signin" as const } : {}),
    ...(query.has("provider") ? { provider: "google" as const } : {}),
    ...(query.has("code") ? { code: query.get("code") ?? "" } : {}),
    ...(query.has("sb_flow_id") ? { flowId: query.get("sb_flow_id") ?? "" } : {}),
    ...(query.has("recovery") ? { recovery: "1" as const } : {}),
    ...(query.has("billing") ? { billing: query.get("billing") as ApprovedAuthReturn["billing"] } : {}),
    ...(query.has("calendar") ? { calendar: query.get("calendar") as ApprovedAuthReturn["calendar"] } : {}),
    ...(query.has("state") ? { state: query.get("state") ?? undefined } : {})
  };
}

/**
 * Parse an error returned by Supabase Auth/Google without treating it as an
 * email magic-link callback. The description is returned for diagnostics but
 * callers should prefer the stable error code for user-facing copy.
 */
export function parseAuthProviderError(query: URLSearchParams): AuthProviderError | null {
  const keys = [...query.keys()];
  const uniqueKeys = new Set(keys);
  if (!query.has("error") || keys.length === 0 || uniqueKeys.size !== keys.length) return null;
  const allowedKeys = new Set(["account", "error", "error_code", "error_description", "sb_flow_id", "state"]);
  if ([...uniqueKeys].some((key) => !allowedKeys.has(key))) return null;
  if (!hasSafeSingleValue(query, "error", AUTH_ERROR_PATTERN)) return null;
  if (query.has("error_code") && !hasSafeSingleValue(query, "error_code", AUTH_ERROR_PATTERN)) return null;
  if (query.has("error_description") && !hasExactlyOneValue(query, "error_description", new Set([query.get("error_description") ?? ""]))) return null;
  if (query.has("account") && !hasExactlyOneValue(query, "account", new Set(["signin"]))) return null;
  if (query.has("state") && (!hasExactlyOneValue(query, "state", new Set([query.get("state") ?? ""])) || !isValidAuthCallbackState(query.get("state")))) return null;
  if (query.has("sb_flow_id") && !hasSafeSingleValue(query, "sb_flow_id", AUTH_FLOW_ID_PATTERN)) return null;
  if (query.has("state") && !query.has("account")) return null;
  if (query.has("sb_flow_id") && !query.has("state")) return null;
  return {
    account: query.get("account") as "signin" | null,
    error: query.get("error") ?? "",
    errorCode: query.get("error_code"),
    errorDescription: query.get("error_description"),
    flowId: query.get("sb_flow_id"),
    state: query.get("state")
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
