# Harbourline Security Baseline

## Data classification

Budget amounts, transaction histories, debts, income, goals and net worth are
confidential financial information. Authentication and billing identifiers are
confidential personal information.

Harbourline does not need bank passwords, card numbers or government
identifiers. Those values must never be collected.

## Release 1 controls

- Financial calculations execute locally.
- The new application stores its budget in IndexedDB.
- Import requires a deliberate file selection.
- Export produces a user-controlled JSON backup.
- No analytics, remote logging or third-party scripts receive budget values.
- The legacy offline application remains available.
- Dependency versions are locked.
- Type checking, unit tests and a production build run in CI.

## Cloud-release controls

Before any customer financial data is stored remotely:

- use an Australian database region
- enable row-level security on every exposed table
- test positive and negative authorisation paths
- keep privileged service credentials out of all browser bundles
- require MFA for administrative accounts
- encrypt all network traffic
- record administrative access and entitlement changes
- provide account export, correction and deletion
- implement data retention and backup restoration procedures
- maintain an incident and notifiable-data-breach response plan
- scrub personal and financial values from telemetry

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

