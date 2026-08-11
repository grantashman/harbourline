# Multi-currency release, operations and support

Last reviewed: 11 August 2026

## Release decision

**NO-GO for enabling additional currencies in production.** Harbourline remains an
AUD-first product and the production currency allowlist must remain `AUD` until
the financial-integrity, database, payment, tax, support and recovery gates in
this document are evidenced and approved.

This is a release runbook, not a deployment authorization. No production
migration, Edge Function deployment, Vercel deployment or additional-currency
cohort was executed for this release attempt.

### Current contract

- The safe browser and domain defaults enable `AUD` only.
- The database currency catalog seeds `AUD` as enabled and the additional catalog
  rows as disabled.
- Budget currency and subscription billing currency are separate. Budget
  currency does not trigger foreign-exchange conversion and does not change the
  reviewed introductory Stripe price.
- The current billing contract remains the weekly AUD price. Keep
  `STRIPE_BILLING_CURRENCY=aud` and the reviewed AUD `STRIPE_PRICE_ID` until a
  separate provider-price and commercial approval is recorded.
- Existing AUD records must remain readable through the compatibility path.
  Records must never be silently converted when a currency setting changes.

The local validation handoff recorded passing application, domain, sync, build,
PDF and schema checks and an AUD browser persistence smoke. It also recorded a
financial-integrity blocker: runtime calculations still use major-unit
JavaScript numbers in places, and a probe produced
`0.11999999999999998` for twelve `0.01` contributions. Supabase database tests,
Deno Edge Function tests and hosted payment/auth/reconciliation E2E were not
available in the validation environment. These are release blockers, not
successful production evidence.

## Required release gates

All gates below are required before changing the production allowlist. A local
build or a green AUD smoke test is not a substitute for a hosted gate.

| Gate | Evidence required | Current state |
| --- | --- | --- |
| Exact money calculations | Runtime aggregation, recurring conversions, reports and exports remain cent/minor-unit exact without major-unit float drift; include cent-boundary and zero-decimal tests | **Blocked** by the validation finding above |
| Domain and browser matrix | Legacy AUD restore, new empty-budget currency selection, non-empty-budget rejection, import/export, sync and report checks for every proposed currency | AUD-only local smoke passed; alternate-currency hosted behavior not verified |
| Database migration | Staging `supabase db push --linked`, `supabase test db`, policy/invariant checks and a documented forward-only rollback or restore procedure | **Not run**; Supabase CLI, local Postgres/pgtap and Docker were unavailable |
| Edge Functions and payment contract | Deno checks plus test-mode Stripe price/catalog, checkout, webhook, refund and reconciliation tests for each billing currency | **Not run**; Deno and hosted provider access were unavailable |
| Backup and restore | Provider backup retention confirmed, disposable restore completed, backup identifier recorded outside customer data, and migration compatibility checked | **Not evidenced**; the documented beta project previously reported Free/NANO with no scheduled backups |
| CI and review | Pull request, required CI/security checks, reviewed migration and protected production workflow run | No release PR or production workflow run exists for this attempt |
| Commercial and legal approval | Settlement, tax, refund, pricing, customer-location and support wording approved for each currency | Not approved |
| Staged cohort | One currency enabled for a small, named cohort with a control comparison and a pause owner | Not started |

Do not weaken a gate because the first pilot is small. A small cohort can still
create irreversible payment, accounting or customer-data problems.

## Configuration contract

Use the following boundaries and keep credentials out of browser configuration:

| Surface | Configuration | Rule |
| --- | --- | --- |
| Browser bootstrap | `globalThis.HarbourlineCurrencyConfig` with `enabledCurrencies`, `defaultCurrency` and `currencies` definitions | Defaults to `AUD`; always retain AUD for compatibility; do not inject a new production allowlist before approval |
| Database | `public.currency_catalog` (`code`, `minor_unit`, `default_locale`, `enabled`, `verified_at`, `verified_by`) | Enable one reviewed currency at a time; record who verified the row and when |
| Browser billing display | `VITE_HARBOURLINE_BILLING_CURRENCY` and `VITE_HARBOURLINE_BILLING_LOCALE` | Public display values only; they do not authorize a Stripe price or a budget currency |
| Edge Function billing authority | `STRIPE_BILLING_CURRENCY` and protected `STRIPE_PRICE_ID` | Checkout fetches and verifies the active recurring Stripe Price; no FX conversion is performed |
| Provider secrets | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and Supabase runtime secrets | Keep server-side; never place them in `VITE_*` variables or support tickets |

The browser allowlist, database catalog and user-facing copy must agree. A
currency appearing in built-in metadata is not evidence that it is enabled or
that a matching Stripe price exists. The Stripe price currency is also not
proof that budget calculations, refunds or reconciliation are correct.

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

> Harbourline is AUD-first. The current public release supports Australian
> dollars (AUD) for budgeting and the introductory subscription. Additional
> currencies are being evaluated and are not available unless they appear in
> your approved account experience. Harbourline does not convert budgets or
> exchange money for you.

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

Until that record exists and all gates pass, the only production enablement
recommendation is AUD-only.
