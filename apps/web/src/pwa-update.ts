import { getPwaUpdateMessage, getPwaUpdateStatus, type PwaUpdateStatus } from "./pwa-update-policy";

const UPDATE_BANNER_ID = "harbourline-pwa-update";

function renderStatus(status: PwaUpdateStatus, update: (() => Promise<void>) | null): void {
  const message = getPwaUpdateMessage(status);
  if (!message) {
    document.getElementById(UPDATE_BANNER_ID)?.remove();
    return;
  }

  let banner = document.getElementById(UPDATE_BANNER_ID);
  if (!banner) {
    banner = document.createElement("section");
    banner.id = UPDATE_BANNER_ID;
    banner.className = "release2-pwa-update";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    document.body.append(banner);
  }
  banner.innerHTML = status === "update-available"
    ? `<span>${message} Refresh when your current work is saved.</span><button class="btn" type="button" data-pwa-action="update">Update</button>`
    : `<span>${message}</span>`;
  banner.querySelector<HTMLButtonElement>("[data-pwa-action='update']")?.addEventListener("click", () => {
    if (!update) return;
    const button = banner?.querySelector<HTMLButtonElement>("[data-pwa-action='update']");
    if (button) button.disabled = true;
    void update();
  });
}

export function initialisePwaUpdate(): void {
  if (!("serviceWorker" in navigator)) return;
  let updateAvailable = false;
  let offlineReady = false;
  let registration: ServiceWorkerRegistration | null = null;
  const refresh = (): void => {
    renderStatus(
      getPwaUpdateStatus({ updateAvailable, offlineReady }),
      registration
        ? async () => {
          const waiting = registration?.waiting;
          if (!waiting) {
            window.location.reload();
            return;
          }
          waiting.postMessage({ type: "SKIP_WAITING" });
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
          });
          window.location.reload();
        }
        : null
    );
  };

  void navigator.serviceWorker.register("./sw.js")
    .then((nextRegistration) => {
      registration = nextRegistration;
      nextRegistration.addEventListener("updatefound", () => {
        const worker = nextRegistration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state !== "installed") return;
          if (navigator.serviceWorker.controller) updateAvailable = true;
          else offlineReady = true;
          refresh();
        });
      });
      if (nextRegistration.waiting) {
        updateAvailable = Boolean(navigator.serviceWorker.controller);
        refresh();
      }
    })
    .catch((error: unknown) => {
      console.warn("Harbourline service worker registration failed", error);
    });
}
