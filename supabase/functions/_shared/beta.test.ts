import { assertEquals, assertThrows } from "jsr:@std/assert";
import { lifecycleEmailFor } from "./beta-email.ts";
import { parseOperatorEmails, validateBetaEvent } from "./beta.ts";

Deno.test("validates the fixed customer event allowlist", () => {
  assertEquals(validateBetaEvent("income_added"), "income_added");
  assertThrows(() => validateBetaEvent("expense_name"));
});

Deno.test("matches normalised operator emails", () => {
  assertEquals(parseOperatorEmails(" owner@harbourline.test,ops@harbourline.test "), new Set([
    "owner@harbourline.test",
    "ops@harbourline.test"
  ]));
});

Deno.test("sends welcome only when a subscription first becomes active", () => {
  assertEquals(lifecycleEmailFor({ previousStatus: null, nextStatus: "active" })?.kind, "welcome");
  assertEquals(lifecycleEmailFor({ previousStatus: "incomplete", nextStatus: "active" })?.kind, "welcome");
  assertEquals(lifecycleEmailFor({ previousStatus: "trialing", nextStatus: "active" })?.kind, "welcome");
  assertEquals(lifecycleEmailFor({ previousStatus: "past_due", nextStatus: "active" }), null);
  assertEquals(lifecycleEmailFor({ previousStatus: "active", nextStatus: "active" }), null);
});

Deno.test("sends cancellation guidance only after cancellation", () => {
  assertEquals(lifecycleEmailFor({ previousStatus: "active", nextStatus: "canceled" })?.kind, "cancelled");
});
