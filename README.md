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

## Release 1 Foundation

The original offline application remains the stable edition at the repository
root. Release 1 adds the product foundation beside it:

- `apps/web` - responsive React and TypeScript PWA shell
- `packages/domain` - tested financial calculations and data migrations
- `docs` - product, architecture, security and release decisions
- `.github/workflows/ci.yml` - automated validation on every push and pull request

The PWA stores household data in IndexedDB with a localStorage fallback. It
does not send financial information to a server. It can import data from the
existing browser edition when both versions share an origin, and it supports
versioned JSON backup import and export.

## Development

Use Node.js 22 and pnpm 11.9:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

`pnpm check` runs strict type checking, 14 financial-domain tests and the
production PWA build. `pnpm dev` starts the foundation preview.

See `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md` and
`docs/RELEASES.md` for the path from this release to accounts, household sync
and paid subscriptions.

## Privacy

The repository contains only the application source and visual assets. Personal
budget information entered into the app is not committed to this repository.

## Technology

The stable edition is dependency-light HTML, CSS and JavaScript with a local
copy of `pdf-lib`. The product foundation uses React, TypeScript, Vite and a
small pure TypeScript financial engine in a pnpm workspace.
