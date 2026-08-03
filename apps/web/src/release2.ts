import "./release2.css";
import { AccountPanel } from "./account-panel";
import { initialiseMonitoring } from "./monitoring";
import { inject } from "@vercel/analytics";

async function startRelease2(): Promise<void> {
  initialiseMonitoring();
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
