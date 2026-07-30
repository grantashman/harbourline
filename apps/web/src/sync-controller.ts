import {
  compactMutations,
  compareSyncState,
  createPendingMutation,
  stableStateHash,
  type LocalSyncMetadata,
  type RemoteBudgetDocument
} from "@harbourline/sync";
import { HarbourlineCloud } from "./cloud";
import {
  clearPendingMutations,
  clearSyncMetadata,
  deletePendingMutation,
  getSyncMetadata,
  listPendingMutations,
  putPendingMutation,
  setSyncMetadata
} from "./local-sync-store";
import type {
  HarbourlineLocalBridge,
  Release2Status
} from "./release2-types";

export class SyncController {
  metadata: LocalSyncMetadata | null = null;
  conflict: RemoteBudgetDocument | null = null;
  private flushTimer = 0;
  private flushing = false;
  private onStatus: (status: Release2Status) => void;
  private onConflict: (remote: RemoteBudgetDocument | null) => void;

  constructor(
    private readonly bridge: HarbourlineLocalBridge,
    private readonly cloud: HarbourlineCloud,
    callbacks: {
      status: (status: Release2Status) => void;
      conflict: (remote: RemoteBudgetDocument | null) => void;
    }
  ) {
    this.onStatus = callbacks.status;
    this.onConflict = callbacks.conflict;
  }

  async initialise(): Promise<void> {
    this.metadata = await getSyncMetadata();
    window.addEventListener("harbourline:state-changed", (event) => {
      if (event.detail.source === "cloud" || !this.metadata) return;
      void this.queueState(event.detail.state);
    });
    window.addEventListener("online", () => void this.flush());
    window.addEventListener("offline", () => void this.report("Changes are queued until you are online.", "warning"));
    await this.report(this.metadata ? "Ready to sync." : "Saved on this device.", "neutral");
  }

  async linkDevice(householdId: string, choice: "device" | "household"): Promise<void> {
    const remote = await this.cloud.fetchBudget(householdId);
    if (choice === "household" && remote.revision > 0) {
      this.applyRemote(remote);
      await this.recordRemote(remote);
      await clearPendingMutations();
      await this.cloud.subscribeToBudget(householdId, () => void this.receiveRemoteChange());
      await this.report("Household budget downloaded to this device.", "good");
      return;
    }

    this.metadata = {
      householdId,
      revision: remote.revision,
      lastSyncedHash: stableStateHash(remote.state),
      lastSyncedAt: new Date().toISOString()
    };
    await setSyncMetadata(this.metadata);
    await clearPendingMutations();
    await this.queueState(this.bridge.read(), true);
    await this.cloud.subscribeToBudget(householdId, () => void this.receiveRemoteChange());
  }

  async resumeForHousehold(householdId: string): Promise<void> {
    if (this.metadata?.householdId !== householdId) return;
    await this.cloud.subscribeToBudget(householdId, () => void this.receiveRemoteChange());
    await this.flush();
  }

  async disconnectDevice(): Promise<void> {
    window.clearTimeout(this.flushTimer);
    await this.cloud.unsubscribeFromBudget();
    await clearPendingMutations();
    await clearSyncMetadata();
    this.metadata = null;
    this.setConflict(null);
    await this.report("Cloud sync disconnected. The device copy remains available.", "neutral");
  }

  async keepDeviceVersion(): Promise<void> {
    if (!this.conflict || !this.metadata) return;
    this.metadata = {
      ...this.metadata,
      revision: this.conflict.revision,
      lastSyncedHash: stableStateHash(this.conflict.state),
      lastSyncedAt: new Date().toISOString()
    };
    await setSyncMetadata(this.metadata);
    await clearPendingMutations();
    this.setConflict(null);
    await this.queueState(this.bridge.read(), true);
  }

  async useHouseholdVersion(): Promise<void> {
    if (!this.conflict) return;
    const remote = this.conflict;
    this.applyRemote(remote);
    await this.recordRemote(remote);
    await clearPendingMutations();
    this.setConflict(null);
    await this.report("Household version restored on this device.", "good");
  }

  private async queueState(state: unknown, immediate = false): Promise<void> {
    if (!this.metadata) return;
    const mutation = createPendingMutation({
      householdId: this.metadata.householdId,
      baseRevision: this.metadata.revision,
      schemaVersion: this.bridge.schemaVersion,
      state
    });
    await putPendingMutation(mutation);
    await this.report(navigator.onLine ? "Saving to household..." : "Change queued for sync.", "warning");
    window.clearTimeout(this.flushTimer);
    if (immediate) {
      await this.flush();
    } else {
      this.flushTimer = window.setTimeout(() => void this.flush(), 450);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.metadata || !navigator.onLine || this.conflict) return;
    this.flushing = true;
    try {
      const allPending = await listPendingMutations();
      const queued = compactMutations(allPending)
        .filter((mutation) => mutation.householdId === this.metadata?.householdId);
      for (const pending of queued) {
        if (!this.metadata) break;
        const mutation = {
          ...pending,
          baseRevision: this.metadata.revision,
          attempts: pending.attempts + 1
        };
        const result = await this.cloud.syncBudget(mutation);
        if (result.conflict) {
          this.setConflict(result.document);
          await this.report("A newer household version needs your choice.", "danger");
          return;
        }
        const superseded = allPending.filter((mutation) => (
          mutation.householdId === pending.householdId
          && mutation.createdAt <= pending.createdAt
        ));
        await Promise.all(superseded.map((mutation) => deletePendingMutation(mutation.id)));
        await this.recordRemote(result.document);
      }
      await this.report("Saved to household.", "good");
    } catch {
      await this.report(
        navigator.onLine ? "Sync paused. Your change is safe on this device." : "Change queued for sync.",
        "warning"
      );
    } finally {
      this.flushing = false;
    }
  }

  private async receiveRemoteChange(): Promise<void> {
    if (!this.metadata || this.flushing) return;
    try {
      const remote = await this.cloud.fetchBudget(this.metadata.householdId);
      const comparison = compareSyncState(this.bridge.read(), this.metadata, remote);
      if (comparison.decision === "download") {
        this.applyRemote(remote);
        await this.recordRemote(remote);
        await this.report("Updated from your household.", "good");
      } else if (comparison.decision === "conflict") {
        this.setConflict(remote);
        await this.report("A newer household version needs your choice.", "danger");
      }
    } catch {
      await this.report("Could not check the latest household version.", "warning");
    }
  }

  private applyRemote(remote: RemoteBudgetDocument): void {
    this.bridge.replace(remote.state, "cloud");
  }

  private async recordRemote(remote: RemoteBudgetDocument): Promise<void> {
    this.metadata = {
      householdId: remote.householdId,
      revision: remote.revision,
      lastSyncedHash: stableStateHash(remote.state),
      lastSyncedAt: new Date().toISOString()
    };
    await setSyncMetadata(this.metadata);
  }

  private setConflict(remote: RemoteBudgetDocument | null): void {
    this.conflict = remote;
    this.onConflict(remote);
  }

  private async report(
    message: string,
    tone: Release2Status["tone"]
  ): Promise<void> {
    const queued = (await listPendingMutations()).length;
    this.onStatus({ message, tone, queued, online: navigator.onLine });
  }
}
