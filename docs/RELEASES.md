# Harbourline Release Plan

## Release 1: Product foundation

Status: complete (30 July 2026)

- preserve the existing offline application
- document the product and commercial boundaries
- create the TypeScript workspace
- extract the financial domain engine
- add versioned data normalisation
- add unit tests and continuous integration
- build the first responsive PWA shell
- store Release 1 data in IndexedDB
- support local backup import and export

Verification:

- strict TypeScript checks across the domain and web packages
- 14 passing financial calculation and migration tests
- successful production PWA and service-worker build
- responsive desktop and mobile browser review

## Release 2: Accounts and household sync

Status: test deployment complete; controlled Asia-Pacific beta activation pending

- preserve the exact original Harbourline interface
- email/password registration, sign-in and email sign-in links
- optional user TOTP MFA
- households and expiring member invitations
- row-level security and owner/member/outsider policy tests
- explicit device-copy or household-copy migration
- IndexedDB offline mutation queue
- revision conflicts with deliberate version selection
- realtime household update notifications
- account export and authenticated deletion
- installable PWA build using the original application

Verification:

- strict TypeScript checks across domain, sync and web packages
- 14 financial-domain tests and 7 sync tests
- static database security guard
- successful production PWA and service-worker build
- local-mode desktop and mobile browser review

Activation gate:

- approve and document the Supabase region for the controlled beta
- apply the migration and run pgTAP policy tests
- deploy and test the account deletion function
- configure production email, URLs, backup restoration and incident ownership

The Tokyo deployment passed authenticated owner, member and outsider isolation,
sync, invitation, export and deletion tests on 30 July 2026. It is approved for
a controlled beta while its non-Australian data residency is documented and
reviewed. See `PRODUCTION_ACTIVATION.md`.

## Release 3: Paid beta

- Stripe products and prices
- hosted Checkout
- customer billing portal
- verified, idempotent subscription webhooks
- entitlement and grace-period logic
- subscription lifecycle email
- founding-household onboarding

## Release 4: Public web launch

- public product site
- production support centre
- privacy-safe product analytics
- monitoring and incident runbooks
- legal-page review
- onboarding funnel and retention reporting

## Release 5: Connected and native products

- accredited Consumer Data Right integration
- automatic transaction categorisation
- optional Google Calendar sync for planned paydays, bills and household milestones
- desktop packaging
- mobile applications and app-store billing
- professional and employer editions

Google Calendar sync is a post-paid-early-access feature. It requires a
separate OAuth and event-data design, explicit disconnect/revocation handling,
and a decision on whether the first release is Harbourline-to-Google only or
supports edits made in Google Calendar.
