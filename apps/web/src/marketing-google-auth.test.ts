import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const marketingSource = readFileSync(resolve(repositoryRoot, "marketing/index.html"), "utf8");

test("signup form exposes its live status and native password validation", () => {
  assert.match(marketingSource, /<form id="earlyAccessForm" aria-describedby="formNote">/);
  assert.match(marketingSource, /id="password"[^>]*minlength="8"/);
  assert.match(marketingSource, /id="confirmPassword"[^>]*aria-describedby="formNote"/);
  assert.match(marketingSource, /confirmPassword\.setCustomValidity\(/);
  assert.match(marketingSource, /note\.setAttribute\("aria-live", "polite"\)/);
});

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
