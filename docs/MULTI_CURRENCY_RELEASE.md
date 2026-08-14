# Multi-currency release, operations and support

Last reviewed: 12 August 2026

## Release decision

**GO for the owner-authorized budgeting pilot:** production enables `AUD`, `NZD`
and `USD` for budgeting while subscription billing remains AUD. This is a
budget-currency enablement only; it does not create non-AUD Stripe Prices or
change the existing subscription contract. Further currencies and any
non-AUD billing require a separate reviewed release.

This is the release runbook and evidence record for the pilot. The reviewed
change was merged in [PR #52](https://github.com/grantashman/harbourline/pull/52)
as main commit `922507e47d41dfd9ca26bbdfd7d6d8c3b94ee2f3`. The protected
[production workflow run 31552755896](https://github.com/grantashman/harbourline/actions/runs/31552755896)
completed successfully: it applied the forward-only catalog enablement
migration, verified the paired `AUD,NZD,USD` allowlist, kept the reviewed AUD
Stripe contract, deployed the Edge Functions and passed the final production
schema/function invariant.

### Current contract

- The production browser and domain configuration enables `AUD`, `NZD` and `USD`
  for budgeting, with `AUD` as the default.
- The database currency catalog enables `AUD`, `NZD` and `USD`; all other catalog
  rows remain disabled.
- Budget currency and subscription billing currency are separate. Budget
  currency does not trigger foreign-exchange conversion and does not change the
  reviewed introductory Stripe price.
- The current billing contract remains the weekly AUD price. Keep
  `STRIPE_BILLING_CURRENCY=aud` and the reviewed AUD `STRIPE_PRICE_ID` until a
  separate provider-price and commercial approval is recorded.
- Existing AUD records must remain readable through the compatibility path.
  Records must never be silently converted when a currency setting changes.

The current implementation routes the covered summary, recurring-conversion,
savings and debt calculations through integer minor-unit operations and adds
cent-boundary, zero-decimal, safe-range and persistence regression coverage.
The current main CI run passed Deno checks, local Supabase database tests and
the full `pnpm check`; the protected production run verifies the deployed
`AUD,NZD,USD` budget allowlist and active functions. Alternate-currency hosted
payment/refund/reconciliation E2E, backup/restore evidence, and commercial or
compliance approvals remain external gates for expanding beyond this budgeting
pilot or changing billing currency.

### Currency states: metadata is not availability

The application and database carry reviewed metadata for these eleven codes:

| Code | Minor-unit precision | Default locale | Current production state |
| --- | ---: | --- | --- |
| `AUD` | 2 | `en-AU` | **Enabled** for budgeting and billing |
| `BHD` | 3 | `en-BH` | Catalog row present; disabled |
| `CAD` | 2 | `en-CA` | Catalog row present; disabled |
| `EUR` | 2 | `en-IE` | Catalog row present; disabled |
| `GBP` | 2 | `en-GB` | Catalog row present; disabled |
| `INR` | 2 | `en-IN` | Catalog row present; disabled |
| `JPY` | 0 | `ja-JP` | Catalog row present; disabled |
| `MXN` | 2 | `es-MX` | Catalog row present; disabled |
| `NZD` | 2 | `en-NZ` | **Enabled** for budgeting; billing remains AUD |
| `SGD` | 2 | `en-SG` | Catalog row present; disabled |
| `USD` | 2 | `en-US` | **Enabled** for budgeting; billing remains AUD |

“Supported” in source code means that a reviewed definition exists. A code is
available to a customer only when it is present in the deployed browser
allowlist, enabled in `public.currency_catalog`, and covered by the release
record. The current production budget allowlist supports `AUD`, `NZD` and `USD`;
the other definitions remain disabled. Custom browser metadata does not bypass
the database catalog or the release gates.

### Display, calculation and settlement behavior

- Inputs are plain decimal amounts. They are rounded half-up at the selected
  currency's minor-unit boundary (`JPY` has zero minor units; `BHD` has three).
- Schema-version-4 documents persist monetary fields as signed integer
  minor-unit strings. Runtime calculations aggregate and scale those integers;
  recurring conversions round once at the target currency's minor-unit
  boundary. A display with two decimals is not evidence that a value was stored
  with two decimals.
- The configured locale controls display and export formatting. It does not
  change the stored amount or the selected currency. Values from different
  currencies must never be added together.
- Harbourline does not provide foreign exchange, convert existing budgets, or
  choose a settlement rate. Budget currency is household metadata and planning
  arithmetic only. Subscription billing is an independent provider Price.
- The provider Price currency is the customer billing and refund currency. A
  refund or credit must be recorded against the original provider currency and
  integer minor-unit amount; support must not calculate an exchange-rate refund.
- Revenue reconciliation compares provider charges, refunds, credits and
  subscription-ledger amounts by currency. Payout or bank settlement FX is a
  separate accounting difference and must not be used to rewrite the customer
  charge or budget amount.

## Required release gates

The following gates remain required before expanding the production allowlist,
enabling another currency, or changing subscription billing. A local build or a
green AUD smoke test is not a substitute for a hosted gate.

| Gate | Evidence required | Current state |
| --- | --- | --- |
| Exact money calculations | Runtime aggregation, recurring conversions, reports and exports remain cent/minor-unit exact without major-unit float drift; include cent-boundary and zero-decimal tests | **Partial**: covered domain paths and local regressions pass; independent full browser/export matrix remains open |
| Domain and browser matrix | Legacy AUD restore, new empty-budget currency selection, non-empty-budget rejection, import/export, sync and report checks for every proposed currency | AUD-only local smoke passed; alternate-currency hosted behavior not verified |
| Database migration | Staging `supabase db push --linked`, `supabase test db`, policy/invariant checks and a documented forward-only rollback or restore procedure | **Partial/pass**: current CI database tests passed; the production workflow verifies the `AUD,NZD,USD` budget allowlist; no disposable restore evidence |
| Edge Functions and payment contract | Deno checks plus test-mode Stripe price/catalog, checkout, webhook, refund and reconciliation tests for each billing currency | **Partial**: CI Deno/contract checks and production function deployment passed; hosted payment/refund/reconciliation E2E for a pilot currency remains open |
| Backup and restore | Provider backup retention confirmed, disposable restore completed, backup identifier recorded outside customer data, and migration compatibility checked | **Blocked**: no current backup/restore record is attached to this release; the last documented beta checkpoint reported Free/NANO with no scheduled backups |
| CI and review | Pull request, required CI/security checks, reviewed migration and protected production workflow run | **Pass**: PR #52 exact-head checks and protected production run passed |
| Commercial and legal approval | Settlement, tax, refund, pricing, customer-location and support wording approved for each currency | Not approved |
| Staged cohort | One currency enabled for a small, named cohort with a control comparison and a pause owner | **Open**: NZD/USD budgeting pilot is live; named cohort/window, control comparison and pause owner still to be recorded |

### Verified current deployment record

- Repository head: `922507e47d41dfd9ca26bbdfd7d6d8c3b94ee2f3` on `main`.
- CI and review: [PR #52](https://github.com/grantashman/harbourline/pull/52) merged after exact-head `validate`, CodeQL, dependency-review and Vercel checks passed. The merged-head [Harbourline CI run](https://github.com/grantashman/harbourline/actions/runs/31552755886), [security run](https://github.com/grantashman/harbourline/actions/runs/31552755888) and [homepage deployment](https://github.com/grantashman/harbourline/actions/runs/31552755881) also passed.
- Production infrastructure: [run 31552755896](https://github.com/grantashman/harbourline/actions/runs/31552755896) passed exact-main verification, configuration checks, migration application, unchanged AUD Stripe contract configuration, Edge Function deployment and the final schema/function invariant. Its database query verified `AUD`, `NZD` and `USD` enabled, no other enabled catalog code, and the sync function present.
- Public surface: `https://harbourline.app` served the production browser bootstrap with `enabledCurrencies: ["AUD", "NZD", "USD"]`, `defaultCurrency: "AUD"`, and NZD/USD metadata.
- Recovery rehearsal: the prior rollback-only SQL rehearsal applied the pending invariants inside a transaction, passed its assertions, and rolled back without changing production state; this does not substitute for a disposable backup restore.
- Production enablement result: `AUD,NZD,USD` for budgeting only. No non-AUD Stripe Price is part of this release; subscription billing remains AUD.

Do not weaken a gate because the first pilot is small. A small cohort can still
create irreversible payment, accounting or customer-data problems.

## Configuration contract

Use the following boundaries and keep credentials out of browser configuration:

| Surface | Configuration | Rule |
| --- | --- | --- |
| Browser bootstrap | `globalThis.HarbourlineCurrencyConfig` with `enabledCurrencies`, `defaultCurrency` and `currencies` definitions | Production pilot is `AUD,NZD,USD`; default remains `AUD`; retain AUD for compatibility |
| Database | `public.currency_catalog` (`code`, `minor_unit`, `default_locale`, `enabled`, `verified_at`, `verified_by`) | Pilot migration enables exactly NZD and USD in addition to AUD; record the owner decision and timestamp |
| Browser billing display | `VITE_HARBOURLINE_BILLING_CURRENCY` and `VITE_HARBOURLINE_BILLING_LOCALE` | Public display values only; they do not authorize a Stripe price or a budget currency |
| Edge Function billing authority | `STRIPE_BILLING_CURRENCY` and protected `STRIPE_PRICE_ID` | Checkout fetches and verifies the active recurring Stripe Price; no FX conversion is performed |
| Provider Price identity | `STRIPE_PRODUCT_ID` and `STRIPE_LIVE_MODE` | Checkout, webhook and reconciliation must agree on product, mode, currency, amount, interval and Price ID |
| Provider secrets | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and Supabase runtime secrets | Keep server-side; never place them in `VITE_*` variables or support tickets |

The browser allowlist, database catalog and user-facing copy must agree. A
currency appearing in built-in metadata is not evidence that it is enabled or
that a matching Stripe price exists. The Stripe price currency is also not
proof that budget calculations, refunds or reconciliation are correct.

Production pilot bootstrap configuration:

```html
<script>
  globalThis.HarbourlineCurrencyConfig = {
    enabledCurrencies: ["AUD", "NZD", "USD"],
    defaultCurrency: "AUD",
    currencies: {
      AUD: { minorUnit: 2, locale: "en-AU" },
      NZD: { minorUnit: 2, locale: "en-NZ" },
      USD: { minorUnit: 2, locale: "en-US" }
    }
  };
</script>
```

The browser bridge uses `locale`; the TypeScript domain registry uses
`defaultLocale`. Keep those adapters explicit rather than copying one config
object into the other. `VITE_HARBOURLINE_BILLING_CURRENCY` and
`VITE_HARBOURLINE_BILLING_LOCALE` are public display values only. The server
billing contract is controlled by `STRIPE_BILLING_CURRENCY`,
`STRIPE_PRODUCT_ID`, `STRIPE_PRICE_ID` and `STRIPE_LIVE_MODE`, and each billing
function verifies the provider Price before creating or reconciling access.

### Enablement and disablement controls

Treat the browser allowlist and the database catalog as a paired feature flag;
changing only one creates a partial rollout. For a reviewed pilot:

1. Open a reviewed pull request with the browser allowlist, copy, tests and a
   forward-only migration that updates the approved catalog rows. Include each
   code, minor-unit precision, locale, `verified_at` and approving operator in
   the release record.
2. Rehearse the migration and the exact configuration in staging. Keep `AUD`
   enabled and add only the approved pilot codes. Verify empty-budget creation,
   legacy-AUD reads, non-empty currency-change rejection, sync, imports,
   exports, checkout, refunds and reconciliation before promotion.
3. Deploy the reviewed migration and functions first. Confirm the catalog row,
   function health and Price contract. Change the browser allowlist only after
   those checks pass, then expose the code to the named canary cohort.
4. Keep the billing currency unchanged unless a separate provider Price and
   commercial approval are part of the same release. Enabling a budget currency
   must not silently change the A$2.50/week subscription.

To disable a pilot, stop new selection and checkout first, then remove the code
from the browser allowlist in a reviewed deployment. Keep the catalog row and
read path intact while existing documents are assessed; do not disable or drop
the row merely because acquisition is paused. Reconcile open provider events,
refunds and entitlements before changing billing configuration. A destructive
catalog rollback or `DROP` is not supported; use a reviewed forward migration or
the approved provider restore procedure if a data migration is required.

## Controlled rollout procedure

### 1. Preflight and approvals

1. Confirm the proposed currency, ISO minor-unit precision, locale, customer
   countries, settlement currency and payment methods.
2. Obtain tax/legal, accounting, payment-provider and support approval. Attach
   links to the reviewed decision, not secret values or customer financial data.
3. Confirm the proposed Stripe Price is active, recurring, the correct interval,
   the correct product and the expected currency in the intended account and
   mode. Use a separate test-mode price for staging.
4. Confirm a support owner, incident owner, rollback owner and communication
   copy before opening the pilot.
5. Confirm production backup retention and complete a disposable backup restore.
   Record the backup timestamp/identifier and restore result in the release
   record. Never record a database password or exported customer data there.
6. Run the exact-money and alternate-currency test matrix. Any floating-point
   drift, rounding mismatch, import loss or export discrepancy is a release
   stop.

### 2. Staging rehearsal

1. Apply the migration through the reviewed workflow in a disposable or staging
   Supabase project; do not edit production SQL directly.
2. Keep `AUD` enabled and enable exactly one pilot currency in the staging
   catalog and browser configuration.
3. Test empty-budget creation, legacy AUD migration, non-empty currency-change
   rejection, local persistence, cloud sync, conflict handling, backup import,
   CSV/XLSX/PDF/JSON exports, checkout, webhook entitlement, cancellation,
   refund and reconciliation.
4. Verify that a mismatched Stripe price is rejected before checkout and that a
   provider failure does not grant entitlement.
5. Test the rollback procedure against a disposable copy, including the case
   where a customer already has pilot-currency data. Do not assume that simply
   removing a feature flag makes existing records readable.
6. Capture test results, migration version, deployed function versions and the
   exact configuration used. Promote only reviewed artifacts.

### 3. Production canary

1. Merge the reviewed change through the protected `main` process and confirm
   all required CI/security checks.
2. Verify the production backup/restore evidence again immediately before the
   migration. If backup evidence is stale or unavailable, stop.
3. Start the manual protected production workflow only after the release owner
   records approval. Confirm migrations and Edge Function deployments before
   changing the product allowlist.
4. Keep new-currency selection disabled while checking the deployed schema,
   function health and monitoring events.
5. Enable one currency for a small, explicitly recorded cohort. Keep AUD users
   as the comparison path and avoid enabling multiple currencies in the same
   change.
6. Observe the pilot for the pre-agreed review window. Do not expand the cohort
   while any critical error, unexplained revenue difference, refund mismatch or
   data-integrity concern is open.

## Monitoring and stop conditions

Record metrics by currency and compare the pilot with the AUD control where the
comparison is meaningful. Do not log budgets, transaction descriptions or other
customer financial data.

- **Payment success:** checkout starts, completed payments, provider declines,
  price-contract mismatches, webhook delivery and entitlement-grant failures.
- **Conversion errors:** parse/rounding failures, rejected currency metadata,
  sync invariant errors, migration errors and report/export failures.
- **Refunds and cancellations:** requested, accepted and failed refunds in the
  original billing currency; cancellation and period-end entitlement behavior.
- **Revenue reconciliation:** Stripe totals against the internal subscription
  ledger by currency, including fees, refunds, credits and timing differences.
- **Support signals:** tickets by currency and issue type, setup confusion,
  incorrect price display, checkout failure, missing data, export problems and
  requests for manual conversion.

Define numeric alert thresholds and the review window in the approval record
before activation. Pause new-currency acquisition immediately for any suspected
cross-currency data exposure, incorrect entitlement, payment-price mismatch,
refund/reconciliation discrepancy or unexplained precision error. Escalate to
the incident owner; do not repair customer financial records manually from a
support ticket.

### Revenue and support review cadence

During a pilot, the release owner must review the following at least daily and
record the result by currency without customer financial data:

1. Match successful charges and refunds from the provider to the internal
   subscription ledger using provider IDs, currency and minor-unit amounts.
2. Separate pending, failed and replayed webhooks from reconciled events; do
   not grant or remove access from an unverified event.
3. Compare provider totals with the ledger before and after credits, refunds,
   fees and timing differences. Escalate any unexplained difference before
   expanding the cohort.
4. Review support tickets for display, rounding, sync/import, payment, refund
   and “please convert this budget” requests. Record only safe identifiers and
   route financial decisions to accounting or the payment owner.

Use this escalation order: support owner for copy or setup questions; release
owner for configuration, conversion or export failures; payment owner and
accounting for charges, refunds or reconciliation; security/incident owner for
cross-household exposure or an entitlement/data-integrity concern. A suspected
cross-currency exposure, wrong entitlement, Price mismatch or unexplained
rounding error is a stop condition, not a normal support workaround.

## Rollback and recovery

Rollback is deliberately conservative because the migration introduces durable
currency metadata and existing pilot-currency documents may depend on it.

1. Stop new pilot-currency selection and checkout first. Preserve AUD and do not
   remove a currency from the runtime allowlist until existing pilot records are
   proven readable by the fallback version.
2. If the issue is billing-only, stop the affected checkout path and keep the
   previously reviewed Stripe price unchanged. Reconcile provider events before
   granting or revoking access.
3. If the web release is faulty, use the hosting provider's last-known-good
   deployment rollback to the AUD-compatible version. Confirm that the selected
   version can read the deployed schema before serving it to customers.
4. The migration has no tested destructive down migration. Do not improvise a
   `DROP` or direct SQL reversal in production. Use a reviewed forward migration
   or the approved provider restore procedure after impact assessment.
5. Preserve affected records and exports, record the deployment/version,
   migration, event IDs and safe error identifiers, and notify customers using
   the approved incident template. Never put raw budgets or secrets in the
   incident record.
6. Re-open the release gates only after the root cause, data review, recovery
   test and support communication have been approved.

## Support and help guidance

### Customer-facing copy

Use this wording until a currency pilot is approved:

> Harbourline currently supports AUD, NZD and USD for budgeting. The introductory
> subscription remains billed in AUD. Additional currencies are being evaluated
> and are not available unless they appear in your approved account experience.
> Harbourline does not convert budgets or exchange money for you.

> Changing a budget currency never converts existing records. Start a new empty
> budget if you need a different currency, and keep your original export.

Do not describe built-in currency metadata, a browser selector, or a future
catalog row as global availability. Do not show a non-AUD price unless the
matching Stripe Price, tax treatment, refund wording and support process have
been approved.

### Triage checklist

For a currency-related support request, capture only the currency code, page or
flow, approximate timestamp, deployment version and a safe error identifier.
Do not ask customers to email passwords, payment secrets, full exports or
screenshots containing account balances.

- **Wrong symbol or price:** confirm the deployed browser display variables and
  the provider Price contract; do not promise a conversion.
- **Currency change rejected:** explain that non-empty budgets are not silently
  converted; preserve the budget and offer the approved empty-budget path.
- **Sync or import rejected:** do not edit the JSON or database manually. Keep
  the original export and escalate with the safe error identifier.
- **Payment or refund question:** use the Stripe customer/subscription record
  and the original billing currency. Do not calculate an exchange-rate refund
  in support.
- **Suspected data loss or cross-household exposure:** stop the pilot, preserve
  evidence, notify the incident owner and follow the security response process.

Support must not ask for passwords, payment secrets, full exports, raw budget
values or screenshots containing balances. Capture the currency code, affected
flow, approximate timestamp, deployment/version and safe error identifier only.

## Release record

Every approved activation must record, without secrets or customer financial
data:

- repository commit, PR and CI/security check links;
- migration and Edge Function versions;
- browser allowlist and database catalog change;
- proposed currency, locale, minor-unit precision and provider Price identity;
- backup/restore evidence and migration compatibility result;
- approval owners for product, tax/legal, accounting, payment and support;
- canary cohort and review window;
- payment, conversion, refund, reconciliation and support metrics;
- decision to expand, pause or roll back.

Until the pilot evidence and owner record are complete, do not expand beyond
`AUD,NZD,USD` or change subscription billing from AUD.
