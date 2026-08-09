import type { LocalSyncMetadata, PendingMutation } from "@harbourline/sync";

const DATABASE_NAME = "harbourline-release-2";
const DATABASE_VERSION = 2;
const METADATA_STORE = "metadata";
const MUTATION_STORE = "mutations";
const CLEANUP_STORE = "cleanup";
const ACTIVE_METADATA_KEY = "active";
const ACTIVE_CLEANUP_LATCH_KEY = "active";

export interface CleanupLatch {
  ownerId: string;
  householdId?: string;
  failedAt: string;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function isOwnedMetadata(value: unknown): value is LocalSyncMetadata {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as LocalSyncMetadata).ownerId === "string" &&
    (value as LocalSyncMetadata).ownerId.trim().length > 0 &&
    typeof (value as LocalSyncMetadata).householdId === "string" &&
    (value as LocalSyncMetadata).householdId.trim().length > 0
  );
}

function isOwnedMutation(value: unknown): value is PendingMutation {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as PendingMutation).id === "string" &&
    (value as PendingMutation).id.trim().length > 0 &&
    typeof (value as PendingMutation).ownerId === "string" &&
    (value as PendingMutation).ownerId.trim().length > 0 &&
    typeof (value as PendingMutation).householdId === "string" &&
    (value as PendingMutation).householdId.trim().length > 0
  );
}

function isCleanupLatch(value: unknown): value is CleanupLatch {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as CleanupLatch).ownerId === "string" &&
    (value as CleanupLatch).ownerId.trim().length > 0 &&
    typeof (value as CleanupLatch).failedAt === "string" &&
    (value as CleanupLatch).failedAt.length > 0
  );
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
  ).then((value) => isCleanupLatch(value) ? value : null);
}

export function setCleanupLatch(ownerId: string, householdId?: string): Promise<IDBValidKey> {
  const latch: CleanupLatch = {
    ownerId: requireId(ownerId, "ownerId"),
    ...(householdId === undefined ? {} : { householdId: requireId(householdId, "householdId") }),
    failedAt: new Date().toISOString()
  };
  return withStore(
    CLEANUP_STORE,
    "readwrite",
    (store) => store.put(latch, ACTIVE_CLEANUP_LATCH_KEY)
  );
}

export function clearCleanupLatch(ownerId: string): Promise<undefined> {
  ownerId = requireId(ownerId, "ownerId");
  const databasePromise = openDatabase();
  return databasePromise.then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(CLEANUP_STORE, "readwrite");
    const store = transaction.objectStore(CLEANUP_STORE);
    const request = store.get(ACTIVE_CLEANUP_LATCH_KEY);
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
    request.onsuccess = () => {
      const latch = request.result as CleanupLatch | undefined;
      if (latch?.ownerId === ownerId) store.delete(ACTIVE_CLEANUP_LATCH_KEY);
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
  await deleteUnownedMetadata();
  await deleteUnownedMutations();
}

async function deleteUnownedMetadata(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(METADATA_STORE, "readwrite");
    const store = transaction.objectStore(METADATA_STORE);
    const request = store.get(ACTIVE_METADATA_KEY);
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
    request.onsuccess = () => {
      if (!isOwnedMetadata(request.result)) store.delete(ACTIVE_METADATA_KEY);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local sync storage failed."));
  }).finally(() => database.close());
}

async function deleteUnownedMutations(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(MUTATION_STORE, "readwrite");
    const store = transaction.objectStore(MUTATION_STORE);
    const request = store.getAll();
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
    request.onsuccess = () => {
      for (const value of request.result as unknown[]) {
        if (isOwnedMutation(value)) continue;
        if (
          value &&
          typeof value === "object" &&
          typeof (value as { id?: unknown }).id === "string" &&
          (value as { id: string }).id.trim().length > 0
        ) {
          store.delete((value as { id: string }).id);
        }
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local sync storage failed."));
  }).finally(() => database.close());
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

