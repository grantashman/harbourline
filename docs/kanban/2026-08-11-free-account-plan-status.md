# Kanban: Free-account plan status stuck in CHECKING

**Opened:** 2026-08-11  
**Reported surface:** Harbourline `Account & household` panel  
**Repository:** `grantashman/harbourline`  
**Priority:** Release-blocking signup regression

## User-visible symptom

A newly created free-user account reaches the hosted app and opens the account panel, but remains in:

- Account status: **CHECKING** / “Checking your plan”
- Harbourline plan: **CHECKING**
- Action state: **CONFIRMING**
- Action: **Check plan status**

The account is shown as online. No paid subscription was intentionally created for this free-user test.

## Acceptance criteria

- [ ] A verified account with no Stripe subscription reaches a stable free/local state; it does not remain in CHECKING or CONFIRMING.
- [ ] Paid active/trialing subscriptions still reach the paid/active state and retain cloud-access gating.
- [ ] Billing lookup failures remain visible as an actionable error and do not grant paid access.
- [ ] A deterministic regression test fails on the pre-fix behavior and passes after the fix.
- [ ] Targeted tests, full repository checks, and the production build pass.
- [ ] The reviewed fix is pushed to `main`.
- [ ] Supabase production migrations/functions are deployed through the protected workflow if the change touches them.
- [ ] Production smoke verification confirms the free-account journey.

## Work board

| Column | Card | Owner | Status / evidence |
| --- | --- | --- | --- |
| **Done** | Trace account-panel state transitions and identify the UI contract that maps billing results to CHECKING/CONFIRMING | Frontend investigator | Confirmed `billingReconciled=false` plus `subscriptionActive=false` renders CHECKING/CONFIRMING; no separate UI defect found |
| **Done** | Trace `reconcile-billing-subscription`, Stripe lookup, and free-account response semantics | Billing/backend investigator | Confirmed no Stripe subscription returned `reconciled:false`; successful no-candidate lookups now resolve as free |
| **Done** | Define deterministic regression coverage and release verification commands | QA/release investigator | No AccountPanel harness exists; added pure reconciliation regression and explicit Edge Function checks |
| **Done** | Coordinate root-cause confirmation and implement the smallest fix | Ajax | Reconciler contract fixed; pre-existing Stripe webhook return-type error fixed so all billing functions type-check |
| **Blocked when needed** | GitHub push / issue or PR operations | Ajax + Grant OAuth | `git push --dry-run` is blocked because no GitHub credential is configured in this environment |
| **Blocked when needed** | Supabase production workflow / live Edge Function verification | Ajax + Grant OAuth | Protected workflow requires Supabase/GitHub production access; no credentials are being guessed |
| **Blocked when needed** | Vercel production deployment verification | Ajax + Grant OAuth | Push may trigger the existing integration; direct verification will require access if public smoke checks are insufficient |
| **Not required unless evidence changes** | Stripe dashboard inspection | Ajax + Grant | Local code is sufficient for the initial diagnosis; Stripe OAuth will be requested only if live subscription data or webhook delivery must be inspected |

## Scope and safety

- Do not record account passwords, tokens, payment details, budget values, or personal financial data.
- Do not change production data manually in Supabase or Stripe.
- Do not weaken authentication, subscription reconciliation, or paid-access checks to make the UI look active.
- External OAuth/access requests must be explicit and tied to a blocked verification or deployment step.
