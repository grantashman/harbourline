import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const code = readFileSync("marketing/ads.js", "utf8");
const valid = { enabled: true, consentReady: true, publisherId: "ca-pub-1234567890123456", contentSlotId: "1234567890" };
function setup(config = valid, marketingSession = false) {
  const listeners = {}, scripts = [], frames = [], ads = [], timers = [];
  const region = { hidden: true, querySelector: () => ({ append: ad => ads.push(ad) }) };
  const frame = { contentWindow: { postMessage: message => { frame.request = message; } }, setAttribute() {}, addEventListener: (type, callback) => { frame[type] = callback; } };
  const document = {
    visibilityState: "visible", querySelector: () => region,
    createElement: tag => tag === "iframe" ? frame : { tag, dataset: {}, style: {}, remove() { ads.splice(ads.indexOf(this), 1); } },
    head: { append: node => scripts.push(node) }, body: { append: node => frames.push(node) },
    addEventListener: (type, callback) => { listeners[type] = callback; }
  };
  const window = { HARBOURLINE_ADS_CONFIG: config, addEventListener: (type, callback) => { listeners[type] = callback; } };
  const storage = { length: marketingSession ? 1 : 0, key: () => "sb-project-auth-token" };
  vm.runInNewContext(code, { window, document, localStorage: storage, crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" }, setInterval() {}, setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {} });
  frames[0]?.load();
  function response(status, overrides = {}) {
    listeners.message?.({ origin: "https://harbourline.app", source: frame.contentWindow, data: { type: "harbourline-ad-status", nonce: frame.request?.nonce, status }, ...overrides });
  }
  return { region, scripts, frames, ads, frame, response, listeners, timers, window };
}
for (const config of [{ ...valid, enabled: false }, { ...valid, consentReady: false }, { ...valid, publisherId: "" }, { ...valid, contentSlotId: "" }]) {
  const page = setup(config); assert.equal(page.frames.length, 0); assert.equal(page.scripts.length, 0); assert.equal(page.region.hidden, true);
}
for (const status of ["paid", "unknown"]) {
  const page = setup(); page.response(status); assert.equal(page.scripts.length, 0); assert.equal(page.ads.length, 0); assert.equal(page.region.hidden, true);
}
const invalid = setup();
invalid.response("free", { origin: "https://evil.example" });
invalid.response("free", { source: {} });
invalid.response("free", { data: { type: "harbourline-ad-status", nonce: "stale", status: "free" } });
assert.equal(invalid.scripts.length, 0);
invalid.timers.at(-1)(); invalid.response("free"); assert.equal(invalid.scripts.length, 0, "Timed-out replies must not enable ads");
const free = setup(); free.response("free"); assert.equal(free.scripts.length, 1); assert.equal(free.ads.length, 1); assert.equal(free.region.hidden, false);
free.response("free"); assert.equal(free.scripts.length, 1); assert.equal(free.ads.length, 1);
free.response("paid"); assert.equal(free.region.hidden, true); assert.equal(free.ads.length, 0); assert.equal(free.window.adsbygoogle.pauseAdRequests, 1);
const focus = setup(); focus.response("free"); focus.listeners.focus(); assert.equal(focus.region.hidden, true); assert.equal(focus.window.adsbygoogle.pauseAdRequests, 1);
assert.equal(setup(valid, true).frame.request, undefined, "Marketing-origin sessions are conservatively excluded");
const config = readFileSync("marketing/ads-config.js", "utf8"); assert.match(config, /enabled: false/); assert.match(config, /consentReady: false/);
console.log("Advertising guard passed: disabled config, free, paid, unknown, invalid messages, timeout and upgrade exclusion.");
