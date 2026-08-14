import assert from "node:assert/strict";
import test from "node:test";
import {
  attributionMetadata,
  parseMarketingAttribution
} from "./marketing-attribution.ts";

test("keeps only approved campaign fields and the landing path", () => {
  const attribution = parseMarketingAttribution(
    "?utm_source=reddit&utm_medium=community&utm_campaign=early_access_2026_08&utm_content=payday_note_01&utm_term=payday&amount=999",
    "/"
  );

  assert.deepEqual(attribution, {
    source: "reddit",
    medium: "community",
    campaign: "early_access_2026_08",
    content: "payday_note_01",
    term: "payday",
    landingPath: "/"
  });
});

test("rejects empty, oversized, and unsafe attribution values", () => {
  const attribution = parseMarketingAttribution(
    "?utm_source=reddit%20ads&utm_medium=community&utm_campaign=" + "x".repeat(121),
    "/landing"
  );

  assert.deepEqual(attribution, {
    medium: "community",
    landingPath: "/landing"
  });
});

test("serialises attribution under one non-sensitive auth metadata key", () => {
  const attribution = parseMarketingAttribution("?utm_source=search&utm_campaign=payday", "/");

  assert.deepEqual(attributionMetadata(attribution), {
    marketing_attribution: {
      source: "search",
      campaign: "payday",
      landingPath: "/"
    }
  });
});
