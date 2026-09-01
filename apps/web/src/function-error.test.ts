import assert from "node:assert/strict";
import test from "node:test";
import { parseFunctionErrorMessage } from "./function-error.ts";

test("turns a Supabase JSON error body into the user-facing message", () => {
  assert.equal(
    parseFunctionErrorMessage('{"message":"Billing status could not be loaded."}', "Fallback"),
    "Billing status could not be loaded."
  );
});

test("preserves a plain provider error body", () => {
  assert.equal(
    parseFunctionErrorMessage("Stripe billing lookup failed.", "Fallback"),
    "Stripe billing lookup failed."
  );
});

test("uses the fallback when the function response has no usable detail", () => {
  assert.equal(parseFunctionErrorMessage("", "Account details could not be loaded."), "Account details could not be loaded.");
  assert.equal(parseFunctionErrorMessage('{"error":{}}', "Account details could not be loaded."), "Account details could not be loaded.");
});
