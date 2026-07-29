# Bolton Point Budget

Bolton Point Budget is a private, local-first household budgeting and financial
planning app for Australian households. It runs entirely in the browser, uses
Australian dollar formatting, and stores financial data on the device rather
than sending it to a server.

## Highlights

- Multiple household income streams and pay frequencies
- Weekly, fortnightly, monthly and yearly bill planning
- Editable expenses with categories, icons and due dates
- Weekly set-aside amounts aligned to a salary cycle
- Shortfall, surplus and cash-flow summaries
- Savings allocation and compound-growth projections
- Debt payoff planning and repayment scenarios
- Payday planning, a 13-week forecast and sinking funds
- Transaction reality checks and CSV import
- Household goals, net worth and scenario planning
- Spreadsheet, PDF and data-backup exports
- Dark mode, responsive layouts and local persistence

## Use It

Open `index.html` directly for the fully offline version, or use the published
GitHub Pages site.

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
