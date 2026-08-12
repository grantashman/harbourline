export type PwaUpdateStatus = "current" | "offline-ready" | "update-available";

export function getPwaUpdateStatus(input: {
  updateAvailable: boolean;
  offlineReady: boolean;
}): PwaUpdateStatus {
  if (input.updateAvailable) return "update-available";
  if (input.offlineReady) return "offline-ready";
  return "current";
}

export function getPwaUpdateMessage(status: PwaUpdateStatus): string | null {
  if (status === "update-available") return "A new Harbourline version is ready.";
  if (status === "offline-ready") return "Harbourline is ready to use offline.";
  return null;
}
