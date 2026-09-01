import { AccountPanel } from "./account-panel";
import { initialiseAnalytics } from "./analytics";
import { initialiseMonitoring } from "./monitoring";
import { initialisePwaUpdate } from "./pwa-update";

async function startRelease2(): Promise<void> {
  initialiseMonitoring();
  initialisePwaUpdate();
  initialiseAnalytics();
  const bridge = window.HarbourlineLocal;
  if (!bridge) return;
  const accountPanel = new AccountPanel(bridge);
  await accountPanel.initialise();
}

if (window.HarbourlineLocal) {
  void startRelease2();
} else {
  window.addEventListener("harbourline:ready", () => void startRelease2(), { once: true });
}
