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
  clearAllPendingMutations,
  clearPendingMutations,
  clearSyncMetadata,
  clearSyncMetadataIfMatches,
  deletePendingMutation,
  discardUnownedSyncData,
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
  private flushPromise: Promise<void> | null = null;
  private remoteChangePromise: Promise<void> | null = null;
  private readonly inFlightOperations = new Set<Promise<unknown>>();
  private disconnectPromise: Promise<void> | null = null;
  private lifecycleGeneration = 0;
  private cloudAccess = false;
  private ownerId: string | null = null;
  private readonly subscriptionKeys = new Set<string>();
  private listenersBound = false;
  private onStatus: (status: Release2Status) => void;
  private onConflict: (remote: RemoteBudgetDocument | null) => void;
  private onCleanupFailure: (error: unknown, ownerId: string) => Promise<void>;

  constructor(
    private readonly bridge: HarbourlineLocalBridge,
    private readonly cloud: HarbourlineCloud,
    callbacks: {
      status: (status: Release2Status) => void;
      conflict: (remote: RemoteBudgetDocument | null) => void;
      cleanupFailure: (error: unknown, ownerId: string) => Promise<void>;
    }
  ) {
    this.onStatus = callbacks.status;
    this.onConflict = callbacks.conflict;
    this.onCleanupFailure = callbacks.cleanupFailure;
  }

  async initialise(): Promise<void> {
    await discardUnownedSyncData();
    this.metadata = await getSyncMetadata();
    this.ownerId = this.metadata?.ownerId ?? null;
    await this.report(this.metadata ? "Waiting for account access before syncing." : "Local starter ready. Sign in and subscribe to enable cloud sync.", "neutral");
  }

  setCloudAccess(enabled: boolean, _preserveMetadata = false, ownerId?: string): void {
    if (this.cloudAccess === enabled) {
      if (enabled && ownerId && this.ownerId && ownerId !== this.ownerId) {
        throw new Error("Cloud sync owner cannot change without disconnecting the current owner.");
      }
      if (!enabled) {
        this.lifecycleGeneration += 1;
        window.clearTimeout(this.flushTimer);
        this.setConflict(null);
      }
      if (enabled) this.bindListeners();
      return;
    }
    if (enabled && !ownerId && !this.ownerId) return;
    this.lifecycleGeneration += 1;
    this.cloudAccess = enabled;
    if (enabled) this.ownerId = ownerId ?? this.ownerId;
    if (!enabled) {
      window.clearTimeout(this.flushTimer);
      this.setConflict(null);
      return;
    }
    this.bindListeners();
  }

  private bindListeners(): void {
    if (this.listenersBound) return;
    this.listenersBound = true;
    window.addEventListener("harbourline:state-changed", (event) => {
      if (
        event.detail.source === "cloud" ||
        event.detail.source === "account-switch" ||
        !this.cloudAccess ||
        !this.metadata
      ) return;
      void this.queueState(event.detail.state);
    });
    window.addEventListener("online", () => {
      if (this.cloudAccess) void this.flush();
    });
    window.addEventListener("offline", () => {
      if (this.cloudAccess) {
        const generation = this.lifecycleGeneration;
        void this.report("Changes are queued until you are online.", "warning", generation);
      }
    });
  }

  async linkDevice(householdId: string, choice: "device" | "household"): Promise<boolean> {
    return this.trackOperation(() => this.linkDeviceInternal(householdId, choice));
  }

  private async linkDeviceInternal(householdId: string, choice: "device" | "household"): Promise<boolean> {
    if (!this.cloudAccess || !this.ownerId) return false;
    const ownerId = this.ownerId;
    const inFlightFlush = this.flushPromise;
    const inFlightRemoteChange = this.remoteChangePromise;
    const inFlightOperations = [...this.inFlightOperations];
    this.lifecycleGeneration += 1;
    const generation = this.lifecycleGeneration;
    window.clearTimeout(this.flushTimer);
    this.metadata = null;
    this.setConflict(null);
    if (inFlightFlush) await inFlightFlush.catch(() => undefined);
    if (inFlightRemoteChange) await inFlightRemoteChange.catch(() => undefined);
    await Promise.allSettled(inFlightOperations);
    if (!this.isCurrent(generation, ownerId)) return false;
    await clearSyncMetadata(ownerId);
    if (!this.isCurrent(generation, ownerId)) return false;
    const remote = await this.cloud.fetchBudget(householdId);
    if (!this.isCurrent(generation, ownerId)) return false;
    if (choice === "household" && remote.revision > 0) {
      this.applyRemote(remote);
      await this.recordRemote(remote, generation);
      if (!this.isCurrent(generation, ownerId)) return false;
      await clearPendingMutations(ownerId, householdId);
      if (!this.isCurrent(generation, ownerId)) return false;
      const subscriptionKey = await this.cloud.subscribeToBudget(householdId, () => void this.receiveRemoteChange(householdId));
      if (!this.isCurrent(generation, ownerId)) {
        try {
          await this.cloud.unsubscribeFromBudget(subscriptionKey);
        } catch (error) {
          await this.onCleanupFailure(error, ownerId);
        }
        return false;
      }
      this.subscriptionKeys.add(subscriptionKey);
      await this.report("Household budget downloaded to this device.", "good", generation);
      return this.isCurrent(generation, ownerId);
    }

    const metadata: LocalSyncMetadata = {
      ownerId,
      householdId,
      revision: remote.revision,
      lastSyncedHash: stableStateHash(remote.state),
      lastSyncedAt: new Date().toISOString()
    };
    await setSyncMetadata(metadata);
    if (!this.isCurrent(generation, ownerId)) {
      await clearSyncMetadataIfMatches(metadata);
      return false;
    }
    this.metadata = metadata;
    await clearPendingMutations(ownerId, householdId);
    if (!this.isCurrent(generation, ownerId)) return false;
    await this.queueState(this.bridge.read(), true);
    if (!this.isCurrent(generation, ownerId)) return false;
    const subscriptionKey = await this.cloud.subscribeToBudget(householdId, () => void this.receiveRemoteChange(householdId));
    if (!this.isCurrent(generation, ownerId)) {
      try {
        await this.cloud.unsubscribeFromBudget(subscriptionKey);
      } catch (error) {
        await this.onCleanupFailure(error, ownerId);
      }
      return false;
    }
    this.subscriptionKeys.add(subscriptionKey);
    return true;
  }

  async resumeForHousehold(householdId: string): Promise<void> {
    return this.trackOperation(() => this.resumeForHouseholdInternal(householdId));
  }

  private async resumeForHouseholdInternal(householdId: string): Promise<void> {
    if (!this.cloudAccess || this.metadata?.householdId !== householdId) return;
    const generation = this.lifecycleGeneration;
    const ownerId = this.ownerId;
    const currentState = this.bridge.read();
    if (this.metadata && stableStateHash(currentState) !== this.metadata.lastSyncedHash) {
      await this.queueState(currentState, true);
      if (!this.isCurrent(generation) || this.metadata?.householdId !== householdId) return;
    }
    const subscriptionKey = await this.cloud.subscribeToBudget(householdId, () => void this.receiveRemoteChange(householdId));
    if (!this.isCurrent(generation, ownerId) || this.metadata?.householdId !== householdId) {
      if (ownerId) {
        try {
          await this.cloud.unsubscribeFromBudget(subscriptionKey);
        } catch (error) {
          await this.onCleanupFailure(error, ownerId);
        }
      }
      return;
    }
    this.subscriptionKeys.add(subscriptionKey);
    await this.flush();
  }

  async disconnectDevice(ownerOverride?: string): Promise<void> {
    if (this.disconnectPromise) return this.disconnectPromise;
    const operation = this.disconnectDeviceInternal(ownerOverride);
    this.disconnectPromise = operation;
    try {
      await operation;
    } finally {
      if (this.disconnectPromise === operation) this.disconnectPromise = null;
    }
  }

  private async disconnectDeviceInternal(ownerOverride?: string): Promise<void> {
    if (ownerOverride && this.ownerId && ownerOverride !== this.ownerId) {
      throw new Error("Cleanup owner does not match the active sync owner.");
    }
    const ownerId = this.ownerId ?? ownerOverride ?? null;
    const householdId = this.metadata?.householdId;
    const subscriptionKeys = [...this.subscriptionKeys];
    await this.suspendCloudAccess(true, true);
    const disconnectGeneration = this.lifecycleGeneration;
    let firstError: unknown = null;
    for (const subscriptionKey of subscriptionKeys) {
      try {
        await this.cloud.unsubscribeFromBudget(subscriptionKey);
        this.subscriptionKeys.delete(subscriptionKey);
      } catch (error) {
        firstError ??= error;
        if (ownerId) await this.onCleanupFailure(error, ownerId);
      }
    }
    let metadataCleared = false;
    try {
      if (ownerId && (this.ownerId === ownerId || this.ownerId === null)) {
        await clearSyncMetadata(ownerId);
        metadataCleared = true;
      }
    } catch (error) {
      firstError ??= error;
    }
    if (metadataCleared) {
      try {
        if (ownerId && (this.ownerId === ownerId || this.ownerId === null)) {
          await clearAllPendingMutations(ownerId);
        }
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
    if (this.ownerId !== null && this.ownerId !== ownerId) return;
    this.metadata = null;
    this.ownerId = null;
    this.setConflict(null);
    try {
      await this.reportDisconnected("Harbourline sync disconnected.", disconnectGeneration, ownerId, householdId);
    } catch (error) {
      firstError ??= error;
    }
    if (firstError) throw firstError;
  }

  async suspendCloudAccess(preserveMetadata = false, skipDisconnect = false): Promise<void> {
    const inFlightFlush = this.flushPromise;
    const inFlightRemoteChange = this.remoteChangePromise;
    const inFlightOperations = [...this.inFlightOperations];
    const inFlightDisconnect = skipDisconnect ? null : this.disconnectPromise;
    this.setCloudAccess(false, preserveMetadata);
    if (inFlightDisconnect) await inFlightDisconnect.catch(() => undefined);
    if (inFlightFlush) await inFlightFlush.catch(() => undefined);
    if (inFlightRemoteChange) await inFlightRemoteChange.catch(() => undefined);
    await Promise.allSettled(inFlightOperations);
  }

  async keepDeviceVersion(): Promise<void> {
    return this.trackOperation(() => this.keepDeviceVersionInternal());
  }

  private async keepDeviceVersionInternal(): Promise<void> {
    if (!this.cloudAccess || !this.conflict || !this.metadata || !this.ownerId) return;
    const generation = this.lifecycleGeneration;
    const metadata: LocalSyncMetadata = {
      ...this.metadata,
      revision: this.conflict.revision,
      lastSyncedHash: stableStateHash(this.bridge.read()),
      lastSyncedAt: new Date().toISOString()
    };
    await setSyncMetadata(metadata);
    if (!this.isCurrent(generation)) {
      try {
        await clearSyncMetadataIfMatches(metadata);
      } catch (error) {
        await this.onCleanupFailure(error, metadata.ownerId);
      }
      return;
    }
    this.metadata = metadata;
    await clearPendingMutations(this.ownerId, metadata.householdId);
    if (!this.isCurrent(generation)) return;
    this.setConflict(null);
    await this.queueState(this.bridge.read(), true);
    if (!this.isCurrent(generation)) return;
  }

  async useHouseholdVersion(): Promise<void> {
    return this.trackOperation(() => this.useHouseholdVersionInternal());
  }

  private async useHouseholdVersionInternal(): Promise<void> {
    if (!this.cloudAccess || !this.conflict || !this.ownerId) return;
    const generation = this.lifecycleGeneration;
    const remote = this.conflict;
    this.applyRemote(remote);
    await this.recordRemote(remote, generation);
    if (!this.isCurrent(generation) || !this.ownerId || !this.metadata?.householdId) return;
    const ownerId = this.ownerId;
    const householdId = this.metadata.householdId;
    await clearPendingMutations(ownerId, householdId);
    if (!this.isCurrent(generation)) return;
    this.setConflict(null);
    await this.report("Household version restored on this device.", "good", generation);
  }

  private queueState(state: unknown, immediate = false): Promise<void> {
    return this.trackOperation(() => this.queueStateInternal(state, immediate));
  }

  private async queueStateInternal(state: unknown, immediate = false): Promise<void> {
    if (!this.cloudAccess || !this.metadata || !this.ownerId) return;
    const generation = this.lifecycleGeneration;
    const ownerId = this.ownerId;
    const metadata = this.metadata;
    const mutation = createPendingMutation({
      ownerId,
      householdId: metadata.householdId,
      baseRevision: metadata.revision,
      schemaVersion: this.bridge.schemaVersion,
      state
    });
    await putPendingMutation(mutation);
    if (!this.isCurrent(generation)) {
      try {
        await deletePendingMutation(ownerId, mutation.id);
      } catch (error) {
        await this.onCleanupFailure(error, ownerId);
      }
      return;
    }
    await this.report(navigator.onLine ? "Saving to household..." : "Change queued for sync.", "warning", generation);
    if (!this.isCurrent(generation)) return;
    window.clearTimeout(this.flushTimer);
    if (immediate) {
      await this.flush();
    } else {
      this.flushTimer = window.setTimeout(() => void this.flush(), 450);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      const inFlight = this.flushPromise;
      if (inFlight) await inFlight.catch(() => undefined);
      if (this.cloudAccess && this.metadata && navigator.onLine && !this.conflict) {
        await this.flush();
      }
      return;
    }
    if (!this.cloudAccess || !this.metadata || !navigator.onLine || this.conflict) return;
    const generation = this.lifecycleGeneration;
    this.flushing = true;
    const operation = this.runFlush(generation);
    this.flushPromise = operation;
    try {
      await operation;
    } finally {
      if (this.flushPromise === operation) this.flushPromise = null;
      this.flushing = false;
    }
  }

  private async runFlush(generation: number): Promise<void> {
    try {
      const allPending = await listPendingMutations();
      if (!this.isCurrent(generation) || !this.ownerId) return;
      const ownerId = this.ownerId;
      const queued = compactMutations(allPending.filter((mutation) => mutation.ownerId === ownerId))
        .filter((mutation) => mutation.householdId === this.metadata?.householdId);
      for (const pending of queued) {
        if (!this.isCurrent(generation) || !this.metadata) return;
        const mutation = {
          ...pending,
          baseRevision: this.metadata.revision,
          attempts: pending.attempts + 1
        };
        const result = await this.cloud.syncBudget(mutation);
        if (!this.isCurrent(generation)) return;
        if (result.conflict) {
          this.setConflict(result.document);
          await this.report("A newer household version needs your choice.", "danger", generation);
          return;
        }
        const superseded = allPending.filter((mutation) => (
          mutation.ownerId === ownerId &&
          mutation.householdId === pending.householdId
          && mutation.createdAt <= pending.createdAt
        ));
        try {
          await Promise.all(superseded.map((mutation) => deletePendingMutation(ownerId, mutation.id)));
        } catch (error) {
          await this.onCleanupFailure(error, ownerId);
          return;
        }
        if (!this.isCurrent(generation)) return;
        await this.recordRemote(result.document, generation);
      }
      if (!this.isCurrent(generation)) return;
      await this.report("Saved to household.", "good", generation);
    } catch {
      if (!this.isCurrent(generation)) return;
      await this.report(
        navigator.onLine ? "Sync paused. Your change is safe on this device." : "Change queued for sync.",
        "warning",
        generation
      );
    }
  }

  private async receiveRemoteChange(expectedHouseholdId?: string): Promise<void> {
    if (
      !this.cloudAccess ||
      !this.metadata ||
      this.flushing ||
      (expectedHouseholdId && this.metadata.householdId !== expectedHouseholdId)
    ) return;
    const generation = this.lifecycleGeneration;
    const ownerId = this.ownerId;
    const householdId = expectedHouseholdId ?? this.metadata.householdId;
    const operation = this.trackOperation(() => this.receiveRemoteChangeOperation(generation, ownerId, householdId));
    this.remoteChangePromise = operation;
    try {
      await operation;
    } finally {
      if (this.remoteChangePromise === operation) this.remoteChangePromise = null;
    }
  }

  private async receiveRemoteChangeOperation(
    generation: number,
    ownerId: string | null,
    householdId: string
  ): Promise<void> {
    try {
      const remote = await this.cloud.fetchBudget(householdId);
      if (!this.isCurrent(generation, ownerId) || this.metadata?.householdId !== householdId) return;
      const comparison = compareSyncState(this.bridge.read(), this.metadata, remote);
      if (comparison.decision === "download") {
        this.applyRemote(remote);
        await this.recordRemote(remote, generation);
        if (!this.isCurrent(generation, ownerId) || this.metadata?.householdId !== householdId) return;
        await this.report("Updated from your household.", "good", generation);
      } else if (comparison.decision === "conflict") {
        this.setConflict(remote);
        await this.report("A newer household version needs your choice.", "danger", generation);
      }
    } catch {
      if (!this.isCurrent(generation, ownerId)) return;
      await this.report("Could not check the latest household version.", "warning", generation);
    }
  }

  private trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    const promise = operation();
    this.inFlightOperations.add(promise);
    void promise.then(
      () => this.inFlightOperations.delete(promise),
      () => this.inFlightOperations.delete(promise)
    );
    return promise;
  }

  private isCurrent(generation: number, ownerId = this.ownerId): boolean {
    return this.cloudAccess && this.lifecycleGeneration === generation && this.ownerId === ownerId;
  }

  private applyRemote(remote: RemoteBudgetDocument): void {
    this.bridge.replace(remote.state, "cloud");
  }

  private async recordRemote(remote: RemoteBudgetDocument, generation: number): Promise<void> {
    if (!this.ownerId || !this.isCurrent(generation)) return;
    const metadata: LocalSyncMetadata = {
      ownerId: this.ownerId,
      householdId: remote.householdId,
      revision: remote.revision,
      lastSyncedHash: stableStateHash(remote.state),
      lastSyncedAt: new Date().toISOString()
    };
    await setSyncMetadata(metadata);
    if (!this.isCurrent(generation)) {
      try {
        await clearSyncMetadataIfMatches(metadata);
      } catch (error) {
        await this.onCleanupFailure(error, metadata.ownerId);
      }
      return;
    }
    this.metadata = metadata;
  }

  private setConflict(remote: RemoteBudgetDocument | null): void {
    this.conflict = remote;
    this.onConflict(remote);
  }

  private async countQueuedMutations(ownerId: string | null, householdId?: string): Promise<number> {
    if (!ownerId) return 0;
    const queued = await listPendingMutations();
    return queued.filter((mutation) =>
      mutation.ownerId === ownerId &&
      (householdId === undefined || mutation.householdId === householdId)
    ).length;
  }

  private async reportDisconnected(
    message: string,
    generation: number,
    ownerId: string | null,
    householdId?: string
  ): Promise<void> {
    if (this.lifecycleGeneration !== generation || this.cloudAccess || this.ownerId !== null) return;
    const queued = await this.countQueuedMutations(ownerId, householdId);
    if (this.lifecycleGeneration !== generation || this.cloudAccess || this.ownerId !== null) return;
    this.onStatus({ message, tone: "neutral", queued, online: navigator.onLine });
  }

  private async report(
    message: string,
    tone: Release2Status["tone"],
    generation?: number
  ): Promise<void> {
    const ownerId = this.ownerId;
    const householdId = this.metadata?.householdId;
    const queued = await this.countQueuedMutations(ownerId, householdId);
    if (
      (generation !== undefined && !this.isCurrent(generation, ownerId)) ||
      this.ownerId !== ownerId ||
      this.metadata?.householdId !== householdId
    ) return;
    this.onStatus({ message, tone, queued, online: navigator.onLine });
  }
}
