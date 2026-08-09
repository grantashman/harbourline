export type WorkspaceAccess = "signed-out" | "free" | "paid";

export interface WorkspaceAccessContext {
  signedIn: boolean;
  billingReconciled: boolean;
  subscriptionActive: boolean | null;
}

export function isVerifiedAccountUser(
  user: { is_anonymous?: boolean } | null | undefined
): boolean {
  return user?.is_anonymous === false;
}

export function resolveWorkspaceAccess(context: WorkspaceAccessContext): WorkspaceAccess {
  if (!context.signedIn) return "signed-out";
  return context.billingReconciled && context.subscriptionActive === true ? "paid" : "free";
}
