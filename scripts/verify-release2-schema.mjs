import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/202607300001_release_2_household_sync.sql",
  import.meta.url
);
const sql = await readFile(migrationUrl, "utf8");
const googleMigrationUrl = new URL(
  "../supabase/migrations/202607310004_google_calendar_sync.sql",
  import.meta.url
);
const googleSql = await readFile(googleMigrationUrl, "utf8");
const entitlementMigrationUrl = new URL(
  "../supabase/migrations/202608080001_household_cloud_entitlements.sql",
  import.meta.url
);
const entitlementSql = await readFile(entitlementMigrationUrl, "utf8");
const orderingMigrationUrl = new URL(
  "../supabase/migrations/20260809001951_stripe_subscription_event_ordering.sql",
  import.meta.url
);
const orderingSql = await readFile(orderingMigrationUrl, "utf8");

const requiredTables = [
  "profiles",
  "households",
  "household_members",
  "household_invites",
  "budget_documents",
  "sync_mutations"
];

for (const table of requiredTables) {
  assert.match(
    sql,
    new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    `${table} must have row level security enabled`
  );
  assert.match(
    sql,
    new RegExp(`revoke all on public\\.${table} from anon`, "i"),
    `${table} must explicitly revoke anonymous access`
  );
}

for (const guardedFunction of [
  "create_household",
  "create_household_invite",
  "accept_household_invite",
  "sync_budget",
  "transfer_household_ownership",
  "delete_household",
  "export_my_account"
]) {
  const functionPattern = new RegExp(
    `create or replace function public\\.${guardedFunction}[\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`,
    "i"
  );
  assert.match(
    sql,
    functionPattern,
    `${guardedFunction} must be a fixed-search-path security definer function`
  );
}

assert.doesNotMatch(
  sql,
  /grant\s+(?:all|insert|update)\s+on\s+public\.budget_documents\s+to\s+authenticated/i,
  "clients must not write budget documents outside the revisioned sync function"
);
assert.match(sql, /document\.revision <> base_revision/i);
assert.match(sql, /jsonb_typeof\(document_state\) <> 'object'/i);
assert.match(sql, /token_hash text not null unique/i);

for (const table of ["google_calendar_connections", "google_calendar_oauth_states"]) {
  assert.match(
    googleSql,
    new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    `${table} must have row level security enabled`
  );
  assert.match(
    googleSql,
    new RegExp(`revoke all on public\\.${table} from anon, authenticated`, "i"),
    `${table} must not be directly readable by customers`
  );
}
assert.match(googleSql, /encrypted_refresh_token text not null/i);
assert.match(googleSql, /code_verifier text not null/i);

assert.match(
  entitlementSql,
  /create or replace function private\.has_household_cloud_access/i,
  "household entitlement access must be defined in the private schema"
);
assert.match(
  entitlementSql,
  /status in \('active', 'trialing'\)/i,
  "household entitlement access must use authoritative active billing states"
);
for (const triggerName of [
  "households_require_subscription",
  "household_members_require_entitlement",
  "household_invites_require_entitlement",
  "budget_documents_require_entitlement",
  "sync_mutations_require_entitlement"
]) {
  assert.match(
    entitlementSql,
    new RegExp(`create trigger ${triggerName}`, "i"),
    `${triggerName} must protect the corresponding cloud write path`
  );
}

assert.match(
  orderingSql,
  /create or replace function public\.apply_billing_subscription_snapshot/i,
  "billing subscription ordering must use an atomic database function"
);
assert.match(orderingSql, /for update/i, "billing subscription ordering must lock the current row");
assert.match(orderingSql, /target_event_created_at/i, "billing subscription ordering must persist event time");
assert.match(
  orderingSql,
  /grant execute on function public\.apply_billing_subscription_snapshot[\s\S]*to service_role/i,
  "billing subscription ordering must be service-role only"
);

console.log("Release 2 schema guard: passed");
