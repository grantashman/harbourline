# AdSense activation

Integration is deployed disabled because the publisher account and site approval are not yet available. No Google advertising script or account-status iframe loads while disabled. Use manual display units; leave Auto ads OFF so paid exclusions and placement control apply to every ad.

1. Create/sign in to Google AdSense at https://adsense.google.com/start/ and add www.harbourline.app. Complete Google's account, payment and site review requirements. Site verification can use ads.txt; do not add an unconditional advertising script to the homepage.
2. Get the public publisher ID (ca-pub- followed by 16 digits) and create a responsive display ad unit (10-digit slot ID).
3. Publish marketing/ads.txt with Google's exact account line, e.g. google.com, pub-YOUR_ID, DIRECT, f08c47fec0942fa0. Never ship a placeholder publisher ID. Verify the production root /ads.txt matches the approved account.
4. Configure Privacy & messaging in AdSense, including Google's certified consent solution for EEA, UK and Switzerland and applicable US state privacy settings. Confirm the consent flow in a regional browser and review the public advertising privacy notice against the actual settings. Non-personalised ads can still use cookies; they are not a consent workaround.
5. In marketing/ads-config.js set publisherId, contentSlotId, consentReady:true and enabled:true only after approval and consent setup. Deploy through the normal reviewed release. Do not enable Auto ads in the dashboard.
6. Verify guest/free, paid subscriber, paid household member, failed entitlement check, signed-in marketing-origin session, blocked storage, mobile and consent decline flows. Paid/unknown must never load Google's library on a fresh page. Check pages returning from an upgrade remove ads immediately on visibility/focus refresh. The hidden bridge on the app origin checks the server entitlement, never transfers a token, user ID or budget. Signed-in sessions found only on the marketing origin are conservatively excluded.

Display placements are below homepage/blog content. The planner and the advertising privacy notice have no placements. The account bridge does not boot the planner. Entitlement is rechecked on auth changes, focus/visibility, storage changes and every minute. Requests pause during checks. Paid transitions remove the displayed unit; an already loaded library from a previously free view may remain in memory until reload, with new ad requests paused.

If Google, account status, storage or network access fails, advertising stays hidden. No database migration or privileged API key is needed. Missing configuration leaves all pages clean with no reserved ad gaps.

References: https://support.google.com/adsense/answer/9274634 ; https://support.google.com/adsense/answer/7670312 ; https://support.google.com/adsense/answer/1348695 ; https://support.google.com/adsense/answer/12171612
