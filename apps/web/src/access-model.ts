export type WorkspaceAccess = "free" | "paid";

export interface WorkspaceAccessContext {
  signedIn: boolean;
  billingReconciled: boolean;
  subscriptionActive: boolean | null;
}

export function resolveWorkspaceAccess(context: WorkspaceAccessContext): WorkspaceAccess {
  return context.signedIn && context.billingReconciled && context.subscriptionActive === true ? "paid" : "free";
}
