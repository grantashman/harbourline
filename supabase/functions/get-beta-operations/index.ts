import {
  BetaOperationsSnapshot,
  corsHeaders,
  createServiceRoleClient,
  errorResponse,
  HttpError,
  jsonResponse,
  parseOperatorEmails,
  requireAuthenticatedUser
} from "../_shared/beta.ts";

interface EventRow {
  event_name: string;
  occurred_at: string;
}

interface UserRow {
  created_at: string;
}

function dayFromTimestamp(value: string): string {
  return value.slice(0, 10);
}

function aggregateDaily(events: EventRow[], users: UserRow[]): BetaOperationsSnapshot["daily"] {
  const counts = new Map<string, number>();
  const add = (day: string, eventName: string) => {
    const key = `${day}\u0000${eventName}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const event of events) add(dayFromTimestamp(event.occurred_at), event.event_name);
  for (const user of users) add(dayFromTimestamp(user.created_at), "signup");

  return [...counts.entries()]
    .map(([key, count]) => {
      const [day, eventName] = key.split("\u0000");
      return { day, eventName, count };
    })
    .sort((left, right) => right.day.localeCompare(left.day) || left.eventName.localeCompare(right.eventName));
}

async function loadAllEventRows(serviceClient: ReturnType<typeof createServiceRoleClient>): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await serviceClient
      .from("beta_operational_events")
      .select("event_name, occurred_at")
      .order("occurred_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []) as EventRow[]);
    if (!data || data.length < pageSize) return rows;
  }
}

async function loadAllUsers(serviceClient: ReturnType<typeof createServiceRoleClient>): Promise<UserRow[]> {
  const rows: UserRow[] = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data.users as UserRow[];
    rows.push(...users);
    if (users.length < perPage) return rows;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

  try {
    const user = await requireAuthenticatedUser(request);
    const operatorEmails = parseOperatorEmails(Deno.env.get("HARBOURLINE_OPERATOR_EMAILS"));
    if (!user.email || !operatorEmails.has(user.email.trim().toLowerCase())) {
      throw new HttpError(403, "Operator access is required");
    }

    const serviceClient = createServiceRoleClient();
    const [events, users, active, pastDue, cancelled] = await Promise.all([
      loadAllEventRows(serviceClient),
      loadAllUsers(serviceClient),
      serviceClient.from("billing_subscriptions").select("user_id", { count: "exact", head: true }).in("status", ["active", "trialing"]),
      serviceClient.from("billing_subscriptions").select("user_id", { count: "exact", head: true }).eq("status", "past_due"),
      serviceClient.from("billing_subscriptions").select("user_id", { count: "exact", head: true }).eq("status", "canceled")
    ]);
    if (active.error) throw active.error;
    if (pastDue.error) throw pastDue.error;
    if (cancelled.error) throw cancelled.error;

    const snapshot: BetaOperationsSnapshot = {
      daily: aggregateDaily(events, users),
      activeSubscriptions: active.count ?? 0,
      pastDueSubscriptions: pastDue.count ?? 0,
      cancelledSubscriptions: cancelled.count ?? 0
    };
    return jsonResponse(snapshot);
  } catch (error) {
    return errorResponse(error);
  }
});
