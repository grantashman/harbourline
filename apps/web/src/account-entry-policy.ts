export interface AuthResultAccountPanelInput {
  authCallbackRejected: boolean;
  dialogOpen: boolean;
}

export function shouldOpenAccountPanelForAuthResult(input: AuthResultAccountPanelInput): boolean {
  return input.authCallbackRejected && !input.dialogOpen;
}
