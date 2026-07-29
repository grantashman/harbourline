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

## Privacy

The repository contains only the application source and visual assets. Personal
budget information entered into the app is not committed to this repository.

## Technology

The app is intentionally dependency-light: HTML, CSS and JavaScript are bundled
for offline use, with a local copy of `pdf-lib` for PDF generation.
