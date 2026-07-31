# Harbourline Interface Design System

## Direction

Harbourline should feel like a calm Australian household ledger: practical,
private, reassuring and action-oriented. The product helps a household decide
what to do before the next payday, so the interface should lead with the next
action and keep projections explainable.

Domain vocabulary:

- paydays and pay cycles;
- bills accounts and set-asides;
- safe-to-spend limits;
- underfunded and upcoming bills;
- savings, debt and household progress.

Color world: deep harbour water, sea glass, pale paper, muted ledger ink and
small amounts of amber or rose for attention states. Use color to communicate
status, never as decoration.

Signature: the Payday Check-in. A focused three-step action card turns a
forecast into a repeatable ritual: move the bills amount, set savings/debt
aside, then confirm safe-to-spend.

Reject:

- generic dashboard metric grids → give the current payday action one focal
  card and demote forecasts to supporting context;
- decorative gradients and multiple accent hues → use Harbourline surface
  layers and one mint action accent;
- hidden or implied state changes → expose checklist progress, confirmation
  status and recent payday history.

## Tokens and surfaces

Use the existing tokens in `index.html`:

- primary text: `--ink`;
- supporting text: `--muted`;
- structure: `--line` and `--line-strong`;
- canvas/surfaces: `--paper`, `--panel`, `--panel-soft`, `--field`,
  `--field-muted`;
- brand action: `--mint` and `--mint-dark`;
- status: `--blue`, `--amber`, `--rose`.

Use a subtle layered-surface strategy. Cards use a quiet border and small
surface shift; lifted application shells may use the existing `--shadow`.
Dark mode should rely more on low-opacity borders than deep shadows. Keep
control backgrounds slightly inset from their surrounding surface.

## Layout and rhythm

- Base rhythm: 4px, with most spacing expressed as 8px, 12px, 16px and 20px.
- Product UI density: compact enough for a planning workbench, with deliberate
  air around the primary decision.
- Every view has one focal task. On the Payday view, the check-in card comes
  before summary metrics, the 13-week forecast and history.
- Use responsive single-column stacking at the existing 680px breakpoint.
- Keep interactive hit areas at least 40px high; use 44px where practical.

## Typography

Keep the existing Inter/system stack and use size, weight and color together:

- page title: 28–36px, heavy, tight line-height;
- workspace heading: approximately 18px, strong;
- primary metric: 17–20px, heavy, tabular numbers;
- labels and metadata: 11–13px, uppercase or muted where appropriate;
- body copy: 13–15px with 1.4–1.5 line-height.

Dynamic financial values should use tabular numerals and remain easy to scan.

## Reusable patterns

### Payday Check-in card

- `.payday-loop`: 18px padding, 10px radius, mint-tinted border and
  `--panel-soft` surface;
- header places the action title on the left and the next-payday date on the
  right;
- three checklist tiles in a row on desktop, one column on mobile;
- checklist tile: 11px padding, 8px radius, minimum 70px height, native
  checkbox, strong action label, muted explanation and a right-aligned amount;
- footer shows completion count and next-state copy alongside the primary
  confirmation button;
- completed state uses mint border/surface treatment and clear text, not only
  color.

### Payday history row

Use compact ledger-like rows: date and confirmation detail on the left, transfer
and safe-to-spend values on the right. Stack them at mobile widths.

### Upcoming bill action

Keep “Mark paid” next to the bill’s current funding status. A paid action should
create a matched actual transaction, reset the reserve, advance the next due
date for recurring bills, and refresh the forecast immediately.

### Empty and attention states

Empty states should name the next useful input, for example “Add bills to build
the forecast.” Attention states should explain the cause and the next action;
use amber or rose sparingly.

## Accessibility and interaction

- Prefer native buttons, inputs, selects and checkboxes.
- Use semantic regions, headings, tabs and live status text.
- Provide visible focus rings using the mint focus color.
- Every action needs default, hover, focus, disabled and confirmed states.
- Support reduced motion; keep transitions short and limited to opacity, color
  and transform.
