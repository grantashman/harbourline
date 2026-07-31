# Harbourline

Harbourline is a Supabase-backed household money-planning application for people who want a clear, practical view of paydays, bills, debt, savings and future goals.

It began as an Australian-dollar budget planner and is evolving into a web, desktop and mobile-ready subscription product. The product direction is simple: help households move from "what did we spend?" to "what should we do next?"

## Links

- Product homepage: `https://grantashman.github.io/harbourline/`
- Live application: `https://harbourline-zeta.vercel.app/`
- Repository: `https://github.com/grantashman/harbourline`

## Product Vision

Harbourline combines budgeting, payday planning and lightweight financial guidance in one calm interface.

Core outcomes:

- Understand the household position in plain Australian dollars.
- See income, expenses and bills across weekly, fortnightly, monthly and yearly cycles.
- Know the shortfall or surplus before it becomes a surprise.
- Plan bill set-asides in line with pay cycles.
- Model debt payoff and savings growth.
- Turn a budget into a forward-looking plan.

## Current Product

The current application includes:

- Flexible income sources with custom names, frequencies and next pay dates
- Expense and bill tracking with categories, icons, due dates and editable entries
- Weekly provision calculations for bills paid at different frequencies
- Financial summary metrics for income, expenses, surplus, shortfall and expense ratio
- Payday command centre with a 13-week bills forecast
- Monthly cash-flow calendar with planned income, planned bills and actual transactions
- Savings allocation and compound-growth projections
- Debt repayment planning with payoff scenarios
- Goals, net worth tracking and scenario modelling
- CSV import for transactions
- Excel workbook, CSV, PDF and JSON backup exports
- Dark mode, responsive layout and local browser caching for continuity
- Supabase accounts, household sync and password recovery for the hosted product

Included in the paid early-access release:

- Optional one-way Google Calendar sync for planned paydays and bill due dates

## Commercial Direction

Harbourline uses Supabase accounts as its only account model. Account creation is intentionally unavailable inside the app; the public product homepage is the only signup and access-request entry point.

Single-plan subscription positioning:

- One Harbourline plan: A$1/week introductory early-access pricing
- Included: secure Supabase sign-in, household sync, payday planning, reports, savings and debt tools

The introductory price is the only planned offer at this stage. Billing, onboarding, privacy terms and support will be completed before broad public launch.

## Architecture

Harbourline is source-controlled as a small monorepo:

- `index.html` - the core budget interface and browser continuity layer
- `apps/web` - Vite/TypeScript hosted app wrapper, account panel and sync integration
- `packages/domain` - pure financial calculations and migrations
- `packages/sync` - deterministic document hashing, mutation queues and conflict handling
- `supabase` - required authentication, household data model, row-level security and account lifecycle functions
- `marketing` - GitHub Pages product homepage
- `docs` - release, deployment, security and product planning notes

The live app is deployed on Vercel. The public product homepage is deployed separately to GitHub Pages so the repository homepage can market Harbourline without replacing the application.

## Production And Profitability

The current launch gates, cost model, member scaling, break-even assumptions
and recommended execution order are maintained in
[`docs/PRODUCTION_AND_PROFITABILITY.md`](docs/PRODUCTION_AND_PROFITABILITY.md).

Draft customer documents and the brief for Australian legal review are in
[`docs/legal`](docs/legal). They are not customer-facing or final until the
legal entity, contact details and review outcomes are confirmed.

## Development

Use Node.js 22 and pnpm 11.9.

```text
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

`pnpm check` validates TypeScript, domain/sync tests, schema guards and the production build.

For Supabase-backed hosted builds, copy `.env.example` to `.env.local` and provide:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Only use the Supabase publishable browser key in the frontend. Never commit service-role keys or personal financial data.

## Privacy And Security

Harbourline is designed around Supabase-authenticated planning with a local browser cache for continuity.

- A browser cache keeps the current working copy available between sessions.
- Hosted household sync uses required Supabase authentication and row-level security.
- Production responses include security headers through Vercel.
- GitHub checks each pull request for vulnerable dependency changes and scans
  the application with CodeQL on pull requests, main-branch releases and a
  weekly schedule.
- Repository source does not include personal budget history.
- Public GitHub Pages content is marketing-only and does not store financial data.

Security reports must never include household financial information. The
reporting policy is in [`SECURITY.md`](SECURITY.md).

## Status

Harbourline is in active product development. The current priority is a polished single-plan subscription release with homepage-led signup, clear onboarding, billing, and robust account safety.

The next controlled paid-beta target is the first 20 paid households, with no
member cap, at least 70% first-payday-plan activation and at least 60%
four-week retention. Paid signup remains gated until the production activation
checklist and release matrix pass.
