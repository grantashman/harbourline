import * as Sentry from "@sentry/browser";

const SENSITIVE_KEY = /budget|income|expense|transaction|amount|state|description/i;
let monitoringStarted = false;

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[redacted]" : scrubValue(nested)
    ])
  );
}

function scrubEvent(event: Record<string, any>): Record<string, any> {
  const scrubbed = { ...event };
  delete scrubbed.request?.data;
  delete scrubbed.extra;
  delete scrubbed.contexts;

  if (Array.isArray(scrubbed.breadcrumbs)) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map((breadcrumb: Record<string, any>) => ({
      ...breadcrumb,
      message: undefined,
      data: scrubValue(breadcrumb.data)
    }));
  }

  if (scrubbed.tags && typeof scrubbed.tags === "object") {
    scrubbed.tags = Object.fromEntries(
      Object.entries(scrubbed.tags).filter(([key]) => !SENSITIVE_KEY.test(key))
    );
  }

  return scrubbed;
}

export function initialiseMonitoring(): void {
  if (monitoringStarted) return;

  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  const environment = import.meta.env.VITE_HARBOURLINE_DEPLOYMENT?.trim();
  if (!dsn || !environment) return;

  monitoringStarted = true;
  Sentry.init({
    dsn,
    environment,
    release: import.meta.env.VITE_HARBOURLINE_RELEASE?.trim() || undefined,
    beforeSend: (event) => scrubEvent(event as Record<string, any>) as typeof event
  });
}

export function reportError(error: unknown): void {
  if (!monitoringStarted) return;
  Sentry.captureException(error);
}
