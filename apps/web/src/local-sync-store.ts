import type { LocalSyncMetadata, PendingMutation } from "@harbourline/sync";

const DATABASE_NAME = "harbourline-release-2";
const DATABASE_VERSION = 1;
const METADATA_STORE = "metadata";
const MUTATION_STORE = "mutations";
const ACTIVE_METADATA_KEY = "active";

function isOwnedMetadata(value: unknown): value is LocalSyncMetadata {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as LocalSyncMetadata).ownerId === "string" &&
    (value as LocalSyncMetadata).ownerId.length > 0
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

export function getSyncMetadata(): Promise<LocalSyncMetadata | null> {
  return withStore<unknown>(
    METADATA_STORE,
    "readonly",
    (store) => store.get(ACTIVE_METADATA_KEY)
  ).then((value) => isOwnedMetadata(value) ? value : null);
}

export function setSyncMetadata(metadata: LocalSyncMetadata): Promise<IDBValidKey> {
  return withStore(
    METADATA_STORE,
    "readwrite",
    (store) => store.put(metadata, ACTIVE_METADATA_KEY)
  );
}

export function clearSyncMetadata(ownerId: string): Promise<undefined> {
  return deleteMetadataIfOwner(ownerId);
}

export function listPendingMutations(): Promise<PendingMutation[]> {
  return withStore<PendingMutation[]>(
    MUTATION_STORE,
    "readonly",
    (store) => store.getAll()
  );
}

export function putPendingMutation(mutation: PendingMutation): Promise<IDBValidKey> {
  return withStore(
    MUTATION_STORE,
    "readwrite",
    (store) => store.put(mutation)
  );
}

export function deletePendingMutation(id: string): Promise<undefined> {
  return withStore(
    MUTATION_STORE,
    "readwrite",
    (store) => store.delete(id)
  );
}

export function clearPendingMutations(ownerId: string, householdId?: string): Promise<undefined> {
  return deleteMatchingMutations(ownerId, householdId);
}

export async function discardUnownedSyncData(): Promise<void> {
  const rawMetadata = await withStore<unknown>(
    METADATA_STORE,
    "readonly",
    (store) => store.get(ACTIVE_METADATA_KEY)
  );
  if (!isOwnedMetadata(rawMetadata)) {
    await withStore(
      METADATA_STORE,
      "readwrite",
      (store) => store.delete(ACTIVE_METADATA_KEY)
    );
  }
  const mutations = await listPendingMutations();
  await Promise.all(
    mutations
      .filter((mutation) => typeof mutation.ownerId !== "string" || mutation.ownerId.length === 0)
      .map((mutation) => deletePendingMutation(mutation.id))
  );
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

async function deleteMatchingMutations(ownerId?: string, householdId?: string): Promise<undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(MUTATION_STORE, "readwrite");
    const store = transaction.objectStore(MUTATION_STORE);
    const request = store.getAll();
    request.onerror = () => reject(request.error ?? new Error("Local sync storage failed."));
    request.onsuccess = () => {
      for (const mutation of request.result as PendingMutation[]) {
        if (mutation.ownerId !== ownerId) continue;
        if (householdId && mutation.householdId !== householdId) continue;
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

