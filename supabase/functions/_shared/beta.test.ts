import { assertEquals, assertThrows } from "jsr:@std/assert";
import { lifecycleEmailFor, signupNotificationContent } from "./beta-email.ts";
import { parseOperatorEmails, validateBetaEvent, validateClientBetaEvent } from "./beta.ts";
import { isStaleSubscriptionEvent } from "../stripe-subscription-ordering.ts";

Deno.test("validates the fixed customer event allowlist", () => {
  assertEquals(validateBetaEvent("income_added"), "income_added");
  assertEquals(validateBetaEvent("signup_completed"), "signup_completed");
  assertThrows(() => validateBetaEvent("expense_name"));
  assertThrows(() => validateClientBetaEvent("subscription_activated"));
  assertThrows(() => validateClientBetaEvent("signup_completed"));
  assertEquals(validateClientBetaEvent("income_added"), "income_added");
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
  assertEquals(lifecycleEmailFor({ previousStatus: "active", nextStatus: "past_due" })?.kind, "past_due");
});

Deno.test("sends cancellation guidance only after cancellation", () => {
  assertEquals(lifecycleEmailFor({ previousStatus: "active", nextStatus: "canceled" })?.kind, "cancelled");
});

Deno.test("ignores delayed Stripe subscription snapshots", () => {
  const current = {
    status: "active",
    stripe_subscription_id: "sub_new",
    stripe_event_created_at: "2026-08-09T00:00:10.000Z",
    stripe_event_id: "evt_new"
  };
  assertEquals(isStaleSubscriptionEvent(current, "sub_old", "2026-08-09T00:00:10.000Z", "evt_zzz"), true);
  assertEquals(isStaleSubscriptionEvent(current, "sub_new", "2026-08-09T00:00:11.000Z", "evt_latest"), false);
  assertEquals(isStaleSubscriptionEvent(current, "sub_new", "not-a-time", "evt_bad"), true);
});

Deno.test("signup notifications contain only safe account metadata", () => {
  const content = signupNotificationContent({
    signupEmail: "new@example.com",
    provider: "google",
    createdAt: "2026-08-08T17:00:00.000Z"
  });
  assertEquals(content.subject, "New Harbourline account signup");
  assertEquals(content.html.includes("new@example.com"), true);
  assertEquals(content.html.includes("household budget data"), true);
  assertEquals(content.html.includes("<script>"), false);
});
