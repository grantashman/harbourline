# Harbourline Capacitor proof of concept

This directory is a minimal Capacitor shell around the existing Harbourline web
application. It is intentionally a companion POC, not a store release.

## Boundary

- `webDir` is `../web/dist`, so native builds package the reviewed Vite output.
- No `server.url` or remote web URL is configured. `cap sync` must be run only
  after `pnpm build:web`.
- `packages/domain` and `packages/sync` remain unchanged and platform-neutral.
- No billing, payment, financial calculation, bank, contacts, location, camera,
  microphone, or calendar-write plugin is included. Local notifications are
  optional and user-triggered only: one generic weekly reminder is scheduled
  after permission is granted, and payloads never contain amounts, expense
  names, household names, or account details.
- The native shell uses Capacitor `App`, `Filesystem`, `Share`, and `StatusBar`
  only for lifecycle/back handling, user-initiated export sharing, and display
  chrome. The web app remains the authority for auth, local state, sync, and
  entitlement checks.

## Native storage origin

A Capacitor WebView has a separate origin from a normal browser. The POC does
not copy browser `localStorage`, IndexedDB, cookies, or Supabase tokens through a
URL. A fresh install therefore starts with the normal Harbourline local-first
experience and its explicit sign-in/device/household copy flow.

## Deep links

The adapter accepts only HTTPS URLs on `harbourline.app` or
`www.harbourline.app`, and only the exact query values used by existing
Harbourline return paths (`account=signin`, `recovery=1`, approved calendar
values, and approved billing return values). The known billing return shape
`billing=...&account=signin` is explicitly accepted; other mixed or duplicate
query combinations fail closed. Auth fragments are never returned by the
parser or written to logs. The native projects declare HTTPS app/universal-link callbacks for the root,
support, and export paths. Auth fragments are forwarded only when their fields
match the Supabase implicit-flow response shape and their query carries a
state-bound pending callback. Hosted association files and device matrix
verification remain release gates.

## Lifecycle and back navigation

On native platforms, app resume dispatches `harbourline:app-lifecycle`, app URL
callbacks are parsed before use, and hardware back closes an open dialog before
history navigation; only an empty history exits the app. Browser behavior is
unchanged because the adapter is a no-op there.

## Export/share

The existing web export/download behavior remains unchanged in a browser. The
native adapter exposes a separate, user-initiated `shareExport` path that writes
the selected blob to the OS cache, invokes the platform share sheet, and cleans
up the temporary file. It does not upload or persist export data as app state.

## Local verification

```text
pnpm --filter @harbourline/mobile typecheck
pnpm --filter @harbourline/mobile test
pnpm --filter @harbourline/mobile build:web
```

`pnpm --filter @harbourline/mobile sync` additionally runs Capacitor asset sync
and requires the local iOS/Android toolchains for native project generation.
This POC has not been submitted to either store. Device, deep-link, auth,
restart, offline queue/reconnect, conflict, export/share and browser-regression
runs remain evidence gates for the follow-on shell-hardening and E2E tasks.

## Third-party SDK and privacy inventory

| Component | Purpose | Mobile boundary |
| --- | --- | --- |
| Capacitor App / Filesystem / Share / StatusBar | lifecycle, user-selected export sharing, display chrome | no analytics; cache exports are cleaned on startup and after sharing |
| Capacitor LocalNotifications | optional generic weekly reminder | permission is requested from an explicit account-panel action; fixed generic payload |
| Supabase JS | auth and RLS-backed sync/account operations | configured Supabase endpoints only; no direct budget-table writes from the client |
| Sentry browser SDK | optional scrubbed error reporting | `monitoring.ts` removes request data, extra/context, breadcrumb messages, and sensitive keys |
| Vercel Analytics | aggregate product events | event names only; no amounts, account IDs, tokens, or household names |
| Vite PWA / Workbox | browser-only offline web updates | omitted from the packaged mobile build |
| Bundled PDF asset | local PDF export | bundled asset; no export upload path |

No native advertising, contacts, location, camera, microphone, calendar-write,
billing, or remote-push SDK is present. Android declares
`POST_NOTIFICATIONS` for the local-notification plugin and remains
deny-by-default until the contextual reminder action; users can later disable
the scheduled reminder in-app or through device settings. Final privacy
declarations and legal approval are release gates.
