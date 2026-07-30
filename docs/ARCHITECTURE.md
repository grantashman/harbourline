# Harbourline Architecture

## Current state

The production offline edition is a dependency-light HTML application at the
repository root. It stores one versioned budget document in browser
`localStorage` and performs all calculations in the browser.

Release 1 preserves that application unchanged as the stable entry point while
introducing a typed workspace for the subscription product.

## Target structure

```text
apps/
  web/                 Installable React web application
packages/
  domain/              Pure financial calculations and data migrations
docs/                  Product, architecture and security decisions
index.html             Stable offline edition
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

- user interface and navigation
- local persistence
- backup import and export
- PWA installation and offline assets
- future account and synchronisation adapters

The Release 1 web application persists a single budget in IndexedDB. It can
import the existing Harbourline JSON backup format. It does not send financial
data over the network.

### Future service layer

Release 2 will add:

- Supabase Auth
- household and household-member records
- PostgreSQL row-level security
- explicit local-to-cloud migration
- versioned synchronisation mutations
- subscription entitlement records

Release 3 will add Stripe Checkout, the Customer Portal and verified webhooks.

## Data ownership

A budget belongs to a household. A user may be a member of one or more
households. Subscription status controls cloud capabilities, not ownership of
the household's data.

Cancellation must never delete a budget. A cancelled household becomes
read-only in cloud mode and retains export and deletion controls.

## Synchronisation direction

The local application remains usable while disconnected. Cloud sync will use:

- client-generated UUIDs
- entity-level updated timestamps
- optimistic concurrency checks
- a durable local mutation queue
- explicit conflict presentation when changes cannot be merged safely

The first synchronisation release will not use silent last-write-wins for
financial records.

## Migration strategy

1. Read the existing local document only after a user action.
2. Normalise it through the versioned domain migration.
3. Present a summary of records to be imported.
4. Save locally or upload to a selected household after explicit confirmation.
5. Keep the original local document until the user removes it.

