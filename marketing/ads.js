(() => {
  "use strict";
  const config = window.HARBOURLINE_ADS_CONFIG;
  const region = document.querySelector("[data-harbourline-ad]");
  if (!region || config?.enabled !== true || config.consentReady !== true
    || !/^ca-pub-\d{16}$/.test(config.publisherId)
    || !/^\d{10}$/.test(config.contentSlotId)) return;

  const appOrigin = "https://harbourline.app";
  let nonce;
  let timeout;
  let scriptLoaded = false;
  let ad = null;
  const frame = document.createElement("iframe");
  frame.src = `${appOrigin}/ad-eligibility.html`;
  frame.hidden = true;
  frame.title = "Account advertising preferences";
  frame.setAttribute("aria-hidden", "true");
  frame.referrerPolicy = "origin";

  function pause(value) {
    (window.adsbygoogle = window.adsbygoogle || []).pauseAdRequests = value ? 1 : 0;
  }
  function apply(next) {
    pause(next !== "free");
    region.hidden = next !== "free";
    if (next !== "free") {
      if (next === "paid") { ad?.remove(); ad = null; }
      return;
    }
    if (!ad) {
      ad = document.createElement("ins");
      ad.className = "adsbygoogle";
      ad.style.display = "block";
      ad.dataset.adClient = config.publisherId;
      ad.dataset.adSlot = config.contentSlotId;
      ad.dataset.adFormat = "auto";
      ad.dataset.fullWidthResponsive = "true";
      region.querySelector("[data-ad-placement]").append(ad);
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
    if (!scriptLoaded) {
      scriptLoaded = true;
      const script = document.createElement("script");
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.publisherId}`;
      script.onerror = () => apply("unknown");
      document.head.append(script);
    }
  }
  function check() {
    nonce = null;
    clearTimeout(timeout);
    apply("unknown");
    // A session on the marketing origin cannot be checked by the apex bridge.
    // Conservatively exclude it, including storage access failures.
    try {
      for (let i = 0; i < localStorage.length; i++) {
        if (/^sb-.+-auth-token$/.test(localStorage.key(i) || "")) return;
      }
    } catch { return; }
    nonce = crypto.randomUUID();
    clearTimeout(timeout);
    timeout = setTimeout(() => { nonce = null; apply("unknown"); }, 8000);
    frame.contentWindow?.postMessage({ type: "harbourline-ad-check", nonce }, appOrigin);
  }
  window.addEventListener("message", (event) => {
    if (event.origin !== appOrigin || event.source !== frame.contentWindow
      || event.data?.type !== "harbourline-ad-status" || !nonce
      || event.data.nonce !== nonce || !["free", "paid", "unknown"].includes(event.data.status)) return;
    clearTimeout(timeout);
    apply(event.data.status);
  });
  frame.addEventListener("load", check);
  frame.addEventListener("error", () => apply("unknown"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
    else { nonce = null; clearTimeout(timeout); apply("unknown"); }
  });
  window.addEventListener("focus", check);
  window.addEventListener("storage", check);
  // Check entitlement updates even when authentication itself has not changed.
  setInterval(() => { if (document.visibilityState === "visible") check(); }, 60000);
  pause(true);
  document.body.append(frame);
})();
