# ADR 0004: Mobile product, store and operational gates

## Status

Accepted for the first mobile companion pilot. This decision resolves the
product and operating scope; it does not authorize native billing, public store
release, or publication before the readiness gates below are complete.

## Decision owner

Grant is the accountable product and release owner for this decision. Ajax may
prepare artifacts and readiness checks, but cannot approve publication, legal
text, account enrollment, or release on Grant's behalf.

## User problem and target cohort

The first mobile release removes the portability and mobility barrier of a
web-only Harbourline experience. It should give users a quick, secure way to
check their finances and record expenses, payments, and related financial
updates while mobile.

The target cohort is Harbourline's existing broad mission cohort, not a new
niche segment. The pilot is intended for all current Harbourline geographies and
the broad Harbourline user cohort, subject to platform eligibility and the
controlled distribution mechanisms described below.

## Commercial scope

The first mobile release is a free companion to the paid Harbourline web
service. It does not add:

- in-app purchase;
- native mobile checkout;
- a second mobile-only subscription; or
- a new entitlement or pricing model.

The app may provide the approved Harbourline planning and account experience,
but native billing remains out of scope. Mobile checkout may be reconsidered
only after pilot evidence demonstrates user demand, supportability, and a
separately approved commercial and store-policy design.

This is consistent with the existing product boundary that excludes native
app-store billing from the first paid release (`docs/PRODUCT.md`).

## Device and platform support

The pilot supports all device classes officially supported by the selected
iOS, Android, and Capacitor baselines at release. The product will not
intentionally narrow the cohort to selected phone models or exclude tablets
when they are supported by those baselines.

The exact minimum iOS version, Android API/minimum version, Capacitor version,
and any device-specific exclusions are release-time compatibility inputs. They
must be pinned during implementation and recorded in the store-readiness
verification before binaries are distributed. No unsupported version is
implied by this ADR.

## Notification scope

Native push reminders are in scope for the first mobile shell, subject to
permission and privacy review. Notifications must be:

- user-requested or enabled through a contextual opt-in;
- least-privilege, with the minimum platform permission needed;
- revocable through the product and platform controls; and
- generic and non-sensitive in their payload and visible text.

Push payloads must never contain financial amounts, expense or payment
descriptions, account details, or other confidential household data. Unrequested
marketing notifications and sensitive financial alerts are out of scope for
this pilot.

## Store-policy and distribution position

The initial store position is a free companion app with no native purchase flow.
The app must not present an in-app mobile checkout or attempt to bypass a
platform purchase requirement for a future digital entitlement. Before either
app is published, the current Apple and Google policies must be reviewed
against the actual sign-in, paid-web-service access, notification, privacy, and
metadata behavior. The approved policy classification and reviewer notes must
be recorded in the store-readiness checklist.

Operationally, use controlled internal/TestFlight and Google Play testing
tracks plus feature controls for the pilot. Broad intended cohort access does
not mean immediate public listing or unrestricted production publication.

Native billing, mobile checkout, and any change to entitlement behavior require
a new commercial and store-policy decision; they are not implied by this ADR.

## Account ownership and enrollment

Grant will hold and administer both the Apple Developer account and the Google
Play account.

The legal entity name and Apple/Google enrollment type are currently unknown.
They are explicit pre-enrollment gates. No entity, organization enrollment,
individual enrollment, or account configuration may be inferred from this ADR.
Ajax will help determine the appropriate entity and enrollment path during
readiness, with Grant making the final decision.

## Signing-key custody

Grant is the accountable owner for release credentials and signing-key
recovery. Apple distribution credentials, certificates, and profiles, together
with the Android signing/upload keystore, must be stored in a
Harbourline business-controlled password manager or secret vault. They must
never be stored in Git, a Kanban worktree, or an unmanaged laptop.

The release process must also maintain:

- an offline encrypted recovery copy;
- a documented recovery procedure;
- protected, least-privilege CI secrets; and
- separate Apple and Android release credentials.

Creating or enrolling credentials remains an implementation/readiness task; the
custody decision itself is approved here.

## Privacy, legal, metadata, and support ownership

| Responsibility | Owner | Required boundary |
| --- | --- | --- |
| Privacy and legal approval | Grant | Approve the privacy/legal package before either app is published. Draft documents remain drafts until approved. |
| Store metadata | Grant | Own descriptions, screenshots, privacy disclosures, reviewer notes, and submission answers. |
| First-line mobile support | Grant | Monitor `grant@ashman.net.au` and target a one-day response for pilot users. |
| Product and release approval | Grant | Approve pilot opening, public listing, and any scope change. |
| Readiness preparation | Ajax | Prepare decision records, checklists, and evidence; no independent publication or approval authority. |

The mobile privacy and legal package must account for account access, local
browser/device data, cloud sync, notifications, platform disclosures, and the
existing draft status of `docs/legal/PRIVACY_POLICY_DRAFT.md` and
`docs/legal/TERMS_OF_SERVICE_DRAFT.md`.

## Explicit in-scope behavior

For the first mobile companion pilot:

- secure sign-in to the existing Harbourline account experience;
- checking the user's permitted financial planning data;
- adding expenses, payments, and related financial updates through approved
  Harbourline flows;
- the existing free-versus-paid web entitlement model, without a new mobile
  entitlement;
- supported phone and tablet device classes covered by the pinned platform
  baselines;
- user-controlled, generic push reminders; and
- controlled internal/TestFlight/Google Play pilot distribution with feature
  controls.

## Explicit out-of-scope behavior

The first pilot does not include:

- native app-store billing or mobile checkout;
- a mobile-only price, subscription, or entitlement model;
- financial product recommendations, bank credential collection, or custody or
  movement of customer money;
- sensitive financial data in notification payloads;
- unapproved marketing push notifications;
- automatic public store publication; or
- an inferred legal entity, enrollment type, platform minimum, or device
  compatibility promise.

## Release and operational gates

The product/operational decision gate is resolved by this ADR. Implementation
and publication remain blocked until the following evidence is recorded:

1. Grant selects and approves the legal entity and Apple/Google enrollment type
   before account enrollment.
2. The implementation pins the iOS, Android API, Capacitor, and supported-device
   compatibility matrix.
3. Grant approves the final privacy/legal text and platform privacy
   disclosures; the current drafts are not publishable.
4. Grant approves store descriptions, screenshots, metadata, and reviewer
   notes.
5. Signing credentials are created or migrated into the approved vault with
   recovery evidence and protected CI configuration; no secret values belong in
   repository artifacts.
6. Notification permission, opt-in, revocation, generic-payload, and
   least-privilege behavior is tested on each platform.
7. Apple and Google policy review confirms the free-companion/sign-in/access
   behavior for the actual build, and the result is recorded.
8. Pilot support and incident handling are rehearsed, including the one-day
   first-line response target.

No native billing or public store release work may begin until its own required
commercial, policy, legal, security, and operational evidence is approved by
Grant. A later billing decision must not be smuggled into the mobile shell
under this ADR.

## Consequences

- The first mobile value proposition is portability and secure on-the-go
  updates, not a new commercial funnel.
- The existing web entitlement and legal boundaries remain authoritative while
  the companion is piloted.
- Broad intended access can be tested without treating a controlled track as a
  public release approval.
- Platform compatibility, legal-entity enrollment, policy classification, and
  publication evidence remain visible gates rather than undocumented
  assumptions.
- A future mobile-checkout proposal must return as a separate decision record
  with demand, support, entitlement, tax/legal, and store-policy evidence.
