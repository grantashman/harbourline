import {
  createBudgetBackup,
  createDefaultBudgetState,
  normaliseBudgetState,
  parseBudgetBackup
} from "@harbourline/domain";
import type { BudgetState } from "@harbourline/domain";

const DATABASE_NAME = "harbourline-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "budgets";
const ACTIVE_BUDGET_KEY = "active";
const FALLBACK_KEY = "harbourline-foundation-v1";
const LEGACY_KEYS = [
  "harbourline-aud-v1",
  "pocket-harbour-aud-v1",
  "budget-studio-aud-v1"
];

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage"));
  });
}

async function readIndexedBudget(): Promise<BudgetState | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_BUDGET_KEY);
      request.onsuccess = () => resolve(request.result ? normaliseBudgetState(request.result) : null);
      request.onerror = () => reject(request.error ?? new Error("Could not read local budget"));
    });
  } finally {
    database.close();
  }
}

async function writeIndexedBudget(state: BudgetState): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(state, ACTIVE_BUDGET_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save local budget"));
    });
  } finally {
    database.close();
  }
}

export async function loadBudget(): Promise<BudgetState> {
  try {
    return await readIndexedBudget() ?? createDefaultBudgetState();
  } catch {
    const saved = localStorage.getItem(FALLBACK_KEY);
    return saved ? normaliseBudgetState(JSON.parse(saved)) : createDefaultBudgetState();
  }
}

export async function saveBudget(state: BudgetState): Promise<void> {
  const normalised = normaliseBudgetState(state);
  try {
    await writeIndexedBudget(normalised);
  } catch {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(normalised));
  }
}

export function readLegacyBudget(): BudgetState | null {
  for (const key of LEGACY_KEYS) {
    const value = localStorage.getItem(key);
    if (!value) continue;
    try {
      return normaliseBudgetState(JSON.parse(value));
    } catch {
      continue;
    }
  }
  return null;
}

export async function importBudgetFile(file: File): Promise<BudgetState> {
  return parseBudgetBackup(JSON.parse(await file.text()));
}

export function downloadBudget(state: BudgetState): void {
  const backup = createBudgetBackup(state);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `harbourline-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

