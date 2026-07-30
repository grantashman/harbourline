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

- Supabase project in Sydney
- account registration and recovery
- optional user MFA
- households and member invitations
- row-level security and policy tests
- explicit local-to-cloud migration
- offline mutation queue and conflict handling
- account export and deletion

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
- desktop packaging
- mobile applications and app-store billing
- professional and employer editions
