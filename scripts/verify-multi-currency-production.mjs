import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const index = read("index.html");
const migrationPath = path.join(repoRoot, "supabase/migrations/20260812000000_enable_nzd_usd_budget_currencies.sql");
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";
const workflow = read(".github/workflows/supabase-production.yml");
const release = read("docs/MULTI_CURRENCY_RELEASE.md");
const marketing = read("marketing/index.html");
const marketingBlog = read("marketing/blog/index.html");

assert.match(index, /globalThis\.HarbourlineCurrencyConfig\s*\?\?=\s*\{[\s\S]*?enabledCurrencies:\s*\["AUD",\s*"NZD",\s*"USD"\]/,
  "browser production allowlist must enable AUD, NZD, and USD");
assert.match(index, /defaultCurrency:\s*"AUD"/, "AUD must remain the production default");
assert.match(index, /NZD:\s*\{\s*minorUnit:\s*2,\s*locale:\s*"en-NZ"\s*\}/, "NZD browser metadata is required");
assert.match(index, /USD:\s*\{\s*minorUnit:\s*2,\s*locale:\s*"en-US"\s*\}/, "USD browser metadata is required");

assert.match(migration, /update\s+public\.currency_catalog/i, "an additive enablement migration is required");
assert.match(migration, /set\s+enabled\s*=\s*true/i, "the migration must enable the pilot rows");
assert.match(migration, /where\s+code\s+in\s*\(\s*'NZD'\s*,\s*'USD'\s*\)/i, "only NZD and USD may be enabled by this migration");
assert.match(migration, /verified_at\s*=\s*now\(\)/i, "the enablement must record verification time");

assert.match(workflow, /BUDGET_CURRENCIES:\s*["']AUD,NZD,USD["']/, "production workflow must declare the budget allowlist");
assert.match(workflow, /STRIPE_BILLING_CURRENCY:\s*aud/, "subscription billing must remain AUD");
assert.match(workflow, /currency_catalog.*NZD.*enabled.*USD.*enabled/is, "production verification must assert NZD and USD are enabled");
assert.doesNotMatch(workflow, /aud_only_ok|every non-AUD|only AUD/i, "production workflow must not retain the AUD-only invariant");

assert.match(release, /AUD[\s\S]*NZD[\s\S]*USD[\s\S]*budget/i, "release record must name the enabled budget currencies");
assert.match(release, /subscription billing remains AUD/i, "release record must distinguish budget and billing currencies");

for (const [name, page] of [["marketing homepage", marketing], ["marketing blog", marketingBlog]]) {
  assert.match(page, /AUD,\s*NZD\s*(?:or|and)\s*USD/i, `${name} must name the supported budget currencies`);
  assert.match(page, /(?:subscription|subscriptions)[^\n.]*billed in AUD/i, `${name} must distinguish AUD subscription billing`);
}

assert.doesNotMatch(marketing, /Australian dollars/i, "marketing homepage must not describe budgeting as Australian-dollars-only");

console.log("multi-currency production guard passed");
