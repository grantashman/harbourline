import assert from "node:assert/strict";
import test from "node:test";
import { projectBetaOperations } from "./beta-operations-view.ts";

test("projects privacy-safe beta operations into funnel and daily totals", () => {
  const view = projectBetaOperations({
    daily: [
      { day: "2026-09-08", eventName: "signup", count: 3 },
      { day: "2026-09-08", eventName: "income_added", count: 2 },
      { day: "2026-09-07", eventName: "payday_viewed", count: 1 },
      { day: "2026-09-07", eventName: "support_requested", count: 4 }
    ],
    activeSubscriptions: 2,
    pastDueSubscriptions: 1,
    cancelledSubscriptions: 0
  });
  assert.deepEqual(view.funnel.find((row) => row.eventName === "signup"), {
    eventName: "signup",
    label: "Verified accounts",
    count: 3
  });
  assert.deepEqual(view.funnel.find((row) => row.eventName === "income_added"), {
    eventName: "income_added",
    label: "Added income",
    count: 2
  });
  assert.deepEqual(view.recentDays, [
    { day: "2026-09-08", count: 5 },
    { day: "2026-09-07", count: 5 }
  ]);
  assert.equal(view.activeSubscriptions, 2);
});

test("keeps missing funnel events at zero", () => {
  const view = projectBetaOperations({
    daily: [],
    activeSubscriptions: 0,
    pastDueSubscriptions: 0,
    cancelledSubscriptions: 0
  });
  assert.equal(view.funnel.every((row) => row.count === 0), true);
  assert.deepEqual(view.recentDays, []);
});
