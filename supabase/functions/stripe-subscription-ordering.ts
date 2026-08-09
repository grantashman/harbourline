export interface BillingSubscriptionState {
  status: string | null;
  stripe_subscription_id: string | null;
  stripe_event_created_at: string | null;
  stripe_event_id: string | null;
}

export function isStaleSubscriptionEvent(
  current: BillingSubscriptionState | null,
  incomingSubscriptionId: string,
  incomingEventCreatedAt: string | null,
  incomingEventId: string
): boolean {
  if (!current?.stripe_event_created_at || !incomingEventCreatedAt) return false;
  const currentTime = Date.parse(current.stripe_event_created_at);
  const incomingTime = Date.parse(incomingEventCreatedAt);
  if (!Number.isFinite(currentTime) || !Number.isFinite(incomingTime)) return true;
  if (incomingTime < currentTime) return true;
  if (incomingTime > currentTime) return false;
  if (current.stripe_subscription_id !== incomingSubscriptionId) return true;
  if (current.stripe_event_id) return current.stripe_event_id >= incomingEventId;
  return false;
}
