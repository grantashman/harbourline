# ADR 0007: Mobile security and store-readiness boundaries

## Status

Accepted as a release gate for the planned free companion shell. [unverified] This document is an audit and decision record; it does not create a native project, add permissions, or claim store readiness. [unverified]

## Decision summary

Harbourline will keep the PWA and shared web/domain/sync implementation as the source of truth. [unverified] A later Capacitor shell may package the compiled web assets, but the shell must use a local signed asset bundle rather than silently loading the hosted app. [unverified] The native webview is a separate storage origin: the first launch must never imply that browser storage, auth state, IndexedDB queues, or budget data are already present. [unverified]

The first native release remains a free companion to the paid web service. [unverified] It may expose local planning, authenticated access to existing entitlements, household sync, export, sign-out, deletion, and support. [unverified] It must not expose checkout, upgrade, subscribe, payment-management, or other purchase calls to action until a separate Apple/Google billing and entitlement decision is approved. [unverified] Apple’s current guideline describes a free companion exception only when there is no purchasing inside the app or call to action for purchase outside it.[1]

## Repository baseline and evidence boundary

Audit baseline: worktree branch `wt/mobile-security-audit`, commit `36cd64ae2def8172804f9f32139ad3ac01128e3a`, clean at inspection start. [unverified] The repository currently has no tracked `apps/mobile`, Capacitor, iOS, Android, native push, or native secure-storage project. [unverified] The existing product is a root `index.html` planner with a Vite/PWA wrapper in `apps/web`. [unverified]

Local inspection establishes implementation intent and current code paths. [unverified] It does not establish deployed service configuration, app-signing ownership, Apple/Google account access, TestFlight/Play approval, or production store readiness. [unverified] Current policy sources were fetched on 12 August 2026; Apple and Google requirements must be rechecked at each submission. [unverified]

## Current data and trust boundaries

| Boundary | Current evidence | Mobile requirement / gate |
| --- | --- | --- |
| Planner state | `index.html:4678-4683, 5306-5408` stores versioned state in `localStorage`, with a user-scoped key and legacy-key migration. [unverified] | Treat the native origin as empty and independent. Offer explicit first-run choice: new local budget, restore a user-selected backup, or sign in and choose device/household copy. Do not copy storage or tokens through URLs. |
| Sync metadata and queue | `apps/web/src/local-sync-store.ts:4-13, 209-228, 332-445` uses IndexedDB for metadata, mutations, and cleanup latches; `sync-controller.ts:131-220, 320-365, 391-504` gates owner/household, revision, hash, queue flush, and conflict handling. [unverified] | Test cold start, app kill, reconnect, account switch, cleanup failure, and stale queue on both platforms. Native secure storage may hold only the minimum platform registration/configuration data; it must not bypass Supabase session rules. |
| Auth/session | `apps/web/src/cloud.ts:118-135, 144-199` uses Supabase `persistSession`, `autoRefreshToken`, URL detection and implicit OAuth flow; `account-panel.ts:489-545` resets sync and changes the user storage scope on account transitions. [unverified] | Define and test universal links/app links for sign-in, magic link, password recovery, and OAuth. Reject malformed, expired, replayed, wrong-account, and cold/warm-start returns. Never treat a web redirect as entitlement authority. Reassess implicit URL-fragment session handling for the native shell before implementation; do not carry tokens in query strings or custom URLs. |
| Entitlement | `account-panel.ts:721-840` reconciles server-side subscription status before enabling cloud access; `docs/decisions/0003-subscription-entitlements.md:27-29` makes the webhook authoritative. [unverified] | Companion shell may read existing entitlement only. No native billing in Phase 1. If billing is later added, use a provider-neutral server ledger and server verification/replay tests; the client cannot be the premium-access authority. Google’s billing guidance calls for a secure backend for purchase verification and its integration flow requires server verification and acknowledgement.[3][4] |
| RLS/revision | `supabase/migrations/20260811000000_multi_currency_budget_invariants.sql:319-423` verifies canonical JSON hash, revision, household currency and exact-money invariants in `sync_budget`; `supabase/tests/database/release_2_rls.test.sql` and `multi_currency_invariants.test.sql` cover isolation and invariants. [unverified] | Re-run database policy/invariant tests against the release candidate and add mobile scenarios: wrong-account link, stale queue, competing edits, unauthorized household, malformed state, mismatched currency, app termination during flush. No native client may write budget tables directly. |
| Export/import | Account export is authenticated by `supabase/migrations/20260809033000_require_verified_account_exports.sql:1-49`; local backup and restore are implemented in `index.html:7611-7623, 9486-9508`; account export downloads JSON at `account-panel.ts:1811-1815`. [unverified] | Keep file selection and share/export user initiated. Test cancellation, malformed/oversized files, wrong currency, legacy backups, partial reads, and app-kill during export. Do not place budget contents in URLs, logs, analytics, crash attachments, or store screenshots. |
| Account deletion | UI confirms exact text and invokes `delete-account` at `account-panel.ts:1816-1831`; the function requires verified auth, MFA assurance when configured, blocks owned households, cancels active Stripe subscriptions, revokes Google access, then deletes the auth user (`supabase/functions/delete-account/index.ts:44-141`). [unverified] | Keep deletion in-app. Test ownership transfer, subscription cancellation failure, Google revocation failure, MFA required, retry/idempotency, local cache/queue explanation, and post-delete sign-in. Apple requires account deletion in-app when account creation is supported.[1] |
| Calendar OAuth | `google-calendar-start/index.ts:21-38` creates random state/PKCE, stores a short-lived hash/verifier; callback deletes the state before code exchange and `google-calendar.ts:87-110` encrypts refresh tokens with AES-GCM. `calendar-sync.ts:62-86, 100-129` defaults to generic event text and only opts into expense names. [unverified] | Native deep-link callback must not bypass state/PKCE or server-side ownership. Test state replay, expired state, wrong user, callback cancellation, revocation, and no sensitive notification/event text. Keep Calendar as optional; do not add native Calendar write permission in the first shell. |
| Monitoring/third parties | `apps/web/src/release2.ts:1-9` imports `@vercel/analytics` and calls `inject()`; `apps/web/src/monitoring.ts:1-60` initializes Sentry with a scrubber; `apps/web/package.json:12-23` inventories Supabase JS, Sentry, Vercel Analytics, Vite PWA and PDF vendor code. [unverified] | Produce a native SDK and privacy-manifest inventory before submission. Verify that analytics, Sentry, Supabase, WebView, PDF, and any future native plugins do not receive budget values or auth tokens. Apple requires App Store privacy details covering integrated third-party partners.[2] |
| Service worker/cache | `apps/web/vite.config.ts:67-99` enables `vite-plugin-pwa` `autoUpdate` and Workbox precaching; the shell target is not yet implemented. [unverified] | Decide deliberately whether the packaged build registers a service worker. Test binary updates versus Workbox caches, interrupted updates, offline edits, queued mutations, and stale auth assets. Do not allow a remote web build or post-review executable code download. Apple requires app behavior to remain self-contained in the bundle.[1] |
| Browser headers | `vercel.json:8-25` sets CSP, `frame-ancestors`, `Permissions-Policy` disabling camera/location/microphone, and restricted `connect-src`. [unverified] | Native transport/origin configuration must preserve HTTPS, least-privilege permissions, and an explicit allowlist. Recheck CSP for the packaged origin without widening it to accommodate plugins. |

## Concrete Phase 1 defects and implementation requirements

These are release-blocking requirements for a mobile shell, not claims that an existing native implementation is broken: [unverified]

1. **No native project or first-run boundary exists.** [unverified] Add a design/test seam before creating iOS/Android projects: detect the native origin, show the explicit copy choice, and prove that no browser localStorage/IndexedDB/session is assumed. [unverified]
2. **Deep-link/session contract is web-only.** [unverified] The current auth redirect uses `location.origin` and URL detection in `cloud.ts:162-185`, while Calendar returns through an allowlisted HTTPS web path. [unverified] Define per-platform universal/app links and parsers with failure-closed tests before wiring password recovery, magic links, Google auth, Calendar, export/share, or support. [unverified]
3. **Analytics and error-SDK behavior is not yet native-inventory evidence.** [unverified] `inject()` and Sentry are present in the web wrapper, but no consent/data-retention/store declaration mapping or native plugin inventory is checked in. [unverified] Establish an owner-reviewed data map and test redaction against representative errors before adding native SDKs. [unverified]
4. **Service-worker/native-cache policy is undecided.** [unverified] `autoUpdate` is appropriate for the PWA but can create a second cache/update authority in a signed binary. [unverified] Choose packaged-mode behavior and add upgrade/rollback tests before submission. [unverified]
5. **Native session storage is not designed yet.** [unverified] `cloud.ts:118-135` enables Supabase `persistSession` in the browser client, so a native shell must explicitly decide whether its session storage is an approved protected WebView store or use a reviewed secure-storage adapter. [unverified] Do not describe native auth as platform-secure until this boundary has been implemented and tested for lock-screen/device-compromise assumptions. [unverified]
6. **Account export/deletion are implemented but mobile evidence is absent.** [unverified] Existing code is a good server-side boundary, but no real-device evidence covers share cancellation, app termination, post-delete local data semantics, or provider-cleanup failure. [unverified] These remain release blockers. [unverified] The promised “complete account copy” also needs a field-level contract: the current `export_my_account()` payload contains profile/onboarding/households/budgets but does not visibly include the Auth email, billing record, Calendar connection state, or operational events; document those exclusions or expand the export before calling it complete. [unverified]
7. **The existing UI still contains web purchase paths.** `account-panel.ts:1446-1456, 1694-1712` renders Checkout/portal actions for web. The companion build must compile a mobile policy gate that removes purchase CTAs and external purchase redirects, rather than relying on store review or a hidden URL convention.
8. **Google login creates an iOS policy decision.** The web sign-in surface includes Google (`account-panel.ts:1156-1164, 1672-1674`). Apple’s rule for third-party/social login requires an equivalent privacy-preserving login option unless an exception applies.[1] Before iOS submission, either implement the required equivalent option, remove the social-login path in the iOS shell, or obtain documented legal/policy approval for an applicable exception.
9. **Push is not implemented and is out of scope for the first shell.** [unverified] There are no native notification files or permissions. [unverified] If later added, use generic, non-financial payloads, contextual permission requests, Android notification channels and `POST_NOTIFICATIONS` handling; do not put amounts, descriptions, debt names, or household names in payloads. [unverified] Android documents the channel requirement.[6]
10. **Store metadata/legal is not final.** `docs/legal/PRIVACY_POLICY_DRAFT.md:1-5, 41-75` remains a draft with missing entity/contact/effective-date fields; `docs/SECURITY.md:101-110` requires privacy notice alignment, deletion verification, dependency/secret scans, backup rehearsal, and incident ownership. No store submission can be called ready until those artifacts are approved and match actual SDK/data flows.

## Explicit first-shell scope and permissions

### In scope

- Signed local web assets using the shared planner/domain/sync code.
- Account sign-in and recovery after a reviewed deep-link contract.
- Existing web entitlement read state; local starter; household sync, explicit copy choice, offline queue and conflict choice.
- User-selected JSON/CSV/XLSX/PDF export/share where supported.
- In-app account export, deletion, sign-out, support and existing calendar disconnect.
- Native back behavior, safe-area/keyboard/accessibility handling, app lifecycle and offline status.

### Explicitly out of scope / permission deny-by-default

- Native billing, StoreKit, Google Play Billing, checkout, upgrade/subscribe/manage-payment CTAs.
- Bank, contacts, location, camera, microphone, health, Bluetooth, calendar-write, photo-library, advertising-ID, background financial calculation, widgets, Live Activities, watch apps, and executable code downloads.
- Reading browser-origin storage or migrating raw Supabase tokens through a URL.
- Notifications until a product need, payload redaction, provider, permission UX, and privacy/store review are approved. [unverified] If notifications are later accepted, Android 13+ requires `POST_NOTIFICATIONS`; channels are required for user control.[6]

Capacitor’s Android documentation supports Android API 24+ and Android Studio management.[7] That compatibility floor is not the Play submission target. [unverified] Google Play’s current policy states that from 31 August 2026 new apps and updates must target Android 16/API 36 or higher.[5]

## Release-blocking checklist

A reviewer must mark each item with evidence ID/date; “source inspection” is not a substitute for a device, hosted, or store-track result.

### Architecture and origin

- [ ] Native shell packages the reviewed local build; no remote production URL or post-review executable code path.
- [ ] First-run copy choice is visible and tested for fresh install, reinstall, upgrade, and web-to-native transition.
- [ ] Browser localStorage, IndexedDB, cookies, auth fragments, and native secure storage are proven separate and correctly scoped.
- [ ] Service-worker registration/cache policy is documented and upgrade-tested.

### Auth, deep links, and account boundaries

- [ ] Password, magic-link, recovery, Google/OAuth, Calendar, export/share and support links use a documented universal/app-link allowlist.
- [ ] Cold start, warm start, expired, malformed, replayed, wrong-account and cancelled links fail closed.
- [ ] Sign-out/account switching blocks stale queues and old-state uploads after app kill and restart.
- [ ] Account deletion is in-app, MFA-aware, provider-cleanup-aware, retry-safe, and its local cache semantics are explained.
- [ ] Existing RLS, exact-money, revision/hash, conflict and entitlement tests pass against the release schema.

### Data, privacy, and SDK inventory

- [ ] Data-flow map covers local state, IndexedDB, Supabase, Stripe identifiers, Google Calendar, Sentry, Vercel Analytics, WebView/PWA and every native plugin.
- [ ] No financial values or auth tokens appear in telemetry, URLs, push payloads, crash attachments, support templates, logs, screenshots or reviewer credentials.
- [ ] Apple privacy details, privacy manifests/SDK declarations where applicable, Google Data Safety form and public privacy policy match the data-flow map.
- [ ] Privacy policy is legally approved and has final entity, contact, retention, deletion, residency and provider wording.
- [ ] Permissions remain deny-by-default and each future permission has a product/security/store rationale.

### Device and store operations

- [ ] TestFlight and Play internal-track binaries run offline, under poor network, after upgrade, after kill/restart, on representative small/large phones, with keyboard/accessibility checks.
- [ ] Apple review account/demo mode and live backend are available; review notes explain local-first/offline, auth, sync, export and deletion. Apple asks developers to include demo account information when an app includes login and keep backend services live.[1]
- [ ] Android target API is compliant at submission time; for submissions from 31 August 2026 this means API 36+ for new apps/updates.[5]
- [ ] Signing ownership, bundle/application IDs, support URL, privacy URL, age rating, screenshots, rollback and incident owner are documented.
- [ ] No “store ready” decision is recorded until all applicable rows have evidence and unresolved critical/high defects are zero.

## Required test matrix before native creation is accepted

| Scenario | Expected evidence |
| --- | --- |
| Fresh install offline | Planner opens from bundled assets; no fabricated account data; first-run choice is explicit. |
| Existing web user | Sign-in returns to the intended native origin and only the selected account/household becomes active. |
| Local edit | Edit survives app kill/restart; no data loss at keyboard/back transitions. |
| Offline sync | Queue persists, flushes once, and keeps the owner/household/revision/hash contract. |
| Conflict | Competing revisions remain an explicit choice; no silent last-write-wins. |
| Account switch | Old local state, metadata, cleanup latch, subscription/realtime callback and queue cannot act as new user. |
| Export/import | User cancellation, malformed input, wrong currency, legacy format, oversized file and share cancellation are safe. |
| Deletion | MFA and ownership gates work; Stripe/Google cleanup failure fails closed; post-delete local/export behavior is clear. |
| Notifications (if later approved) | Denial, later enablement, revocation and generic payload redaction; no financial data. |
| Upgrade | Old binary to new binary preserves or explicitly migrates compatible local state and queue. |
| Review | Demo account/backend and privacy/support URLs work in the submitted binary. |

## External gates and ownership

The following cannot be proven from this worktree and must be assigned before a store pilot: [unverified]

- Apple Developer Program/App Store Connect ownership, bundle ID, signing certificates, TestFlight reviewer account, privacy declarations and legal approval.
- Google Play Console ownership, application ID, signing key, target API/build toolchain, Data Safety declarations and internal-track reviewers.
- Supabase/Vercel production variables and deployed migrations/functions, including auth redirect allowlists, cleanup secrets, Sentry configuration, backups/restore, and incident access.
- Google OAuth client redirect allowlists and token-encryption key separation between environments.
- Final privacy policy/legal entity/contact/residency/retention wording and customer support/incident owner.

Until those gates are verified, status is **not store-ready**; the appropriate status is **web-first / native design-gated**. [unverified]

## Sources

[1] https://developer.apple.com/app-store/review/guidelines
[2] https://developer.apple.com/app-store/app-privacy-details
[3] https://developer.android.com/google/play/billing
[4] https://developer.android.com/google/play/billing/integrate
[5] https://support.google.com/googleplay/android-developer/answer/11926878?hl=en
[6] https://developer.android.com/develop/ui/views/notifications/time-sensitive
[7] https://capacitorjs.com/docs/android
