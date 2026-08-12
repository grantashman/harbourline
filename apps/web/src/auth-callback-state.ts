export type AuthCallbackIntent = "signin" | "recovery";

export interface PendingAuthCallback {
  state: string;
  intent: AuthCallbackIntent;
  createdAt: number;
  expectedUserId: string | null;
  expectedEmail: string | null;
}

export interface AuthCallbackValidation {
  accepted: boolean;
  pending: PendingAuthCallback | null;
  reason: "accepted" | "missing" | "malformed" | "expired" | "mismatch" | "storage-unavailable";
}

const PENDING_KEY = "harbourline:pending-auth-callback";
const HANDLED_KEY = "harbourline:handled-auth-callback";
const VALIDATED_KEY = "harbourline:validated-auth-callback";
const FAILURE_KEY = "harbourline:invalid-auth-callback";
const MAX_AGE_MS = 10 * 60 * 1000;
const HANDLED_AGE_MS = 15 * 60 * 1000;
const STATE_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageOrNull(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function randomState(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Secure auth callback state is unavailable.");
}

function parseRecord(value: string | null): PendingAuthCallback | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingAuthCallback>;
    if (
      typeof parsed.state !== "string" ||
      !STATE_PATTERN.test(parsed.state) ||
      (parsed.intent !== "signin" && parsed.intent !== "recovery") ||
      typeof parsed.createdAt !== "number" ||
      !Number.isFinite(parsed.createdAt) ||
      (parsed.expectedUserId !== undefined && parsed.expectedUserId !== null && typeof parsed.expectedUserId !== "string") ||
      (parsed.expectedEmail !== undefined && parsed.expectedEmail !== null && typeof parsed.expectedEmail !== "string")
    ) return null;
    return {
      state: parsed.state,
      intent: parsed.intent,
      createdAt: parsed.createdAt,
      expectedUserId: parsed.expectedUserId ?? null,
      expectedEmail: parsed.expectedEmail ?? null
    };
  } catch {
    return null;
  }
}

function isFresh(createdAt: number, now: number): boolean {
  return createdAt <= now && now - createdAt <= MAX_AGE_MS;
}

function readStateMarker(storage: StorageLike | null, now: number): string | null {
  if (!storage) return null;
  const value = storage.getItem(HANDLED_KEY);
  if (!value) return null;
  try {
    const marker = JSON.parse(value) as { state?: unknown; handledAt?: unknown };
    if (
      typeof marker.state !== "string" ||
      !STATE_PATTERN.test(marker.state) ||
      typeof marker.handledAt !== "number" ||
      !Number.isFinite(marker.handledAt) ||
      marker.handledAt > now || now - marker.handledAt > HANDLED_AGE_MS
    ) {
      storage.removeItem(HANDLED_KEY);
      return null;
    }
    return marker.state;
  } catch {
    storage.removeItem(HANDLED_KEY);
    return null;
  }
}

export function createAuthCallbackState(
  intent: AuthCallbackIntent,
  expectedUserId: string | null = null,
  expectedEmail: string | null = null,
  now = Date.now(),
  storage?: StorageLike | null
): string {
  const target = storageOrNull(storage);
  if (!target) throw new Error("Secure auth callback state is unavailable.");
  const state = randomState();
  const pending: PendingAuthCallback = { state, intent, createdAt: now, expectedUserId, expectedEmail };
  try {
    target.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    throw new Error("Secure auth callback state is unavailable.");
  }
  return state;
}

export function isValidAuthCallbackState(value: unknown): value is string {
  return typeof value === "string" && STATE_PATTERN.test(value);
}

export function validateAndConsumeAuthCallbackState(
  intent: AuthCallbackIntent,
  state: string | null,
  now = Date.now(),
  storage?: StorageLike | null
): AuthCallbackValidation {
  const target = storageOrNull(storage);
  if (!target) return { accepted: false, pending: null, reason: "storage-unavailable" };
  if (typeof state !== "string" || !STATE_PATTERN.test(state)) {
    return { accepted: false, pending: null, reason: "malformed" };
  }
  let pending: PendingAuthCallback | null;
  try {
    pending = parseRecord(target.getItem(PENDING_KEY));
    target.removeItem(PENDING_KEY);
  } catch {
    return { accepted: false, pending: null, reason: "storage-unavailable" };
  }
  if (!pending) return { accepted: false, pending: null, reason: "missing" };
  if (!isFresh(pending.createdAt, now)) return { accepted: false, pending, reason: "expired" };
  if (pending.intent !== intent || pending.state !== state) {
    return { accepted: false, pending, reason: "mismatch" };
  }
  return { accepted: true, pending, reason: "accepted" };
}

export function consumePendingAuthCallback(
  intent: AuthCallbackIntent,
  state: string | null,
  now = Date.now(),
  storage?: StorageLike | null
): AuthCallbackValidation {
  const validation = validateAndConsumeAuthCallbackState(intent, state, now, storage);
  if (validation.accepted && validation.pending) {
    rememberHandledAuthCallback(validation.pending.state, now, storage);
  }
  return validation;
}

export function rememberHandledAuthCallback(state: string, now = Date.now(), storage?: StorageLike | null): void {
  const target = storageOrNull(storage);
  if (!target || !STATE_PATTERN.test(state)) return;
  target.setItem(HANDLED_KEY, JSON.stringify({ state, handledAt: now }));
}

export function wasRecentlyHandledAuthCallback(state: string | null, now = Date.now(), storage?: StorageLike | null): boolean {
  if (typeof state !== "string" || !STATE_PATTERN.test(state)) return false;
  return readStateMarker(storageOrNull(storage), now) === state;
}

export function rememberValidatedNativeAuthCallback(
  validation: PendingAuthCallback,
  now = Date.now(),
  storage?: StorageLike | null
): void {
  const target = storageOrNull(storage);
  if (!target) return;
  target.setItem(VALIDATED_KEY, JSON.stringify({ ...validation, validatedAt: now }));
}

export function consumeValidatedNativeAuthCallback(
  intent: AuthCallbackIntent,
  state: string | null,
  storage?: StorageLike | null
): PendingAuthCallback | null {
  const target = storageOrNull(storage);
  if (!target || typeof state !== "string") return null;
  try {
    const value = JSON.parse(target.getItem(VALIDATED_KEY) ?? "null") as (PendingAuthCallback & { validatedAt?: unknown }) | null;
    target.removeItem(VALIDATED_KEY);
    if (
      !value ||
      value.intent !== intent ||
      value.state !== state ||
      typeof value.validatedAt !== "number" ||
      value.validatedAt > Date.now() || Date.now() - value.validatedAt > HANDLED_AGE_MS
    ) return null;
    return {
      state: value.state,
      intent: value.intent,
      createdAt: value.createdAt,
      expectedUserId: value.expectedUserId ?? null,
      expectedEmail: value.expectedEmail ?? null
    };
  } catch {
    target.removeItem(VALIDATED_KEY);
    return null;
  }
}

export function recordInvalidAuthCallback(storage?: StorageLike | null): void {
  storageOrNull(storage)?.setItem(FAILURE_KEY, "1");
}

export function consumeInvalidAuthCallback(storage?: StorageLike | null): boolean {
  const target = storageOrNull(storage);
  if (!target) return false;
  const present = target.getItem(FAILURE_KEY) === "1";
  target.removeItem(FAILURE_KEY);
  return present;
}

export const AUTH_CALLBACK_LIMITS = { maxAgeMs: MAX_AGE_MS, handledAgeMs: HANDLED_AGE_MS } as const;
