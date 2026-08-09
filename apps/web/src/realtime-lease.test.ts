import assert from "node:assert/strict";
import test from "node:test";
import { addRealtimeLease, isRealtimeFailureStatus, releaseRealtimeLease } from "./realtime-lease.ts";

test("stale realtime lease cleanup cannot remove a newer same-household lease", () => {
  const leases = new Set<string>();
  addRealtimeLease(leases, "a");
  addRealtimeLease(leases, "b");

  assert.equal(releaseRealtimeLease(leases, "a"), false);
  assert.deepEqual([...leases], ["b"]);
  assert.equal(releaseRealtimeLease(leases, "b"), true);
  assert.equal(leases.size, 0);
});

test("unknown realtime lease cleanup is a no-op", () => {
  const leases = new Set(["current"]);
  assert.equal(releaseRealtimeLease(leases, "stale"), false);
  assert.deepEqual([...leases], ["current"]);
});

test("realtime failure statuses invalidate the channel for recovery", () => {
  assert.equal(isRealtimeFailureStatus("CHANNEL_ERROR"), true);
  assert.equal(isRealtimeFailureStatus("TIMED_OUT"), true);
  assert.equal(isRealtimeFailureStatus("CLOSED"), true);
  assert.equal(isRealtimeFailureStatus("SUBSCRIBED"), false);
});
