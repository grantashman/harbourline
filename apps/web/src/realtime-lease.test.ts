import assert from "node:assert/strict";
import test from "node:test";
import { addRealtimeLease, releaseRealtimeLease } from "./realtime-lease.ts";

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
