import { Capacitor } from "@capacitor/core";
import { App, type AppState, type BackButtonListenerEvent } from "@capacitor/app";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";

export type MobileAppUrlKind = "auth" | "recovery" | "calendar" | "billing" | "support" | "export";
export type BackAction = "close-dialog" | "history-back" | "exit";

export interface ParsedMobileAppUrl {
  kind: MobileAppUrlKind;
  path: string;
  query: Record<string, string>;
  hasFragment: boolean;
}

export interface MobilePlatformCallbacks {
  onAppUrlOpen?: (url: ParsedMobileAppUrl, rawUrl: string) => void;
  onResume?: () => void;
}

const APPROVED_HOSTS = new Set(["harbourline.app", "www.harbourline.app"]);
const APPROVED_QUERY_VALUES = new Map([
  ["account", new Set(["signin"])],
  ["recovery", new Set(["1"])],
  ["calendar", new Set(["connected", "error"])],
  ["billing", new Set(["success", "cancelled", "portal"])]
]);
const APPROVED_AUTH_FRAGMENT_KEYS = new Set([
  "access_token",
  "error",
  "error_code",
  "error_description",
  "expires_at",
  "expires_in",
  "refresh_token",
  "token_type",
  "type"
]);

function classifyQuery(query: URLSearchParams): MobileAppUrlKind | null {
  const keys = [...query.keys()];
  if (keys.length === 0 || keys.some((key) => !APPROVED_QUERY_VALUES.has(key))) return null;
  const keySet = new Set(keys);
  const isBillingReturn = keySet.size === 2 && keySet.has("billing") && keySet.has("account");
  if (keySet.size !== 1 && !isBillingReturn) return null;
  for (const key of new Set(keys)) {
    const values = query.getAll(key);
    const allowed = APPROVED_QUERY_VALUES.get(key);
    if (values.length !== 1 || !allowed?.has(values[0] ?? "")) return null;
  }
  if (query.has("billing")) return "billing";
  if (query.has("account")) return "auth";
  if (query.has("recovery")) return "recovery";
  if (query.has("calendar")) return "calendar";
  return null;
}

/**
 * Parse only the mobile return URLs that Harbourline explicitly owns.
 *
 * The returned object intentionally contains no fragment or query secrets. A
 * native auth callback may have access/refresh tokens in its fragment; the
 * caller can forward the original URL to the local Supabase client without
 * logging or serialising those values.
 */
export function parseMobileAppUrl(rawUrl: string): ParsedMobileAppUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !APPROVED_HOSTS.has(url.hostname.toLowerCase())
  ) return null;

  const path = url.pathname === "" ? "/" : url.pathname;
  if (path === "/support") {
    return url.search || url.hash ? null : { kind: "support", path, query: {}, hasFragment: false };
  }
  if (path === "/export") {
    return url.search || url.hash ? null : { kind: "export", path, query: {}, hasFragment: false };
  }
  if (path !== "/") return null;

  const kind = classifyQuery(url.searchParams);
  if (!kind) return null;
  return {
    kind,
    path,
    query: Object.fromEntries(url.searchParams.entries()),
    hasFragment: url.hash.length > 0
  };
}

export function resolveBackAction(options: { dialogOpen: boolean; canGoBack: boolean }): BackAction {
  if (options.dialogOpen) return "close-dialog";
  if (options.canGoBack) return "history-back";
  return "exit";
}

export function hasApprovedAuthFragment(rawUrl: string, kind: MobileAppUrlKind): boolean {
  if (kind !== "auth" && kind !== "recovery") return true;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!url.hash) return true;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const keys = [...fragment.keys()];
  if (keys.length === 0 || new Set(keys).size !== keys.length) return false;
  if (keys.some((key) => !APPROVED_AUTH_FRAGMENT_KEYS.has(key))) return false;
  if ([...fragment.values()].some((value) => value.length === 0)) return false;
  return fragment.has("access_token") || fragment.has("error");
}

function base64Encode(value: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < value.length; index += chunkSize) {
    binary += String.fromCharCode(...value.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function safeFilename(filename: string): string {
  const cleaned = filename.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return cleaned.slice(0, 120) || "harbourline-export.json";
}

export class MobilePlatformAdapter {
  readonly isNative = Capacitor.isNativePlatform();
  private listeners: Array<{ remove: () => Promise<void> }> = [];
  private lastHandledUrl: string | null = null;
  private pendingExportPaths = new Set<string>();

  private handleAppUrl(rawUrl: string, callback?: MobilePlatformCallbacks["onAppUrlOpen"]): void {
    if (rawUrl === this.lastHandledUrl) return;
    this.lastHandledUrl = rawUrl;
    const parsed = parseMobileAppUrl(rawUrl);
    if (parsed) callback?.(parsed, rawUrl);
  }

  private async cleanupStaleExports(): Promise<void> {
    try {
      const { files } = await Filesystem.readdir({ path: "exports", directory: Directory.Cache });
      await Promise.all(files.map(({ name }) => Filesystem.deleteFile({
        path: `exports/${name}`,
        directory: Directory.Cache
      }).catch(() => undefined)));
    } catch {
      // The export directory may not exist on first launch.
    }
  }

  private scheduleExportCleanup(path: string): void {
    this.pendingExportPaths.add(path);
    window.setTimeout(() => {
      this.pendingExportPaths.delete(path);
      void Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
    }, 30_000);
  }

  async initialise(callbacks: MobilePlatformCallbacks = {}): Promise<void> {
    if (!this.isNative) return;

    await this.cleanupStaleExports();

    try {
      await StatusBar.setStyle({ style: Style.Dark });
    } catch {
      // Status bar styling is advisory; the packaged web app remains usable.
    }

    const appUrlListener = await App.addListener("appUrlOpen", ({ url }: { url: string }) => {
      this.handleAppUrl(url, callbacks.onAppUrlOpen);
    });
    this.listeners.push(appUrlListener);

    const launch = await App.getLaunchUrl();
    if (launch?.url) {
      this.handleAppUrl(launch.url, callbacks.onAppUrlOpen);
    }

    const stateListener = await App.addListener("appStateChange", (state: AppState) => {
      if (state.isActive) callbacks.onResume?.();
      window.dispatchEvent(new CustomEvent("harbourline:app-lifecycle", {
        detail: { active: state.isActive }
      }));
    });
    this.listeners.push(stateListener);

    const backListener = await App.addListener("backButton", (event: BackButtonListenerEvent) => {
      const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
      const action = resolveBackAction({ dialogOpen: Boolean(dialog), canGoBack: event.canGoBack });
      if (action === "close-dialog") {
        dialog?.close();
      } else if (action === "history-back") {
        window.history.back();
      } else {
        void App.exitApp();
      }
    });
    this.listeners.push(backListener);
  }

  async shareExport(blob: Blob, filename: string): Promise<boolean> {
    if (!this.isNative) return false;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const path = `exports/${crypto.randomUUID()}-${safeFilename(filename)}`;
    const result = await Filesystem.writeFile({
      path,
      data: base64Encode(bytes),
      directory: Directory.Cache,
      recursive: true
    });
    try {
      await Share.share({
        title: "Harbourline export",
        text: "Harbourline export",
        files: [result.uri],
        dialogTitle: "Share Harbourline export"
      });
      this.scheduleExportCleanup(path);
      return true;
    } catch (error) {
      await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
      if (error && typeof error === "object" && "message" in error && String(error.message).toLowerCase().includes("cancel")) return false;
      throw error;
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.pendingExportPaths].map((path) => Filesystem.deleteFile({
      path,
      directory: Directory.Cache
    }).catch(() => undefined)));
    this.pendingExportPaths.clear();
    await Promise.all(this.listeners.splice(0).map((listener) => listener.remove()));
  }
}

export function makeNativeAuthReturnUrl(parsed: ParsedMobileAppUrl, fragment: string): string {
  const search = new URLSearchParams(parsed.query).toString();
  return `${parsed.path}${search ? `?${search}` : ""}${fragment}`;
}
