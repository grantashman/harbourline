export function shouldTrackVerifiedSession(
  trackedUserId: string | null,
  nextUserId: string | null
): boolean {
  return nextUserId !== null && trackedUserId !== nextUserId;
}
