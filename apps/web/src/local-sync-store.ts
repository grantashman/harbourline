import { stableStateHash } from "@harbourline/sync";
import type { LocalSyncMetadata, PendingMutation } from "@harbourline/sync";

const DATABASE_NAME = "harbourline-release-2";
const DATABASE_VERSION = 2;
const METADATA_STORE = "metadata";
const MUTATION_STORE = "mutations";
const CLEANUP_STORE = "cleanup";
const ACTIVE_METADATA_KEY = "active";
const ACTIVE_CLEANUP_LATCH_KEY = "active";
const CLEANUP_LATCH_FALLBACK_KEY = `${DATABASE_NAME}:cleanup-latch`;
export const CLEANUP_LATCH_CHANNEL_NAME = `${DATABASE_NAME}:cleanup-latch-channel`;
let cleanupLatchChannel: BroadcastChannel | null = null;

export interface CleanupLatch {
  ownerId: string;
  householdId?: string;
  failedAt: string;
  latchId?: string;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRevision(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function isStateHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256-[0-9a-f]{64}$/.test(value);
}

function isOwnedMetadata(value: unknown): value is LocalSyncMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as LocalSyncMetadata;
  return (
    typeof metadata.ownerId === "string" && metadata.ownerId.trim().length > 0 &&
    typeof metadata.householdId === "string" && metadata.householdId.trim().length > 0 &&
    isRevision(metadata.revision) &&
    isStateHash(metadata.lastSyncedHash) &&
    isTimestamp(metadata.lastSyncedAt)
  );
}

function isOwnedMutation(value: unknown): value is PendingMutation {
  if (!value || typeof value !== "object") return false;
  const mutation = value as PendingMutation;
  return (
    typeof mutation.id === "string" && mutation.id.trim().length > 0 &&
    typeof mutation.ownerId === "string" && mutation.ownerId.trim().length > 0 &&
    typeof mutation.householdId === "string" && mutation.householdId.trim().length > 0 &&
    isRevision(mutation.baseRevision) &&
    isRevision(mutation.schemaVersion, 1) &&
    isStateHash(mutation.stateHash) &&
    isTimestamp(mutation.createdAt) &&
    isRevision(mutation.attempts) &&
    mutation.state !== undefined &&
    stableStateHash(mutation.state) === mutation.stateHash
  );
}

function isCleanupLatch(value: unknown): value is CleanupLatch {
  if (!value || typeof value !== "object") return false;
  const latch = value as CleanupLatch;
  return (
    typeof latch.ownerId === "string" && latch.ownerId.trim().length > 0 &&
    (latch.householdId === undefined || (typeof latch.householdId === "string" && latch.householdId.trim().length > 0)) &&
    isTimestamp(latch.failedAt) &&
    (latch.latchId === undefined || (typeof latch.latchId === "string" && latch.latchId.trim().length > 0))
  );
}

function sameCleanupLatch(left: CleanupLatch, right: CleanupLatch): boolean {
  return (
    left.ownerId === right.ownerId &&
    left.householdId === right.householdId &&
    left.failedAt === right.failedAt &&
    left.latchId === right.latchId
  );
}

function cleanupLatchIsNewer(candidate: CleanupLatch, current: CleanupLatch): boolean {
  const candidateTime = Date.parse(candidate.failedAt);
  const currentTime = Date.parse(current.failedAt);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return (candidate.latchId ?? "") > (current.latchId ?? "");
}

function createCleanupLatchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function broadcastCleanupLatch(latch: CleanupLatch | null): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    cleanupLatchChannel ??= new BroadcastChannel(CLEANUP_LATCH_CHANNEL_NAME);
    cleanupLatchChannel.postMessage({ type: "cleanup-latch", latch });
  } catch {
    // Broadcast is advisory; the durable latch remains authoritative.
  }
}

type CleanupFallbackLockManager = {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => T | Promise<T>): Promise<T>;
};

export async function withCleanupLatchLock<T>(operation: () => T | Promise<T>): Promise<T | null> {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: CleanupFallbackLockManager }).locks;
  if (!locks) return null;
  return locks.request(CLEANUP_LATCH_FALLBACK_KEY, { mode: "exclusive" }, operation);
}

async function withCleanupFallbackLock<T>(operation: () => T | Promise<T>): Promise<T | null> {
  if (typeof localStorage === "undefined") return operation();
  return withCleanupLatchLock(operation);
}

function readCleanupLatchFallback(): CleanupLatch | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CLEANUP_LATCH_FALLBACK_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isCleanupLatch(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeCleanupLatchFallback(latch: CleanupLatch): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const operation = () => {
    const current = readCleanupLatchFallback();
    if (!current || cleanupLatchIsNewer(latch, current)) {
      localStorage.setItem(CLEANUP_LATCH_FALLBACK_KEY, JSON.stringify(latch));
    }
  };
  try {
    const locked = await withCleanupFallbackLock(operation);
    if (locked === null) operation();
  } catch {
    // IndexedDB remains the primary store; the caller still fails closed if it fails.
  }
}

async function clearCleanupLatchFallback(expected: CleanupLatch, lockHeld = false): Promise<boolean> {
  if (typeof localStorage === "undefined") return true;
  const operation = () => {
    const raw = localStorage.getItem(CLEANUP_LATCH_FALLBACK_KEY);
    if (!raw) return true;
    const value: unknown = JSON.parse(raw);
    if (!isCleanupLatch(value)) return false;
    if (sameCleanupLatch(value, expected) || !cleanupLatchIsNewer(value, expected)) {
      localStorage.removeItem(CLEANUP_LATCH_FALLBACK_KEY);
      return true;
    }
    return false;
  };
  try {
    if (lockHeld) return operation();
    const locked = await withCleanupFallbackLock(operation);
    if (locked === null) {
      return readCleanupLatchFallback() === null;
    }
    return locked;
  } catch {
    // A stale fallback keeps the next session fail-closed, which is safer than clearing it.
    return false;
  }
}

function putCleanupLatch(latch: CleanupLatch): Promise<IDBValidKey> {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(CLEANUP_STORE, "readwrite");
    const store = transaction.objectStore(CLEANUP_STORE);
    const request = store.get(ACTIVE_CLEANUP_LATCH_KEY);
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
    request.onsuccess = () => {
      const current = request.result as CleanupLatch | undefined;
      if (!current || cleanupLatchIsNewer(latch, current)) {
        const putRequest = store.put(latch, ACTIVE_CLEANUP_LATCH_KEY);
        putRequest.onerror = () => reject(putRequest.error ?? new Error("Local sync storage failed."));
      }
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(ACTIVE_CLEANUP_LATCH_KEY);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Local sync storage failed."));
    };
  }));
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE);
      }
      if (!database.objectStoreNames.contains(MUTATION_STORE)) {
        const mutations = database.createObjectStore(MUTATION_STORE, { keyPath: "id" });
        mutations.createIndex("householdId", "householdId");
      }
      if (!database.objectStoreNames.contains(CLEANUP_STORE)) {
        database.createObjectStore(CLEANUP_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local sync storage."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();
  try {
    return await requestResult(operation(database.transaction(storeName, mode).objectStore(storeName)));
  } finally {
    database.close();
  }
}

export function getCleanupLatch(): Promise<CleanupLatch | null> {
  return withStore<unknown>(
    CLEANUP_STORE,
    "readonly",
    (store) => store.get(ACTIVE_CLEANUP_LATCH_KEY)
  ).then((value) => isCleanupLatch(value) ? value : readCleanupLatchFallback())
    .catch((error) => {
      const fallback = readCleanupLatchFallback();
      if (fallback) return fallback;
      throw error;
    });
}

export function setCleanupLatch(ownerId: string, householdId?: string): Promise<IDBValidKey> {
  const latch: CleanupLatch = {
    ownerId: requireId(ownerId, "ownerId"),
    ...(householdId === undefined ? {} : { householdId: requireId(householdId, "householdId") }),
    failedAt: new Date().toISOString(),
    latchId: createCleanupLatchId()
  };
  const persist = () => putCleanupLatch(latch);
  return withCleanupLatchLock(persist).then((lockedKey) => (lockedKey ?? persist())).then((key) => {
    broadcastCleanupLatch(latch);
    return key;
  }).catch(async (error) => {
    await writeCleanupLatchFallback(latch);
    broadcastCleanupLatch(latch);
    throw error;
  });
}

async function clearCleanupLatchInternal(expected: CleanupLatch, lockHeld: boolean): Promise<boolean> {
  requireId(expected.ownerId, "ownerId");
  const fallback = readCleanupLatchFallback();
  if (fallback && cleanupLatchIsNewer(fallback, expected)) return false;
  const databasePromise = openDatabase();
  return databasePromise.then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(CLEANUP_STORE, "readwrite");
    const store = transaction.objectStore(CLEANUP_STORE);
    const request = store.get(ACTIVE_CLEANUP_LATCH_KEY);
    let cleared = false;
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
    request.onsuccess = () => {
      const latch = request.result as CleanupLatch | undefined;
      if (latch === undefined) {
        cleared = true;
      } else if (sameCleanupLatch(latch, expected)) {
        store.delete(ACTIVE_CLEANUP_LATCH_KEY);
        cleared = true;
      }
    };
    transaction.oncomplete = async () => {
      database.close();
      if (!cleared) {
        resolve(false);
        return;
      }
      if (!await clearCleanupLatchFallback(expected, lockHeld)) {
        resolve(false);
        return;
      }
      try {
        const remainingLatch = await getCleanupLatch();
        const didClear = remainingLatch === null;
        if (didClear) broadcastCleanupLatch(null);
        resolve(didClear);
      } catch {
        resolve(false);
      }
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Local sync storage failed."));
    };
  }));
}

export function clearCleanupLatch(expected: CleanupLatch): Promise<boolean> {
  return withCleanupLatchLock(() => clearCleanupLatchInternal(expected, true))
    .then((lockedResult) => lockedResult ?? clearCleanupLatchInternal(expected, false));
}

export function getSyncMetadata(): Promise<LocalSyncMetadata | null> {
  return withStore<unknown>(
    METADATA_STORE,
    "readonly",
    (store) => store.get(ACTIVE_METADATA_KEY)
  ).then((value) => isOwnedMetadata(value) ? value : null);
}

export function setSyncMetadata(metadata: LocalSyncMetadata): Promise<IDBValidKey> {
  requireId(metadata.ownerId, "metadata.ownerId");
  requireId(metadata.householdId, "metadata.householdId");
  return withStore(
    METADATA_STORE,
    "readwrite",
    (store) => store.put(metadata, ACTIVE_METADATA_KEY)
  );
}

export function clearSyncMetadata(ownerId: string): Promise<undefined> {
  return deleteMetadataIfOwner(requireId(ownerId, "ownerId"));
}

export function clearSyncMetadataIfMatches(metadata: LocalSyncMetadata): Promise<undefined> {
  requireId(metadata.ownerId, "metadata.ownerId");
  requireId(metadata.householdId, "metadata.householdId");
  return deleteMetadataIfMatches(metadata);
}

export function listPendingMutations(): Promise<PendingMutation[]> {
  return withStore<PendingMutation[]>(
    MUTATION_STORE,
    "readonly",
    (store) => store.getAll()
  );
}

export function putPendingMutation(mutation: PendingMutation): Promise<IDBValidKey> {
  requireId(mutation.id, "mutation.id");
  requireId(mutation.ownerId, "mutation.ownerId");
  requireId(mutation.householdId, "mutation.householdId");
  return withStore(
    MUTATION_STORE,
    "readwrite",
    (store) => store.put(mutation)
  );
}

export function deletePendingMutation(ownerId: string, id: string): Promise<undefined> {
  ownerId = requireId(ownerId, "ownerId");
  id = requireId(id, "mutation.id");
  const databasePromise = openDatabase();
  return databasePromise.then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(MUTATION_STORE, "readwrite");
    const store = transaction.objectStore(MUTATION_STORE);
    const request = store.get(id);
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
    request.onsuccess = () => {
      const mutation = request.result as PendingMutation | undefined;
      if (mutation?.ownerId === ownerId) store.delete(id);
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(undefined);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Local sync storage failed."));
    };
  }));
}

export function clearPendingMutations(ownerId: string, householdId: string): Promise<undefined> {
  return deleteMatchingMutations(
    requireId(ownerId, "ownerId"),
    requireId(householdId, "householdId")
  );
}

export function clearAllPendingMutations(ownerId: string): Promise<undefined> {
  return deleteMatchingMutations(requireId(ownerId, "ownerId"));
}

export async function discardUnownedSyncData(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([METADATA_STORE, MUTATION_STORE], "readwrite");
      const metadataStore = transaction.objectStore(METADATA_STORE);
      const mutationStore = transaction.objectStore(MUTATION_STORE);
      const metadataRequest = metadataStore.get(ACTIVE_METADATA_KEY);
      const mutationsRequest = mutationStore.getAll();
      const fail = (error: unknown) => reject(error instanceof Error ? error : new Error("Local sync storage failed."));
      metadataRequest.onerror = () => fail(metadataRequest.error);
      mutationsRequest.onerror = () => fail(mutationsRequest.error);
      metadataRequest.onsuccess = () => {
        if (!isOwnedMetadata(metadataRequest.result)) metadataStore.delete(ACTIVE_METADATA_KEY);
      };
      mutationsRequest.onsuccess = () => {
        for (const value of mutationsRequest.result as unknown[]) {
          if (isOwnedMutation(value)) continue;
          if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
            const id = (value as { id: string }).id.trim();
            if (id) mutationStore.delete(id);
          }
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => fail(transaction.error);
      transaction.onabort = () => fail(transaction.error ?? new Error("Local sync quarantine was aborted."));
    });
  } finally {
    database.close();
  }
}

async function deleteMetadataIfOwner(ownerId: string): Promise<undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(METADATA_STORE, "readwrite");
    const store = transaction.objectStore(METADATA_STORE);
    const request = store.get(ACTIVE_METADATA_KEY);
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
    request.onsuccess = () => {
      const metadata = request.result as LocalSyncMetadata | undefined;
      if (metadata?.ownerId === ownerId) store.delete(ACTIVE_METADATA_KEY);
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(undefined);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Local sync storage failed."));
    };
  });
}

async function deleteMetadataIfMatches(expected: LocalSyncMetadata): Promise<undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(METADATA_STORE, "readwrite");
    const store = transaction.objectStore(METADATA_STORE);
    const request = store.get(ACTIVE_METADATA_KEY);
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
    request.onsuccess = () => {
      const metadata = request.result as LocalSyncMetadata | undefined;
      const matches = metadata &&
        metadata.ownerId === expected.ownerId &&
        metadata.householdId === expected.householdId &&
        metadata.revision === expected.revision &&
        metadata.lastSyncedHash === expected.lastSyncedHash &&
        metadata.lastSyncedAt === expected.lastSyncedAt;
      if (matches) store.delete(ACTIVE_METADATA_KEY);
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(undefined);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Local sync storage failed."));
    };
  });
}

async function deleteMatchingMutations(ownerId: string, householdId?: string): Promise<undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MUTATION_STORE, "readwrite");
    const store = transaction.objectStore(MUTATION_STORE);
    const request = store.getAll();
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
    request.onsuccess = () => {
      for (const mutation of request.result as PendingMutation[]) {
        if (mutation.ownerId !== ownerId) continue;
        if (householdId !== undefined && mutation.householdId !== householdId) continue;
        store.delete(mutation.id);
      }
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(undefined);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Local sync storage failed."));
    };
  });
}

