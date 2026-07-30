import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalJson,
  compactMutations,
  compareSyncState,
  createPendingMutation,
  stableStateHash
} from "../dist/index.js";

describe("canonical state hashing", () => {
  it("is stable across object key order", () => {
    const left = { expenses: [{ amount: 20, name: "Phone" }], income: 100 };
    const right = { income: 100, expenses: [{ name: "Phone", amount: 20 }] };
    assert.equal(canonicalJson(left), canonicalJson(right));
    assert.equal(stableStateHash(left), stableStateHash(right));
  });
});

describe("sync decisions", () => {
  const remote = {
    householdId: "household-1",
    revision: 4,
    schemaVersion: 3,
    state: { income: 1200 },
    updatedAt: "2026-07-30T00:00:00.000Z"
  };

  it("downloads when only the household document changed", () => {
    const result = compareSyncState(
      { income: 1000 },
      {
        householdId: "household-1",
        revision: 3,
        lastSyncedHash: stableStateHash({ income: 1000 }),
        lastSyncedAt: "2026-07-29T00:00:00.000Z"
      },
      remote
    );
    assert.equal(result.decision, "download");
  });

  it("uploads when only the device copy changed", () => {
    const result = compareSyncState(
      { income: 1300 },
      {
        householdId: "household-1",
        revision: 4,
        lastSyncedHash: stableStateHash(remote.state),
        lastSyncedAt: remote.updatedAt
      },
      remote
    );
    assert.equal(result.decision, "upload");
  });

  it("requires a deliberate choice when both copies changed", () => {
    const result = compareSyncState(
      { income: 1300 },
      {
        householdId: "household-1",
        revision: 3,
        lastSyncedHash: stableStateHash({ income: 1000 }),
        lastSyncedAt: "2026-07-29T00:00:00.000Z"
      },
      remote
    );
    assert.equal(result.decision, "conflict");
  });

  it("does not invent a conflict for identical state", () => {
    assert.equal(compareSyncState(remote.state, null, remote).decision, "current");
  });
});

describe("offline mutations", () => {
  it("creates deterministic queue metadata", () => {
    const mutation = createPendingMutation({
      householdId: "household-1",
      baseRevision: 2,
      schemaVersion: 3,
      state: { expenses: [] },
      id: "mutation-1",
      createdAt: "2026-07-30T00:00:00.000Z"
    });
    assert.equal(mutation.stateHash, stableStateHash({ expenses: [] }));
    assert.equal(mutation.attempts, 0);
  });

  it("keeps only the newest pending state for each household", () => {
    const older = createPendingMutation({
      householdId: "household-1",
      baseRevision: 1,
      schemaVersion: 3,
      state: { value: 1 },
      id: "older",
      createdAt: "2026-07-30T00:00:00.000Z"
    });
    const newer = createPendingMutation({
      householdId: "household-1",
      baseRevision: 1,
      schemaVersion: 3,
      state: { value: 2 },
      id: "newer",
      createdAt: "2026-07-30T00:01:00.000Z"
    });
    assert.deepEqual(compactMutations([newer, older]).map((item) => item.id), ["newer"]);
  });
});
