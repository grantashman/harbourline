# Paid Beta Foundation Design

Date: 31 July 2026
Status: approved design, awaiting written-spec review

## Goal

Prepare Harbourline for public signup and payment while measuring whether new
members reach their first useful payday plan and return each week. Signup stays
open. The team monitors demand and support load instead of enforcing a member
cap.

The first paid-beta milestone is 20 paying households. A successful household
creates an account, pays, adds income and five bills, then sees its first payday
plan without support intervention.

## Scope

This release has four parts:

1. A resumable first-run setup for new paid members.
2. Branded account, billing and support communication.
3. Privacy-safe operational events and an owner-only beta dashboard.
4. Production separation, recovery checks and a repeatable release test.

It does not add new financial-planning features, bank feeds, extra price tiers,
in-app chat or financial-product recommendations.

## First-Run Setup

### Entry and access

- A user reaches setup after a confirmed active subscription and no selected
  household with a completed onboarding record.
- Existing households and existing members retain the current Harbourline
  dashboard and never see forced onboarding.
- The setup state resumes after refresh, sign-out or a later sign-in.
- A user cannot use the setup flow to bypass the subscription entitlement.

### Steps

1. **Household**: enter a household name. The app creates or selects the
   household and saves progress.
2. **Income**: add one income source, its amount, frequency and next pay date.
3. **Essential bills**: add up to five recurring bills. The user may continue
   after one bill, but the UI explains that five bills produces a more useful
   first plan.
4. **First payday plan**: show the existing payday view with income, bill
   provisions, savings allocation and safe-to-spend position. The user marks
   setup complete from this view.

The flow uses the existing household and budget-document APIs. It adds no new
financial calculation. A small onboarding record stores only the current step,
completion timestamp and user/household identifiers.

### Completion event

The application records `onboarding_completed` only when the user reaches the
payday view after adding at least one income and one bill. The beta dashboard
shows the stricter five-bill activation milestone separately.

## Customer Communication

### Messages

- Supabase sends branded email confirmation and password-recovery messages via
  Harbourline's controlled SMTP sender.
- Stripe sends payment receipts, invoices and payment-recovery messages.
- A server-side welcome message sends after the subscription becomes active.
- A cancellation message confirms end-of-period access and preserves export
  and deletion instructions.

The welcome and cancellation messages use a Harbourline-controlled email
provider and sender address. The release configuration requires a verified
domain, `HARBOURLINE_FROM_EMAIL` and `HARBOURLINE_SUPPORT_EMAIL`. No address
is hard-coded in the client.

### Support

Every signed-in customer can open one support email link with their account
email prefilled as the reply-to address. The request must not include a budget
export, transaction description, income amount or other financial data.

## Privacy-Safe Operational Events

### Event catalog

The beta dashboard derives `account_created` from the authorised account
creation timestamp. It records the following operational events with a
timestamp, user ID and optional household ID:

- `checkout_started`
- `subscription_activated`
- `onboarding_started`
- `household_created`
- `income_added`
- `five_bills_added`
- `payday_viewed`
- `onboarding_completed`
- `support_requested`
- `subscription_past_due`
- `subscription_cancelled`

Event payloads contain no monetary value, bill name, category, financial note,
address or device fingerprint.

### Data and access

`beta_operational_events` is a new private database table. Users cannot query
or modify it directly. `create-checkout-session` records checkout starts,
Stripe webhooks record subscription lifecycle events, and a JWT-protected event
function accepts a fixed allowlist of onboarding and support events. An
operator-only Edge Function returns aggregate counts and recent operational
failures.

The operator function authorises a small allowlist of Harbourline operator
emails held in an Edge Function secret. It never returns household financial
data or customer budget documents. The web app shows the operator view only to
that authorised role.

### Beta dashboard

The owner dashboard displays:

- signups and checkout starts
- active paid households
- payment failures and cancellations
- first-run completion rate
- five-bill activation rate
- recent support requests

It groups metrics by day and month. It contains counts and timestamps only.

## Release Safety

### Environment separation

- A staging Supabase project and Stripe test account handle checkout, webhook
  and recovery rehearsals.
- Production uses separate Supabase, Stripe, SMTP and error-monitoring
  credentials.
- Vercel preview deployments use staging browser configuration. Production
  deployments use production browser configuration.
- CI checks reject missing deployment-mode values and never print secrets.

### Monitoring and alerts

- Frontend errors, Edge Function errors and failed webhook processing go to a
  production error-monitoring service with financial fields removed before
  transmission.
- Alerts notify the operator of checkout failures, repeated sign-in failures,
  unprocessed webhook errors and payment failures.
- Error reports include request type, deployment mode and safe identifiers.
  They exclude budget state, entered text and currency amounts.

### Recovery

- Production uses provider backups plus a documented encrypted off-site logical
  database export.
- Before live billing, the team rehearses restore, account export, account
  deletion, cancellation, refund, failed-payment recovery and webhook replay.
- The incident checklist names the responsible person, the first response
  action, customer communication path and service-restoration test.

## Acceptance Criteria

The release is ready for public paid beta when:

1. A new visitor can sign up, confirm an account, pay, complete setup and see a
   payday plan in staging without manual database changes.
2. A returning member resumes unfinished setup and existing members keep their
   current dashboard.
3. The owner dashboard shows the approved aggregate events without financial
   data.
4. A payment failure, cancellation, password recovery and webhook replay leave
   household data intact and grant access only when the subscription allows it.
5. The staging release test passes for password and Google sign-in paths.
6. Production configuration uses distinct credentials, backups are verified and
   the legal, accounting and customer-contact launch items are complete.

## Testing

- Unit tests cover onboarding-state transitions, event payload validation and
  operator authorisation.
- Database tests confirm customers cannot read or insert operational events and
  unrelated households remain isolated.
- Edge Function tests cover event insertion, dashboard aggregation and denied
  operator access.
- A manual staging test uses Stripe test cards for signup, payment, cancellation
  at period end, failed payment, recovery, refund and webhook replay.
- A browser smoke test verifies the first-run flow at desktop and mobile widths.

## Delivery Sequence

1. Add database schema, row-level security and operational-event functions.
2. Build the resumable onboarding flow and event capture.
3. Add the operator dashboard and customer support entry point.
4. Configure branded SMTP, customer lifecycle messages and safe error
   monitoring.
5. Add staging/production deployment validation and the beta release checklist.
6. Run the full staging test matrix, review the results, then publish the
   production release.
