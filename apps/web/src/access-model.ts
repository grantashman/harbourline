export type WorkspaceAccess = "free" | "paid";

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
  return context.signedIn && context.billingReconciled && context.subscriptionActive === true ? "paid" : "free";
}
