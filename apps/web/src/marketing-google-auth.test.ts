import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const marketingSource = readFileSync(resolve(repositoryRoot, "marketing/index.html"), "utf8");

test("homepage Google auth hands off to the hosted app", () => {
  assert.match(marketingSource, /appUrl\.searchParams\.set\("account", "signin"\)/);
  assert.match(marketingSource, /appUrl\.searchParams\.set\("provider", "google"\)/);
  assert.match(marketingSource, /window\.location\.assign\(appUrl\.toString\(\)\)/);
  assert.doesNotMatch(marketingSource, /signInWithOAuth/);
});

test("free magic-link confirmation returns users to free setup, not payment", () => {
  assert.match(
    marketingSource,
    /Check your email for a secure sign-in link\. It will return you to Harbourline so you can continue setting up your free payday plan\./
  );
  assert.doesNotMatch(marketingSource, /continue to payment/i);
});

test("homepage explains the concrete outcome and local free boundary", () => {
  assert.match(marketingSource, /Turn every bill into a plan for your next payday\./);
  assert.match(marketingSource, /Build your free payday plan/);
  assert.match(marketingSource, /not cloud backup/);
  assert.match(marketingSource, /Fictional fortnightly household/);
});
