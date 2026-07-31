# Harbourline Security Baseline

## Data classification

Budget amounts, transaction histories, debts, income, goals and net worth are
confidential financial information. Authentication and billing identifiers are
confidential personal information.

Harbourline does not need bank passwords, card numbers or government
identifiers. Those values must never be collected.

## Local controls

- Financial calculations execute locally.
- The budget document remains in localStorage for direct-file compatibility.
- Pending cloud mutations and sync metadata use IndexedDB.
- Import requires a deliberate file selection.
- Export produces a user-controlled JSON backup.
- No analytics, remote logging or third-party scripts receive budget values.
- The production application requires an authenticated paid subscription. The
  browser retains a working cache for continuity, but it cannot create a
  standalone account or bypass subscription access.
- Dependency versions are locked.
- Type checking, unit tests and a production build run in CI.

## Release 2 cloud controls

- Every exposed table has row-level security.
- Anonymous access is explicitly revoked.
- Household members can read only households they belong to.
- Budget writes are denied directly and must use the revision-checked
  `sync_budget` function.
- Invitation tokens are random, expiring and stored only as SHA-256 hashes.
- Browser builds accept only a Supabase publishable key.
- TOTP authenticator enrolment is available to users.
- Account export is authorised in the database.
- Account deletion runs in an authenticated Edge Function and refuses to
  orphan an owned household.
- Policy tests include owner, member and unrelated-user paths.
- Financial values are excluded from application telemetry.

## Google Calendar controls

- Calendar OAuth state and PKCE verifiers are short-lived, single-use and bound
  to the authenticated Harbourline user.
- Google refresh tokens are encrypted with AES-GCM before service-role-only
  storage; they are never exposed to the browser or customer-facing logs.
- The first sync is one-way and sends only generic all-day payday and bill-due
  events. Amounts, bill names and household descriptions remain in Harbourline.
- Google Calendar events are marked as Harbourline-owned, and disconnect can
  revoke access and remove only those marked events.
- The OAuth client, callback URL and encryption key are deployment secrets and
  must be different between staging and production.

## Repository safeguards

- CodeQL scans JavaScript and TypeScript on pull requests, main-branch changes
  and a weekly schedule.
- Dependency Review blocks pull requests that add a high or critical known
  vulnerability.
- Dependabot opens weekly update pull requests for npm packages and GitHub
  Actions.
- GitHub secret scanning and push protection must remain enabled for the public
  repository. The project owner must review every security alert promptly.
- Private vulnerability reporting must be enabled before the paid beta opens.

Production still requires an Australian Supabase region, backup restoration
rehearsal, administrative MFA, operational access logging and an incident
response owner.

## Payment controls

Stripe-hosted Checkout and the Stripe Customer Portal will collect payment
details. Harbourline will store only Stripe customer, subscription and price
identifiers. Webhooks must be signature-verified, replay-safe and idempotent.

Subscription cancellation must be available without contacting support.

## Guidance boundary

Harbourline provides calculations, projections and educational explanations.
It must not recommend specific financial products or market itself as a
licensed financial adviser without an appropriate Australian legal and
licensing review.

Automated guidance must:

- identify the figures used
- distinguish assumptions from known values
- avoid guarantees
- avoid product recommendations
- allow the user to correct the underlying data

## Security release gate

A cloud release cannot ship until:

- all database policies have automated isolation tests
- backup restoration has been rehearsed
- account deletion has been verified end to end
- dependency and secret scanning pass
- the privacy notice matches actual data flows
- an incident owner and escalation path are documented
