import { assertEquals, assertThrows } from "jsr:@std/assert";
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
