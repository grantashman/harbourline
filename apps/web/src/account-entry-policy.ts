export interface AuthResultAccountPanelInput {
  authCallbackRejected: boolean;
  plainAccountNavigation: boolean;
  providerError: boolean;
  dialogOpen: boolean;
}

export function shouldOpenAccountPanelForAuthResult(input: AuthResultAccountPanelInput): boolean {
  return !input.dialogOpen && (
    input.authCallbackRejected ||
    input.plainAccountNavigation ||
    input.providerError
  );
}
