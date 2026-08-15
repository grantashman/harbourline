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
