# Mobile verification matrix and release recommendation

## Status

Verification evidence for the Capacitor companion baseline after PRs #60 and #61. This document records what was verified on the available Linux host and what remains unverified. It is not device, store, hosted-auth, signing, or publication evidence.

## Baseline

- Repository: Harbourline monorepo
- Base branch: `feat/combine-tools-menu`
- Verified base: `9f224a95d09324fce0e0c18c4c6e1ed0f1a93389`
- Verification worktree: `wt/mobile-e2e`
- Native app boundary: `apps/mobile`, Capacitor `8.5.0`
- Host: Linux; Node `v22.23.2`; pnpm `11.9.0`
- Missing host tools: Java, Xcode/xcodebuild, Android SDK/ADB/emulator, CocoaPods

## Evidence classification

- **PASS** means the exact local command or static check passed.
- **PARTIAL** means deterministic source/build evidence exists, but device, hosted, or platform evidence is still required.
- **UNAVAILABLE** means the current host or account access cannot execute the scenario.
- **RELEASE BLOCKER** means the evidence gap or defect must be resolved before a controlled pilot.

## Matrix

| Scenario | Result | Evidence and limitation |
| --- | --- | --- |
| Fresh bundled web build | PASS | `pnpm --filter @harbourline/mobile build:web` passed; generated bundle contains the native bootstrap and no browser PWA manifest/service worker. |
| Browser regression build | PASS | `pnpm --filter @harbourline/web build` passed; manifest and Workbox service worker were generated, `mobile-bootstrap.js` was absent, and `node apps/web/scripts/verify-browser-web-build.mjs` passed. |
| Capacitor asset sync | PASS | `pnpm --filter @harbourline/mobile sync` passed; Android and iOS web assets/config were copied and five Capacitor plugins were registered. |
| Capacitor dependency/Android static doctor | PARTIAL | `cap doctor` reports Android “looking great”; command exits non-zero because Xcode is not installed. |
| Native Android compile | UNAVAILABLE / RELEASE BLOCKER | Java and Android SDK/ADB are not installed on this host; no Gradle APK compile or emulator run was claimed. |
| Native iOS compile/signing | UNAVAILABLE / RELEASE BLOCKER | Xcode is not installed; no simulator, signing, or device run was claimed. |
| Auth/deep-link parser | PASS locally, PARTIAL overall | Seven native tests pass, including HTTPS allowlisting, malformed/remote rejection, approved return intents, fragment redaction, and no token serialization. Real cold/warm callbacks, hosted redirects, replay on device, and wrong-account behavior remain unverified. |
| Native back/lifecycle behavior | PASS locally, PARTIAL overall | Native adapter test covers back priority; source wires lifecycle and URL-open callbacks. Device hardware-back, dialog, keyboard, safe-area, and restart behavior remain unverified. |
| Offline local edit/restart | UNAVAILABLE / RELEASE BLOCKER | No Android/iOS binary or device is available. Existing web/domain/sync tests pass but do not prove WebView persistence after process termination. |
| Offline queue/reconnect | PARTIAL / RELEASE BLOCKER | Shared sync tests pass for queue compaction and conflict decisions; native kill/reconnect and hosted RLS/revision behavior remain unverified. |
| Explicit conflict handling | PARTIAL / RELEASE BLOCKER | Domain/sync tests pass for deliberate conflict choice; no packaged-app or hosted multi-device conflict run was possible. |
| Account switch/sign-out | PARTIAL / RELEASE BLOCKER | Auth callback/state and web auth tests pass; native process-restart, stale queue, realtime cleanup, and wrong-account device run remain unverified. |
| Export/share/import | PARTIAL / RELEASE BLOCKER | Browser fallback and native share path are source-reviewed; Android FileProvider exposes only `cache/exports/`; native share-sheet success/cancel/error and malformed/oversized import runs remain unverified. |
| Account deletion | PARTIAL / RELEASE BLOCKER | Existing repository checks pass; no hosted deletion, MFA, provider-cleanup, post-delete local-cache, or device run was performed. |
| Notifications | PARTIAL / RELEASE BLOCKER | Generic copy test passes and permissions are declared; denial, later enablement, revocation, scheduling, and device payload inspection remain unverified. |
| Safe-area/keyboard/accessibility | UNAVAILABLE / RELEASE BLOCKER | Source/configuration is present; no iOS/Android device, screen-reader, keyboard, orientation, or hardware-back evidence is available. |
| Upgrade compatibility | UNAVAILABLE / RELEASE BLOCKER | No installable old/new binaries or device storage migration run is available. |
| Currency precision / no FX conversion | PARTIAL / RELEASE BLOCKER | Full repository money/currency tests pass, including AUD defaults, custom-currency validation, exact minor units, recurring conversion, backup round trips, and rejection of invalid currency metadata. Mobile packaged UI and hosted cross-device currency runs remain unverified. |
| Telemetry redaction | PASS static/source, PARTIAL overall | Source inventory and static search found no native secret/financial logging path; Sentry/analytics hosted delivery and production configuration remain unverified. |
| Store-review demo access | UNAVAILABLE / RELEASE BLOCKER | No Apple/Google accounts, reviewer binary, signing, TestFlight, Play internal track, privacy/legal approval, or store metadata submission was used. |

## Commands and results

Passed:

```text
pnpm --filter @harbourline/mobile typecheck
pnpm --filter @harbourline/mobile test                 # 7 passed
pnpm --filter @harbourline/mobile build:web
pnpm --filter @harbourline/mobile sync
pnpm --filter @harbourline/web build
node apps/web/scripts/verify-browser-web-build.mjs
pnpm run check                                         # full repository check passed
```

The full repository check included workspace typechecks, web/domain/sync tests, database/schema guards, multi-currency production guards, all workspace builds, browser PWA generation, and PDF verification.

Static checks passed:

- `webDir` is `../web/dist` and no remote `server.url` is configured.
- Android app links use HTTPS and the declared Harbourline hosts/paths.
- iOS associated domains declare the Harbourline hosts.
- Android FileProvider scope is limited to the `exports/` cache directory.
- Notification disclosure text is present and generic.
- No broad cache provider path or native secret logging pattern was found in the reviewed native files.

Known limitations:

- `cap doctor` exits non-zero only because Xcode is unavailable; its Android check reports healthy.
- Android Java/SDK and iOS Xcode/device tooling are unavailable.
- Hosted Supabase, OAuth, billing entitlement, Google Calendar, analytics/Sentry, AASA/assetlinks, store accounts, signing, TestFlight, and Play Console were not accessed.

## Release recommendation

**Recommendation: do not authorize the controlled mobile pilot yet.**

The web/native packaging boundary and local security-sensitive contracts are in good shape, but the verification matrix has critical evidence gaps. The next required evidence is an installable Android and iOS build tested on representative devices/simulators, followed by hosted auth/sync/deletion/notification/export checks and an independent pilot-readiness review. No billing decision should advance from this matrix; native billing remains deferred.
