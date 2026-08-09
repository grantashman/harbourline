export function addRealtimeLease(leases: Set<string>, key: string): void {
  leases.add(key);
}

export function releaseRealtimeLease(leases: Set<string>, key: string): boolean {
  if (!leases.delete(key)) return false;
  return leases.size === 0;
}

export function isRealtimeFailureStatus(status: string): boolean {
  return status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED";
}
