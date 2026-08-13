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

export interface HarbourlineMobileBridge {
  isNative: boolean;
  authRedirectOrigin: string;
  shareExport(blob: Blob, filename: string): Promise<boolean>;
  getReminderPermission?(): Promise<"granted" | "denied" | "prompt" | "unsupported">;
  requestReminderNotifications?(): Promise<"granted" | "denied" | "prompt" | "unsupported">;
  scheduleGenericReminder?(): Promise<boolean>;
  cancelGenericReminder?(): Promise<boolean>;
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
    HarbourlineMobile?: HarbourlineMobileBridge;
  }

  interface WindowEventMap {
    "harbourline:ready": CustomEvent<void>;
    "harbourline:app-lifecycle": CustomEvent<{ active: boolean }>;
    "harbourline:workspace-viewed": CustomEvent<{ tab: string | undefined }>;
    "harbourline:state-changed": CustomEvent<{
      source: string;
      state: unknown;
    }>;
  }
}

