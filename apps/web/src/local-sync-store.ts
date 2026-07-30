import type { LocalSyncMetadata, PendingMutation } from "@harbourline/sync";

const DATABASE_NAME = "harbourline-release-2";
const DATABASE_VERSION = 1;
const METADATA_STORE = "metadata";
const MUTATION_STORE = "mutations";
const ACTIVE_METADATA_KEY = "active";

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
  return withStore<LocalSyncMetadata | undefined>(
    METADATA_STORE,
    "readonly",
    (store) => store.get(ACTIVE_METADATA_KEY)
  ).then((value) => value ?? null);
}

export function setSyncMetadata(metadata: LocalSyncMetadata): Promise<IDBValidKey> {
  return withStore(
    METADATA_STORE,
    "readwrite",
    (store) => store.put(metadata, ACTIVE_METADATA_KEY)
  );
}

export function clearSyncMetadata(): Promise<undefined> {
  return withStore(
    METADATA_STORE,
    "readwrite",
    (store) => store.delete(ACTIVE_METADATA_KEY)
  );
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

export async function clearPendingMutations(): Promise<undefined> {
  return withStore(
    MUTATION_STORE,
    "readwrite",
    (store) => store.clear()
  );
}

