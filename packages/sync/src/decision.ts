import { stableStateHash } from "./canonical.js";
import type {
  LocalSyncMetadata,
  RemoteBudgetDocument,
  SyncComparison
} from "./types.js";

export function compareSyncState(
  localState: unknown,
  metadata: LocalSyncMetadata | null,
  remote: RemoteBudgetDocument
): SyncComparison {
  const localHash = stableStateHash(localState);
  const remoteHash = stableStateHash(remote.state);

  if (localHash === remoteHash) {
    return { decision: "current", localHash, remoteHash };
  }

  if (!metadata || metadata.householdId !== remote.householdId) {
    return { decision: remote.revision === 0 ? "upload" : "conflict", localHash, remoteHash };
  }

  const localChanged = localHash !== metadata.lastSyncedHash;
  const remoteChanged = remote.revision > metadata.revision
    && remoteHash !== metadata.lastSyncedHash;

  if (localChanged && remoteChanged) {
    return { decision: "conflict", localHash, remoteHash };
  }
  if (remoteChanged) {
    return { decision: "download", localHash, remoteHash };
  }
  if (localChanged) {
    return { decision: "upload", localHash, remoteHash };
  }
  return { decision: "current", localHash, remoteHash };
}
