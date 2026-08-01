# Harbourline

Harbourline is a calm household money plan for paydays, bills, savings, debt and what is safe to spend next.

It is designed for Australian households who want to move beyond a record of past spending and make a practical plan for the next pay.

## Start here

- [Visit the Harbourline homepage](https://grantashman.github.io/harbourline/)
- [Open the hosted application](https://harbourline-zeta.vercel.app/)
- [Browse the source on GitHub](https://github.com/grantashman/harbourline)

The homepage is the starting point for new accounts. Existing members can sign in through the hosted application.

## What Harbourline helps with

Harbourline brings the household money rhythm into one view:

- Map income, bills, expenses, savings goals and debts across weekly, fortnightly, monthly and yearly cycles.
- Check the next payday: fund upcoming bills, set aside savings and debt payments, and see what is safe to spend.
- Look ahead with a 13-week bills forecast and a monthly cash-flow calendar.
- Model savings growth, debt repayment scenarios, goals and net worth.
- Record actual transactions and compare the plan with reality.
- Export Excel, CSV, PDF and JSON backup copies when you need to review or keep a record.

The hosted early-access release also includes optional one-way Google Calendar sync for planned paydays and bill due dates. Calendar events can be kept generic, or expense names can be enabled deliberately from the account panel.

## A simple payday rhythm

1. Add the commitments that matter to your household.
2. Use the Payday Check-in to decide what moves on the next pay.
3. Adjust the plan as real life changes, without losing the forward view.

## Pricing and access

Harbourline currently has one introductory early-access plan at **A$1 per week**.

The hosted product uses secure Supabase accounts. New accounts are created from the public homepage, then confirmed by email before continuing to the hosted account and payment flow. Household sync is available after the plan is active.

Payment details are handled by the payment provider and are not stored in Harbourline. The product is a planning tool, not financial advice.

## Privacy and security

Harbourline keeps a local browser copy so the current working plan can remain available between sessions. Hosted household sync requires authentication and uses Supabase row-level security.

The public GitHub Pages site is marketing-only and does not store household financial data. Do not include passwords, account numbers or personal budget history in bug reports. See the [security policy](SECURITY.md) for reporting instructions.

Customer-facing privacy and terms documents are still drafts pending legal review. They are kept in [`docs/legal`](docs/legal) and should not be treated as final terms.

## For contributors

The repository is a small workspace with:

- `index.html` — the core browser budget interface and local continuity layer
- `marketing/` — the public GitHub Pages homepage
- `apps/web/` — the Vite/TypeScript hosted wrapper, account panel and sync integration
- `packages/domain/` — financial calculations, state models and migrations
- `packages/sync/` — household document hashing, queues and conflict handling
- `supabase/` — authentication, billing, household sync and calendar integrations
- `docs/` — product, deployment, security and release notes

Use Node.js 22 and pnpm 11.9.

```text
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

For a Supabase-backed hosted build, copy `.env.example` to `.env.local` and provide:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Only the Supabase publishable browser key belongs in frontend configuration. Never commit service-role keys or personal financial data.

`pnpm check` validates the TypeScript packages, domain and sync tests, schema guards and production build.

## Project status

Harbourline is in active product development. The current focus is a polished paid-beta release with homepage-led signup, clear onboarding, billing, household sync and strong account safety.

Launch planning and release gates are documented in [`docs/PRODUCTION_AND_PROFITABILITY.md`](docs/PRODUCTION_AND_PROFITABILITY.md), [`docs/PRODUCTION_ACTIVATION.md`](docs/PRODUCTION_ACTIVATION.md) and [`docs/EARLY_ACCESS_LAUNCH_AND_MARKETING.md`](docs/EARLY_ACCESS_LAUNCH_AND_MARKETING.md).
