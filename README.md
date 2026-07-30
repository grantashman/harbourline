<p align="center">
  <img src="assets/harbourline-logo.svg" width="520" alt="Harbourline - Household Money Planning" />
</p>

# Harbourline

Harbourline is a private, local-first household budgeting and money-planning
platform for Australian households. It brings paydays, bills, savings, debt
and long-term goals into one clear financial plan. It runs entirely in the
browser, uses Australian dollar formatting, and stores financial data on the
device rather than sending it to a server.

**Your money. Your plan. One clear view.**

## Brand Assets

- `assets/harbourline-logo.svg` - primary horizontal product lockup
- `assets/harbourline-mark.svg` - standalone application mark
- `assets/harbourline-logo.png` and `assets/harbourline-mark.png` - high-resolution raster versions
- `assets/favicon.svg` and `assets/favicon.png` - browser icon formats

## Highlights

- Editable household income sources with saved names, pay frequencies and next-pay dates
- Weekly, fortnightly, monthly and yearly bill planning
- Editable expenses with categories, icons and due dates
- Weekly set-aside amounts aligned to a salary cycle
- Shortfall, surplus and cash-flow summaries
- Savings allocation and compound-growth projections
- Debt payoff planning and repayment scenarios
- Payday planning, a 13-week forecast and sinking funds
- Monthly cash-flow calendar with Google Calendar-compatible export
- Transaction reality checks and CSV import
- Household goals, net worth and scenario planning
- Spreadsheet, PDF and data-backup exports
- Dark mode, responsive layouts and local persistence

## Use It

Open `index.html` directly for the fully offline version. The same files can
also be deployed to any static web host when an online edition is needed.

No account is required. Budget information is stored with browser
`localStorage`, so the local-file version and the hosted version keep separate
copies of the data. Use the app's backup and restore controls when moving a
budget between browsers or devices.

## Release 2

The original Harbourline interface remains the product interface. Release 2
adds optional secure accounts and shared-household sync behind the matching
Account panel without replacing the existing layout:

- `apps/web` - TypeScript account, household and sync layer for the original page
- `packages/domain` - tested financial calculations and data migrations
- `packages/sync` - deterministic state hashing, conflict decisions and mutation queue rules
- `supabase` - authentication, household database, row-level security and account deletion
- `docs` - product, architecture, security and release decisions
- `.github/workflows/ci.yml` - automated validation on every push and pull request

Opening `index.html` directly remains fully offline and account-free. A hosted
build connected to Supabase can register an account, create or join a
household, explicitly choose the first budget copy, queue edits while offline,
and resolve simultaneous edits without silent last-write-wins.

## Development

Use Node.js 22 and pnpm 11.9:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

`pnpm check` runs strict type checking, 21 domain and sync tests, a database
security guard and the production PWA build. `pnpm dev` starts the exact
original Harbourline interface with the Release 2 account layer.

Copy `.env.example` to `.env.local` only after creating a Supabase project.
Use the public publishable key in the browser build, never a secret or
service-role key. See `docs/RELEASE_2_DEPLOYMENT.md` for activation.

The current Supabase project is approved for a controlled Asia-Pacific beta.
Its Tokyo data-residency limitation must be disclosed and reassessed before a
wider launch. Production database and Edge Function changes are deployed from
the private GitHub repository through Supabase's repository-scoped GitHub
integration. See `docs/PRODUCTION_ACTIVATION.md`.

## Privacy

The repository contains only the application source and visual assets. Personal
budget information entered into the app is not committed to this repository.

## Technology

The interface is dependency-light HTML, CSS and JavaScript with a local copy of
`pdf-lib`. The hosted account layer uses TypeScript, Vite, Supabase and small
pure TypeScript domain and sync packages in a pnpm workspace.
