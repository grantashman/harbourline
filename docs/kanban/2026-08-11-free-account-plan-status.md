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

- [x] A verified account with no Stripe subscription resolves to a stable free/local state; it does not remain in CHECKING or CONFIRMING. Covered by the pure reconciliation regression; authenticated production confirmation remains the one user-session check.
- [x] Paid active/trialing subscriptions still reach the paid/active state and retain cloud-access gating.
- [x] Billing lookup failures remain visible as an actionable error and do not grant paid access.
- [x] A deterministic regression test fails on the pre-fix behavior and passes after the fix.
- [x] Targeted tests, full repository checks, and the production build pass.
- [x] The reviewed fix is merged to `main`.
- [x] Supabase production migrations/functions are deployed through the protected workflow.
- [ ] Authenticated production smoke verification confirms the disposable free-account journey; public app availability and signup form are verified, but this browser session does not contain the test account.

## Work board

| Column | Card | Owner | Status / evidence |
| --- | --- | --- | --- |
| **Done** | Trace account-panel state transitions and identify the UI contract that maps billing results to CHECKING/CONFIRMING | Frontend investigator | Confirmed `billingReconciled=false` plus `subscriptionActive=false` renders CHECKING/CONFIRMING; no separate UI defect found |
| **Done** | Trace `reconcile-billing-subscription`, Stripe lookup, and free-account response semantics | Billing/backend investigator | Confirmed no Stripe subscription returned `reconciled:false`; successful no-candidate lookups now resolve as free |
| **Done** | Define deterministic regression coverage and release verification commands | QA/release investigator | No AccountPanel harness exists; added pure reconciliation regression and explicit Edge Function checks |
| **Done** | Coordinate root-cause confirmation and implement the smallest fix | Ajax | Reconciler contract fixed; pre-existing Stripe webhook return-type error fixed so all billing functions type-check |
| **Done** | GitHub push / issue or PR operations | Ajax + Grant OAuth | PR [#44](https://github.com/grantashman/harbourline/pull/44) merged to `main` as `b193225`; required CI/security checks passed |
| **Done** | Supabase production workflow / live Edge Function verification | Ajax + Grant OAuth | Protected workflow [run 31485619434](https://github.com/grantashman/harbourline/actions/runs/31485619434) passed migrations, Stripe price guard, and all Edge Function deployments |
| **Done** | Vercel production deployment verification | Ajax + Grant OAuth | `main` commit status reports deployment completed: [Vercel deployment](https://vercel.com/grantashmans-projects/harbourline/DnC8xgwJFB6xiyRZ1UCa87jPA9Rv) |
| **Not required unless evidence changes** | Stripe dashboard inspection | Ajax + Grant | Local code is sufficient for the initial diagnosis; Stripe OAuth will be requested only if live subscription data or webhook delivery must be inspected |

## Release evidence

- Fix merged: `b193225` via [PR #44](https://github.com/grantashman/harbourline/pull/44)
- Main CI: [run 31485495171](https://github.com/grantashman/harbourline/actions/runs/31485495171) passed
- Main security checks: [run 31485495212](https://github.com/grantashman/harbourline/actions/runs/31485495212) passed
- Supabase production: [run 31485619434](https://github.com/grantashman/harbourline/actions/runs/31485619434) passed
- Vercel production: [deployment completed](https://vercel.com/grantashmans-projects/harbourline/DnC8xgwJFB6xiyRZ1UCa87jPA9Rv)
- Public smoke check: `https://harbourline.app` loaded the auth gate and free-account form
- Remaining check: sign in with the disposable free account and confirm Account & household shows stable free/local status rather than CHECKING/CONFIRMING

## Scope and safety

- Do not record account passwords, tokens, payment details, budget values, or personal financial data.
- Do not change production data manually in Supabase or Stripe.
- Do not weaken authentication, subscription reconciliation, or paid-access checks to make the UI look active.
- External OAuth/access requests must be explicit and tied to a blocked verification or deployment step.
