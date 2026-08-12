export type ApprovedAuthReturn = {
  account?: "signin";
  recovery?: "1";
  billing?: "success" | "cancelled" | "portal";
  calendar?: "connected" | "error";
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
  if (uniqueKeys.size !== 1 && !isBillingAccount) return null;

  const allowedKeys = new Set(["account", "recovery", "billing", "calendar"]);
  if ([...uniqueKeys].some((key) => !allowedKeys.has(key))) return null;
  if (query.has("account") && !hasExactlyOneValue(query, "account", new Set(["signin"]))) return null;
  if (query.has("recovery") && !hasExactlyOneValue(query, "recovery", new Set(["1"]))) return null;
  if (query.has("billing") && !hasExactlyOneValue(query, "billing", new Set(["success", "cancelled", "portal"]))) return null;
  if (query.has("calendar") && !hasExactlyOneValue(query, "calendar", new Set(["connected", "error"]))) return null;

  return {
    ...(query.has("account") ? { account: "signin" as const } : {}),
    ...(query.has("recovery") ? { recovery: "1" as const } : {}),
    ...(query.has("billing") ? { billing: query.get("billing") as ApprovedAuthReturn["billing"] } : {}),
    ...(query.has("calendar") ? { calendar: query.get("calendar") as ApprovedAuthReturn["calendar"] } : {})
  };
}