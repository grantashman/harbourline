import { inject, track as trackVercel } from "@vercel/analytics";
import posthog from "posthog-js";

let analyticsInitialised = false;
let posthogInitialised = false;

function configuredPosthogValue(variableName: "VITE_POSTHOG_KEY" | "VITE_POSTHOG_HOST"): string | undefined {
  const value = String(import.meta.env[variableName] ?? "").trim();
  if (value) return value;

  if (import.meta.env.DEV) {
    throw new Error(
      `${variableName} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variableName} is configured`
    );
  }

  return undefined;
}

export function initialiseAnalytics(): void {
  if (analyticsInitialised) return;
  analyticsInitialised = true;
  inject();

  const key = configuredPosthogValue("VITE_POSTHOG_KEY");
  const host = configuredPosthogValue("VITE_POSTHOG_HOST");
  if (!key || !host) return;

  posthog.init(key, {
    api_host: host.replace(/\/+$/, ""),
    capture_pageview: "history_change",
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false
    }
  });
  posthogInitialised = true;
}

/**
 * Capture only the event name. Product data, financial values, and user-entered
 * descriptions must never be passed through this boundary.
 */
export function track(eventName: string): void {
  trackVercel(eventName);
  if (posthogInitialised) posthog.capture(eventName);
}

export function identifyUser(userId: string): void {
  if (posthogInitialised) posthog.identify(userId);
}

export function resetUser(): void {
  if (posthogInitialised) posthog.reset();
}