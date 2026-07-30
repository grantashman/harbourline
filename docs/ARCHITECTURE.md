# Harbourline Architecture

## Current state

The production offline edition is a dependency-light HTML application at the
repository root. It stores one versioned budget document in browser
`localStorage` and performs all calculations in the browser.

Release 2 preserves that exact interface as the customer-facing application.
The Vite build serves the root `index.html` and injects a TypeScript account
module. Opening the same file directly does not load the hosted module and
continues to work offline.

## Target structure

```text
apps/
  web/                 Hosted account, household and sync layer
packages/
  domain/              Pure financial calculations and data migrations
  sync/                State hashing, sync decisions and mutation queue rules
supabase/              Database migration, policy tests and Edge Functions
docs/                  Product, architecture and security decisions
index.html             Original Harbourline interface and local state bridge
assets/                Shared brand and offline-edition assets
```

## Architectural boundaries

### Domain

`@harbourline/domain` owns:

- budget data types and schema versioning
- frequency conversion
- summary calculations
- savings projections
- debt repayment simulation
- legacy-state normalisation

It has no browser, framework, database or payment dependencies. Every
calculation is deterministic and covered by unit tests.

### Web application

`@harbourline/web` owns:

- Account panel added to the original header
- Supabase authentication and optional TOTP MFA
- household creation and invitation
- IndexedDB sync metadata and pending mutations
- explicit first-copy migration and conflict resolution
- PWA installation and offline assets

The web build does not duplicate the planning interface. `index.html` exposes a
small `HarbourlineLocal` bridge for reading or replacing the versioned document.
All ordinary edits continue to save through the original localStorage path.

### Cloud service

Supabase owns:

- Supabase Auth
- household and household-member records
- PostgreSQL row-level security
- revision-checked budget document writes
- idempotent mutation receipts
- account export and authenticated deletion

Release 3 will add Stripe Checkout, the Customer Portal and verified webhooks.

## Data ownership

A budget belongs to a household. A user may be a member of one or more
households. Subscription status controls cloud capabilities, not ownership of
the household's data.

Cancellation must never delete a budget. A cancelled household becomes
read-only in cloud mode and retains export and deletion controls.

## Synchronisation direction

The local application remains usable while disconnected. Cloud sync uses:

- client-generated UUIDs
- a whole-document revision number
- deterministic canonical state hashes
- optimistic concurrency in the `sync_budget` database function
- a durable local mutation queue
- realtime change notification followed by an authorised document read
- explicit whole-document conflict presentation

Release 2 does not use silent last-write-wins for financial records.

## Migration strategy

1. Keep the existing local document as the active device copy.
2. Require sign-in and a selected household.
3. Ask whether to use the device budget or the existing household budget.
4. Upload or download only after that explicit choice.
5. Keep the resulting document in localStorage for offline use.
6. Queue later device edits in IndexedDB until the network is available.
