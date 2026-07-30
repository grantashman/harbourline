# 0003: Subscription entitlements protect cloud features, not customer data

Status: accepted

## Decision

The single Harbourline subscription is attached to a household. Billing status may
control cloud-only capabilities such as synchronisation, history, reminders,
advanced comparisons and additional household members.

Subscription status must never control:

- reading the most recently synced household budget
- exporting household or account data
- transferring household ownership
- deleting a household or account
- retaining the browser cache needed for continuity and export

After cancellation, cloud writes may enter a documented grace period and then
become read-only. Existing data remains readable and portable until the
household owner deletes it under the retention policy.

Stripe identifiers and webhook payload metadata belong in private database
tables that are inaccessible to browser roles. The browser receives only a
small entitlement summary from a guarded server function.

Webhook handling must verify Stripe signatures, store event identifiers, and
apply each event idempotently. The webhook, not the browser redirect from
Checkout, is the authority for entitlement changes.

## Consequences

- A payment outage cannot erase or strand a household budget.
- The product has one clear Supabase-backed plan rather than free and paid tiers.
- Release 3 requires an entitlement read model before Checkout is exposed.
- Grace-period and retention rules must be written before paid beta launch.
