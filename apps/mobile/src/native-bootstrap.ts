import { hasApprovedAuthFragment, makeNativeAuthReturnUrl, MobilePlatformAdapter } from "./mobile-platform.ts";

interface NativeWindowBridge {
  isNative: boolean;
  authRedirectOrigin: string;
  shareExport(blob: Blob, filename: string): Promise<boolean>;
  getReminderPermission(): Promise<"granted" | "denied" | "prompt" | "unsupported">;
  requestReminderNotifications(): Promise<"granted" | "denied" | "prompt" | "unsupported">;
  scheduleGenericReminder(): Promise<boolean>;
  cancelGenericReminder(): Promise<boolean>;
}

declare global {
  interface Window {
    HarbourlineMobile?: NativeWindowBridge;
  }
}

function installViewportSizing(): void {
  const update = (): void => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty("--harbourline-viewport-height", `${Math.round(height)}px`);
  };
  update();
  window.visualViewport?.addEventListener("resize", update);
  window.visualViewport?.addEventListener("scroll", update);
  window.addEventListener("orientationchange", update);
}

const mobile = new MobilePlatformAdapter();
installViewportSizing();
window.HarbourlineMobile = {
  isNative: mobile.isNative,
  authRedirectOrigin: "https://harbourline.app",
  shareExport: (blob, filename) => mobile.shareExport(blob, filename),
  getReminderPermission: () => mobile.getReminderPermission(),
  requestReminderNotifications: () => mobile.requestReminderNotifications(),
  scheduleGenericReminder: () => mobile.scheduleGenericReminder(),
  cancelGenericReminder: () => mobile.cancelGenericReminder()
};

void mobile.initialise({
  onAppUrlOpen: (parsed, rawUrl) => {
    if (!hasApprovedAuthFragment(rawUrl, parsed.kind)) return;
    const fragment = parsed.kind === "auth" || parsed.kind === "recovery"
      ? new URL(rawUrl).hash
      : "";
    window.location.replace(makeNativeAuthReturnUrl(parsed, fragment));
  }
});