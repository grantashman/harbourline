import test from "node:test";
import assert from "node:assert/strict";
import {
  hasApprovedAuthFragment,
  makeNativeAuthReturnUrl,
  parseMobileAppUrl,
  resolveBackAction
} from "./mobile-platform.ts";

test("accepts only the approved HTTPS auth return and exposes no token value", () => {
  const result = parseMobileAppUrl(
    "https://harbourline.app/?account=signin#access_token=secret&refresh_token=private"
  );

  assert.deepEqual(result, {
    kind: "auth",
    path: "/",
    query: { account: "signin" },
    hasFragment: true
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("rejects remote, malformed, and unsupported app URLs", () => {
  assert.equal(parseMobileAppUrl("https://evil.example/?account=signin"), null);
  assert.equal(parseMobileAppUrl("https://user@harbourline.app/?account=signin"), null);
  assert.equal(parseMobileAppUrl("https://harbourline.app:8443/?account=signin"), null);
  assert.equal(parseMobileAppUrl("https://harbourline.app/unknown"), null);
  assert.equal(parseMobileAppUrl("harbourline://auth/callback"), null);
  assert.equal(parseMobileAppUrl("not a URL"), null);
});

test("classifies supported return intents without trusting arbitrary query values", () => {
  assert.equal(parseMobileAppUrl("https://harbourline.app/?recovery=1")?.kind, "recovery");
  assert.equal(parseMobileAppUrl("https://harbourline.app/?calendar=connected")?.kind, "calendar");
  assert.equal(parseMobileAppUrl("https://harbourline.app/?billing=portal")?.kind, "billing");
  assert.equal(parseMobileAppUrl("https://harbourline.app/support")?.kind, "support");
  assert.equal(parseMobileAppUrl("https://harbourline.app/export")?.kind, "export");
  assert.equal(parseMobileAppUrl("https://harbourline.app/?account=admin"), null);
  assert.equal(parseMobileAppUrl("https://harbourline.app/?billing=https://evil.example"), null);
  assert.equal(parseMobileAppUrl("https://harbourline.app/?billing=success&account=signin")?.kind, "billing");
  assert.equal(parseMobileAppUrl("https://harbourline.app/?account=signin&account=signin"), null);
  assert.equal(parseMobileAppUrl("https://harbourline.app/?billing=success&recovery=1"), null);
  assert.equal(parseMobileAppUrl("https://harbourline.app/?account=signin&calendar=connected"), null);
});

test("resolves native back behavior in priority order", () => {
  assert.equal(resolveBackAction({ dialogOpen: true, canGoBack: true }), "close-dialog");
  assert.equal(resolveBackAction({ dialogOpen: false, canGoBack: true }), "history-back");
  assert.equal(resolveBackAction({ dialogOpen: false, canGoBack: false }), "exit");
});

test("reconstructs a local auth return without serialising a secret fragment", () => {
  const parsed = parseMobileAppUrl("https://harbourline.app/?account=signin")!;
  assert.equal(makeNativeAuthReturnUrl(parsed, "#access_token=secret"), "/?account=signin#access_token=secret");
  assert.deepEqual(parsed.query, { account: "signin" });
});

test("allows only known auth fragment fields without inspecting token values", () => {
  assert.equal(
    hasApprovedAuthFragment(
      "https://harbourline.app/?account=signin#access_token=secret&refresh_token=private&type=magiclink",
      "auth"
    ),
    true
  );
  assert.equal(
    hasApprovedAuthFragment(
      "https://harbourline.app/?recovery=1#error=access_denied&error_code=otp_expired",
      "recovery"
    ),
    true
  );
  assert.equal(
    hasApprovedAuthFragment(
      "https://harbourline.app/?account=signin#access_token=secret&redirect=https%3A%2F%2Fevil.example",
      "auth"
    ),
    false
  );
  assert.equal(
    hasApprovedAuthFragment(
      "https://harbourline.app/?account=signin#access_token=one&access_token=two",
      "auth"
    ),
    false
  );
  assert.equal(
    hasApprovedAuthFragment("https://harbourline.app/?account=signin#access_token=", "auth"),
    false
  );
});