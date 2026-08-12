import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_CALLBACK_LIMITS,
  consumeInvalidAuthCallback,
  consumePendingAuthCallback,
  consumeValidatedNativeAuthCallback,
  createAuthCallbackState,
  isValidAuthCallbackState,
  recordInvalidAuthCallback,
  rememberValidatedNativeAuthCallback,
  validateAndConsumeAuthCallbackState,
  wasRecentlyHandledAuthCallback,
  type PendingAuthCallback
} from "./auth-callback-state.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const NOW = Date.now();

test("creates a cryptographically-shaped state and consumes it once", () => {
  const storage = new MemoryStorage();
  const state = createAuthCallbackState("signin", null, "person@example.test", NOW, storage);

  assert.equal(isValidAuthCallbackState(state), true);
  assert.equal(validateAndConsumeAuthCallbackState("signin", state, NOW, storage).reason, "accepted");
  assert.equal(wasRecentlyHandledAuthCallback(state, NOW, storage), false);
  assert.equal(validateAndConsumeAuthCallbackState("signin", state, NOW, storage).reason, "missing");
});

test("records a handled marker only after an accepted callback", () => {
  const storage = new MemoryStorage();
  const state = createAuthCallbackState("signin", null, "person@example.test", NOW, storage);

  const validation = consumePendingAuthCallback("signin", state, NOW, storage);
  assert.equal(validation.accepted, true);
  assert.equal(wasRecentlyHandledAuthCallback(state, NOW, storage), true);
  assert.equal(consumePendingAuthCallback("signin", state, NOW, storage).reason, "missing");
  assert.equal(wasRecentlyHandledAuthCallback(state, NOW + AUTH_CALLBACK_LIMITS.handledAgeMs + 1, storage), false);
});

test("rejects wrong intent, expired, malformed, and future callbacks fail closed", () => {
  const wrongIntentStorage = new MemoryStorage();
  const state = createAuthCallbackState("signin", null, null, NOW, wrongIntentStorage);
  assert.equal(validateAndConsumeAuthCallbackState("recovery", state, NOW, wrongIntentStorage).reason, "mismatch");

  const expiredStorage = new MemoryStorage();
  const expired = createAuthCallbackState("signin", null, null, NOW - AUTH_CALLBACK_LIMITS.maxAgeMs - 1, expiredStorage);
  assert.equal(validateAndConsumeAuthCallbackState("signin", expired, NOW, expiredStorage).reason, "expired");

  const futureStorage = new MemoryStorage();
  const future = createAuthCallbackState("signin", null, null, NOW + 1, futureStorage);
  assert.equal(validateAndConsumeAuthCallbackState("signin", future, NOW, futureStorage).reason, "expired");
  assert.equal(validateAndConsumeAuthCallbackState("signin", "short", NOW, new MemoryStorage()).reason, "malformed");
});

test("native validation is single-use and consumes a mismatched callback", () => {
  const storage = new MemoryStorage();
  const pending: PendingAuthCallback = {
    state: "a".repeat(32),
    intent: "recovery",
    createdAt: NOW,
    expectedUserId: null,
    expectedEmail: "person@example.test"
  };
  rememberValidatedNativeAuthCallback(pending, NOW, storage);
  assert.equal(consumeValidatedNativeAuthCallback("signin", pending.state, storage), null);
  assert.equal(consumeValidatedNativeAuthCallback("recovery", pending.state, storage), null);

  rememberValidatedNativeAuthCallback(pending, NOW, storage);
  assert.deepEqual(consumeValidatedNativeAuthCallback("recovery", pending.state, storage), pending);
  assert.equal(consumeValidatedNativeAuthCallback("recovery", pending.state, storage), null);
});

test("invalid callback markers are consumable without retaining callback data", () => {
  const storage = new MemoryStorage();
  recordInvalidAuthCallback(storage);
  assert.equal(consumeInvalidAuthCallback(storage), true);
  assert.equal(consumeInvalidAuthCallback(storage), false);
});