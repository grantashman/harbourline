import assert from "node:assert/strict";
import test from "node:test";
import { getPwaUpdateMessage, getPwaUpdateStatus } from "./pwa-update-policy.ts";

test("PWA updates stay current until the service worker reports a new version", () => {
  assert.equal(getPwaUpdateStatus({ updateAvailable: false, offlineReady: false }), "current");
  assert.equal(getPwaUpdateStatus({ updateAvailable: false, offlineReady: true }), "offline-ready");
});

test("a discovered PWA update is presented for explicit user approval", () => {
  assert.equal(getPwaUpdateStatus({ updateAvailable: true, offlineReady: false }), "update-available");
  assert.equal(getPwaUpdateMessage("update-available"), "A new Harbourline version is ready.");
});

test("offline readiness is informational and does not offer an update action", () => {
  assert.equal(getPwaUpdateMessage("offline-ready"), "Harbourline is ready to use offline.");
  assert.equal(getPwaUpdateMessage("current"), null);
});
