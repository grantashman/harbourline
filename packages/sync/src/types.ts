export type HouseholdRole = "owner" | "member";
export type SyncDecision = "upload" | "download" | "conflict" | "current";

export interface HouseholdSummary {
  id: string;
  name: string;
  role: HouseholdRole;
  revision: number;
  updatedAt: string;
}

export interface LocalSyncMetadata {
  householdId: string;
  revision: number;
  lastSyncedHash: string;
  lastSyncedAt: string;
}

export interface PendingMutation {
  id: string;
  householdId: string;
  baseRevision: number;
  schemaVersion: number;
  state: unknown;
  stateHash: string;
  createdAt: string;
  attempts: number;
}

export interface RemoteBudgetDocument {
  householdId: string;
  revision: number;
  schemaVersion: number;
  state: unknown;
  updatedAt: string;
}

export interface SyncResult {
  conflict: boolean;
  idempotent: boolean;
  document: RemoteBudgetDocument;
}

export interface SyncComparison {
  decision: SyncDecision;
  localHash: string;
  remoteHash: string;
}
