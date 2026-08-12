import "./release2.css";
import { AccountPanel } from "./account-panel";
import { initialiseMonitoring } from "./monitoring";
import { inject } from "@vercel/analytics";
import { initialisePwaUpdate } from "./pwa-update";

async function startRelease2(): Promise<void> {
  initialiseMonitoring();
  initialisePwaUpdate();
  inject();
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
