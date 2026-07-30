# Harbourline

Harbourline is a household money-planning application for people who want a clear, practical view of paydays, bills, debt, savings and future goals.

It began as a private Australian-dollar budget planner and is evolving into a web, desktop and mobile-ready subscription product. The product direction is simple: help households move from "what did we spend?" to "what should we do next?"

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
- Dark mode, responsive layout and local browser persistence
- Optional Supabase-backed accounts, household sync and password recovery for hosted builds

## Commercial Direction

Harbourline is being prepared for a controlled demo/trial release before public self-serve registration.

Planned subscription positioning:

- Free / Local: single-device planning, manual backup and core budget tools
- Household: cloud sync, shared household plans, payday command centre and reports
- Plus: advisor insights, deeper debt/savings plans, calendar integrations and automation

Public registration is intentionally paused until the demo/trial flow, onboarding, billing, privacy terms and support model are ready.

## Architecture

Harbourline is source-controlled as a small monorepo:

- `index.html` - the core app interface and local-first budgeting experience
- `apps/web` - Vite/TypeScript hosted app wrapper, account panel and sync integration
- `packages/domain` - pure financial calculations and migrations
- `packages/sync` - deterministic document hashing, mutation queues and conflict handling
- `supabase` - authentication, household data model, row-level security and account lifecycle functions
- `marketing` - GitHub Pages product homepage
- `docs` - release, deployment, security and product planning notes

The live app is deployed on Vercel. The public product homepage is deployed separately to GitHub Pages so the repository homepage can market Harbourline without replacing the application.

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

Harbourline is designed around local-first planning and explicit cloud sync.

- Local budgets stay in browser storage until the user chooses cloud sync.
- Hosted household sync uses Supabase authentication and row-level security.
- Production responses include security headers through Vercel.
- Repository source does not include personal budget history.
- Public GitHub Pages content is marketing-only and does not store financial data.

## Status

Harbourline is in active product development. The current priority is moving from a personal project to a polished subscription-ready application with a controlled demo/trial funnel, clear onboarding, and robust account safety.
