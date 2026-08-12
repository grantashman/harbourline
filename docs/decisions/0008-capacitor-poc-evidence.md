# Capacitor POC evidence and limits

Status: Phase 2 proof of concept only. This artifact records local repository
verification; it is not device, hosted-auth, TestFlight, Google Play, or store
approval evidence.

## Implemented

| Boundary | POC implementation | Evidence |
| --- | --- | --- |
| Packaged assets | `apps/mobile/capacitor.config.ts` points `webDir` to `../web/dist` and does not configure `server.url`. | `pnpm --filter @harbourline/mobile build:web` passed; `apps/web/dist/index.html` references the generated `assets/mobile-bootstrap.js` and `assets/release2.js` entries. |
| Native adapter | `apps/mobile/src/mobile-platform.ts` uses App lifecycle/deep-link/back events, StatusBar styling, Filesystem cache, and Share. | `pnpm --filter @harbourline/mobile typecheck` passed. |
| Browser fallback | The adapter no-ops outside a native Capacitor platform. Account JSON export uses the native share path when present and falls back to the existing browser download. | `apps/web/src/account-panel.ts`, `apps/web/src/release2-types.ts`. |
| Deep-link boundary | HTTPS host/path/query allowlist; malformed, unsupported, remote, duplicate, and extra query values fail closed. Existing billing return combinations are accepted. Auth fragments are not included in parsed output, short-lived callback state is consumed once, and the local Supabase session handoff is disabled until the account panel validates the callback. | 8 focused adapter tests plus callback-state and browser callback-policy tests pass, including expiry, mismatch, replay, and billing/account combinations. |
| Back navigation | Native dialog close precedes history back; only an empty history requests app exit. | Focused adapter test passes. |
| Storage boundary | No browser storage or token migration code exists in `apps/mobile`; web/domain/sync code remains the authority. | Repository inspection; no changes under `packages/domain` or `packages/sync`. |
| Product boundary | No native billing or financial calculation code is added. Billing UI in the companion is web-only and does not expose checkout; the native shell includes only lifecycle, local export/share, status-bar, and opt-in local notifications. | `apps/mobile/package.json`, Android manifest, iOS project, and account-panel inspection. |

## Commands run

- `pnpm install --lockfile-only` — passed; lockfile updated for the new mobile workspace dependencies.
- `pnpm install` — passed; Capacitor packages installed.
- `pnpm --filter @harbourline/mobile typecheck` — passed.
- `pnpm --filter @harbourline/mobile test` — passed: 8 tests.
- `pnpm --filter @harbourline/mobile build:web` — passed: Vite production build, native bootstrap bundle, and mobile web-build guard.
- `pnpm --filter @harbourline/web build` — passed: browser production build, PWA generation, and browser web-build guard; the native bootstrap is absent.
- `pnpm --filter @harbourline/mobile exec cap doctor` — Android checks passed; the command exits non-zero because Xcode is not installed on this Linux host.
- `pnpm --filter @harbourline/mobile exec cap add android` and `cap add ios` — passed; generated native projects are staged.
- `pnpm --filter @harbourline/mobile sync` — previously passed for local generation; the current host still cannot compile Android or iOS because Java and Xcode are unavailable.
- `pnpm check` — passed: repository checks.

## Not verified in this worktree

- Fresh offline launch from an installed iOS/Android binary.
- Real-device sign-in, OAuth/magic-link/password-recovery callback, expired/replayed/wrong-account deep links.
- App kill/restart persistence, native WebView storage isolation, offline queue/reconnect, or conflict recovery on devices.
- Native share sheets and cancellation behavior.
- Android Gradle compilation (the host has no Java runtime) or iOS compilation/signing, compatibility matrix, privacy review, notification permission flows, or store policy review.
- Hosted Supabase, Stripe, Google Calendar, or production redirect configuration.

The Android intent filter is limited to the root, support, and export paths;
iOS associated-domain path scoping still requires hosted AASA components for the
same paths. The native callback forwards only a validated Supabase auth/error
fragment; token values are never parsed into diagnostics.

Hosted association files, platform builds, and device verification remain
release gates. A later E2E card must run the device matrix before any pilot or
store claim.
