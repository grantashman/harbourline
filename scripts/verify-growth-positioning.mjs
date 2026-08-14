import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const homepage = readFileSync("marketing/index.html", "utf8");
const attributionMigration = readFileSync(
  "supabase/migrations/202608140001_marketing_attribution.sql",
  "utf8"
);

assert.match(homepage, /<html lang="en">/, "homepage language must not be Australia-only");
assert.match(homepage, /Payday planning for households across supported currencies/, "homepage must use a globally addressable audience label");
assert.doesNotMatch(
  homepage,
  /Australian households|Australia-first|AUD-first/i,
  "homepage marketing must not limit Harbourline to Australia"
);
assert.match(
  homepage,
  /AUD, NZD (?:and|or) USD[^\n]*budget/i,
  "homepage must name the currently supported budgeting currencies"
);

assert.match(
  homepage,
  /<h1>Know what your next payday needs to cover\.<\/h1>/,
  "homepage must lead with the payday outcome"
);
assert.match(
  homepage,
  /Try the payday plan free/,
  "homepage must use an outcome-led free CTA"
);
assert.match(
  homepage,
  /Add your income[\s\S]*Add your recurring bills[\s\S]*Open your payday plan/,
  "homepage must show the first-value sequence"
);
assert.match(
  homepage,
  /Free Starter[\s\S]*plan and export on one device[\s\S]*Household[\s\S]*shared cloud plan across devices/,
  "homepage must make the free-to-paid continuity boundary explicit"
);
assert.match(
  homepage,
  /No bank passwords[\s\S]*Export or delete your data/,
  "homepage must state the key trust boundaries"
);
assert.doesNotMatch(
  homepage,
  /Your household money plan, finally in one clear view\./,
  "homepage must not fall back to the generic feature-led hero"
);
assert.match(homepage, /marketing_attribution/, "signup must carry the bounded attribution object");
assert.match(homepage, /utm_source|utm_medium|utm_campaign/, "signup must whitelist campaign parameters");
assert.match(attributionMigration, /attribution_source/, "signup events must persist the source dimension");
assert.match(attributionMigration, /raw_user_meta_data/, "the migration must read attribution from auth metadata");

console.log("Growth positioning guard passed.");
