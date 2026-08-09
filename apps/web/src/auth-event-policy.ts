export function shouldNotifySignupForAuthEvent(
  event: string,
  recoveryMode: boolean,
  pendingRecoveryRedirect: boolean,
  recoveryFlowUserId: string | null = null,
  currentUserId: string | null = null
): boolean {
  return (
    event === "SIGNED_IN" &&
    !recoveryMode &&
    !pendingRecoveryRedirect &&
    !(recoveryFlowUserId && recoveryFlowUserId === currentUserId)
  );
}

export function shouldPreserveRecoveryForSession(
  pendingRecoveryRedirect: boolean,
  previousUserId: string | null,
  nextUserId: string | null,
  authEvent: string | null = null
): boolean {
  if (!pendingRecoveryRedirect || !nextUserId) return false;
  if (authEvent !== null) return authEvent === "PASSWORD_RECOVERY";
  return previousUserId === null || previousUserId === nextUserId;
}
