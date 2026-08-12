import { hasApprovedAuthFragment, makeNativeAuthReturnUrl, MobilePlatformAdapter } from "./mobile-platform";

interface NativeWindowBridge {
  isNative: boolean;
  authRedirectOrigin: string;
  shareExport(blob: Blob, filename: string): Promise<boolean>;
}

declare global {
  interface Window {
    HarbourlineMobile?: NativeWindowBridge;
  }
}

const mobile = new MobilePlatformAdapter();
window.HarbourlineMobile = {
  isNative: mobile.isNative,
  authRedirectOrigin: "https://harbourline.app",
  shareExport: (blob, filename) => mobile.shareExport(blob, filename)
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