import type { Session, User } from "@supabase/supabase-js";
import type {
  HouseholdSummary,
  LocalSyncMetadata,
  RemoteBudgetDocument
} from "@harbourline/sync";

export interface HarbourlineLocalBridge {
  version: 2;
  schemaVersion: number;
  storageKey: string;
  read(): unknown;
  readPersisted?(): unknown;
  setUserScope(userId: string | null): void;
  replace(state: unknown, source?: string): void;
  openWorkspace(tab: "payday"): void;
}

export interface Release2Status {
  message: string;
  tone: "neutral" | "good" | "warning" | "danger";
  queued: number;
  online: boolean;
}

export interface AccountState {
  configured: boolean;
  session: Session | null;
  user: User | null;
  households: HouseholdSummary[];
  metadata: LocalSyncMetadata | null;
  conflict: RemoteBudgetDocument | null;
  status: Release2Status;
}

declare global {
  interface Window {
    HarbourlineLocal?: HarbourlineLocalBridge;
  }

  interface WindowEventMap {
    "harbourline:ready": CustomEvent<void>;
    "harbourline:workspace-viewed": CustomEvent<{ tab: string | undefined }>;
    "harbourline:state-changed": CustomEvent<{
      source: string;
      state: unknown;
    }>;
  }
}

