import { stableStateHash } from "./canonical.js";
import type { PendingMutation } from "./types.js";

export function createPendingMutation(input: {
  householdId: string;
  baseRevision: number;
  schemaVersion: number;
  state: unknown;
  id?: string;
  createdAt?: string;
}): PendingMutation {
  return {
    id: input.id ?? crypto.randomUUID(),
    householdId: input.householdId,
    baseRevision: Math.max(Math.trunc(input.baseRevision), 0),
    schemaVersion: Math.max(Math.trunc(input.schemaVersion), 1),
    state: input.state,
    stateHash: stableStateHash(input.state),
    createdAt: input.createdAt ?? new Date().toISOString(),
    attempts: 0
  };
}

export function compactMutations(mutations: PendingMutation[]): PendingMutation[] {
  const latestByHousehold = new Map<string, PendingMutation>();
  for (const mutation of mutations) {
    const existing = latestByHousehold.get(mutation.householdId);
    if (!existing || mutation.createdAt >= existing.createdAt) {
      latestByHousehold.set(mutation.householdId, mutation);
    }
  }
  return [...latestByHousehold.values()].sort((a, b) => (
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  ));
}
