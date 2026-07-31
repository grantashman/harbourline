const SAFE_TAGS = new Set(["function", "operation", "event_type", "deployment"]);

function errorType(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function sentryEndpoint(dsn: string): string | null {
  try {
    const url = new URL(dsn);
    const segments = url.pathname.split("/").filter(Boolean);
    const projectId = segments.pop();
    if (!url.username || !projectId) return null;
    const basePath = segments.length ? `/${segments.join("/")}` : "";
    const query = new URLSearchParams({
      sentry_version: "7",
      sentry_key: url.username,
      sentry_client: "harbourline-deno/1"
    });
    return `${url.origin}${basePath}/api/${projectId}/envelope/?${query}`;
  } catch {
    return null;
  }
}

export async function captureServerError(
  error: unknown,
  tags: Record<string, string> = {}
): Promise<void> {
  const dsn = Deno.env.get("SENTRY_DSN")?.trim();
  const environment = Deno.env.get("HARBOURLINE_DEPLOYMENT")?.trim();
  const endpoint = dsn ? sentryEndpoint(dsn) : null;
  if (!endpoint || !environment) return;

  const eventId = crypto.randomUUID().replaceAll("-", "");
  const safeTags = Object.fromEntries(
    Object.entries({ ...tags, deployment: environment })
      .filter(([key, value]) => SAFE_TAGS.has(key) && typeof value === "string")
  );
  const event = {
    event_id: eventId,
    platform: "other",
    environment,
    timestamp: Date.now() / 1000,
    exception: {
      values: [{ type: errorType(error), value: "Edge function error" }]
    },
    tags: safeTags
  };
  const header = JSON.stringify({
    event_id: eventId,
    sent_at: new Date().toISOString(),
    sdk: { name: "harbourline-deno", version: "1" }
  });
  const item = JSON.stringify({ type: "event", length: JSON.stringify(event).length });

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: `${header}\n${item}\n${JSON.stringify(event)}`
    });
  } catch {
    // Monitoring must never change the customer-facing response path.
  }
}
