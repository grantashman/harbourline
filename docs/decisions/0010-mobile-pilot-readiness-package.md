# Mobile companion pilot readiness package

## Status

**Preparation only — not approved for submission or publication.** This package consolidates the verified mobile baseline and records the release inputs that Grant must approve or supply before a controlled internal/TestFlight/Google Play pilot.

No store account was enrolled, no signing key was used, no binary was submitted, no production deployment was performed, and native billing remains out of scope.

## Verified technical baseline

| Item | Evidence | Status |
| --- | --- | --- |
| Product and operational decisions | ADR 0004; merged PR #57 | Recorded |
| Security/store-readiness boundaries | ADR 0007; merged PR #58 | Recorded |
| PWA/mobile web hardening | Merged PR #59 | Delivered |
| Capacitor POC | Merged PR #60; Capacitor 8.5.0 project under `apps/mobile` | Delivered |
| Native shell hardening | Merged PR #61 | Delivered |
| Web/package verification matrix | ADR 0009; merged PR #62 | Local/CI evidence recorded; device gates open |
| Repository baseline | `feat/combine-tools-menu` at `d02a9d82e865a4c84783554d83b1967d485bf32f` | Verified |

## Release artifact definition

The pilot artifact must be built from the merged `feat/combine-tools-menu` baseline and must satisfy all of the following before distribution:

1. A versioned Android package and iOS archive are produced by the approved CI/build path.
2. The package contains the local reviewed web bundle; `server.url` remains absent.
3. The exact app identifiers are approved and reserved:
   - Capacitor app ID: `app.harbourline.companion`
   - Android application ID: confirm from the final Gradle configuration before signing.
   - iOS bundle identifier: confirm from the final Xcode configuration before signing.
4. The binary version/build number, commit SHA, generated web-bundle hash, and build logs are retained as release evidence.
5. Android and iOS platform verification is run on representative supported devices or simulators.
6. The verification matrix in ADR 0009 has no unresolved critical data-loss, cross-household, auth, privacy, entitlement, or financial-integrity findings.

## Store and account gates

| Gate | Required owner/evidence | Current status |
| --- | --- | --- |
| Apple Developer account | Grant administers the account; legal entity/enrollment type confirmed | Open — entity/enrollment type unresolved |
| Google Play Console account | Grant administers the account; legal entity/enrollment type confirmed | Open — entity/enrollment type unresolved |
| Bundle/application IDs | Grant approves final identifiers and ownership | Open |
| Signing custody | Business-controlled password manager/vault, encrypted recovery copy, protected CI secrets; no keys in Git/worktrees | Approved model; actual setup not verified |
| Android target/minimum API | Pin release-time Capacitor/Android baseline and target API; verify current Play requirement | Open |
| iOS minimum version | Pin release-time iOS/Capacitor baseline | Open |
| Privacy/legal approval | Grant approves privacy disclosures and publication | Open — required before any store submission |
| Privacy policy/support/deletion URLs | Final public URLs and approved wording | Open — current legal documents are drafts |
| Store metadata | Grant owns name, descriptions, screenshots, age rating, privacy/data declarations, reviewer notes | Open |
| Reviewer demo access | Disposable reviewer account or approved demo mode with live backend | Open |
| Crash/error monitoring | Confirm approved provider, redaction, retention, alert owner, and rollback path | Open |
| Support | `grant@ashman.net.au`; one-day pilot response target | Decision recorded; operational rehearsal open |
| Rollback/disablement | Feature-control and release rollback procedure tested | Open |

## Pilot scope and safety controls

- Intended cohort: broad Harbourline cohort across current Harbourline geographies, subject to platform eligibility and controlled tracks.
- Distribution: controlled internal/TestFlight/Google Play tracks only; not unrestricted public publication.
- Product: free companion to the paid web service.
- Billing: no native checkout, StoreKit, Google Play Billing, or purchase CTA in the pilot.
- Financial authority: existing web/domain/sync and server entitlement boundaries remain authoritative.
- Notifications: only contextual, user-requested generic reminders; never amounts, expense descriptions, debt names, household names, account identifiers, or auth material.
- Permissions: least privilege; no contacts, location, camera, microphone, bank, calendar-write, or advertising permissions.
- Rollback: pilot must have a feature-control or distribution disablement path and a documented owner.

## Required pre-submission evidence

### Technical and device

- [ ] Android build compiles and installs on representative small/large phone configurations.
- [ ] iOS archive compiles/signs and installs on representative iPhone/iPad configurations where applicable.
- [ ] Fresh install, offline open, local edit, app kill/restart, upgrade, and reinstall behavior pass.
- [ ] Sign-in, recovery, OAuth/magic-link return, expired/replayed/wrong-account callbacks pass cold and warm start tests.
- [ ] Account switch/sign-out clears or isolates old state, queues, realtime callbacks, and subscription state.
- [ ] Offline queue/reconnect and explicit conflict choice pass across two controlled accounts/devices.
- [ ] Export/share/import cancellation, malformed input, oversized input, and process interruption are safe.
- [ ] Account deletion, MFA, provider cleanup, retry, and post-delete local-data behavior pass in a disposable environment.
- [ ] Notification denial, later enablement, revocation, and generic payload redaction pass.
- [ ] Safe-area, keyboard, orientation, hardware back, accessibility, and screen-reader checks pass.
- [ ] AUD/NZD/USD precision and no-FX-conversion behavior pass in the packaged app.

### Hosted and operational

- [ ] Supabase auth redirects and deployed functions/migrations match the release artifact.
- [ ] AASA and Android asset links are hosted and verified for the approved domains.
- [ ] Monitoring receives only approved redacted events; no financial values or tokens appear.
- [ ] Support, incident, rollback, and disablement rehearsals are recorded.
- [ ] Reviewer account/demo access works against live approved backend services.
- [ ] Final privacy policy, data-safety/privacy declarations, deletion URL, support URL, and store metadata are approved by Grant.

## Decision

**Current readiness: not ready for pilot authorization.**

The package is prepared for the remaining human and platform gates, but the unavailable Android/iOS toolchains and missing hosted/store evidence are release blockers. The next actionable step is to provide or authorize a macOS/Xcode and Android build environment, then execute the device/hosted matrix before any controlled-track submission.
