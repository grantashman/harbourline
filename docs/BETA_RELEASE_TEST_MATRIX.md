# Harbourline Paid Early-Access Release Matrix

This matrix is the release record for staging and the first production cohort.
Run every scenario with disposable test accounts before inviting a real paid
member. Evidence must contain links or identifiers only; never record budget
amounts, household names, account numbers or personal financial information.

## Entry criteria

- The application build passed `pnpm check`.
- Supabase migrations and Edge Functions are deployed to the target environment.
- Stripe test or live mode matches the environment being tested.
- A support owner, recovery owner and incident contact are named outside this
  document.

## Customer journey and account safety

| Scenario | Environment | Steps | Expected result | Evidence link | Result |
| --- | --- | --- | --- | --- | --- |
| Password signup and confirmation | Staging | Create a new account from the public homepage and confirm the email | Account is created once, confirmation returns to the hosted app, and no secret appears in the browser | — | Not run |
| Google sign-in | Staging | Start Google sign-in from the public homepage and return to the app | One authenticated Harbourline account is available and the account panel opens | — | Not run |
| Checkout | Staging | Sign in, select the single plan and complete Stripe test checkout | Checkout succeeds once and returns to the hosted app with payment confirmation pending or active | — | Not run |
| Payment receipt and access | Staging | Wait for the checkout webhook, refresh and open the workspace | The subscription row becomes active and the paid workspace unlocks without manual database edits | — | Not run |
| Onboarding resume | Staging | Start onboarding, sign out, sign back in and reopen the app | The flow resumes at the last saved step and does not duplicate the household | — | Not run |
| Free Starter first-value activation | Staging | Create a verified free account, add income and three regular commitments through the Free Starter | The first payday plan opens and `free_starter_activation_completed` is recorded without financial values | — | Not run |
| Paid beta five-bill depth | Staging | Add income and five regular bills through paid onboarding | The stricter five-bill activation milestone is recorded without financial values | — | Not run |
| Support mail link | Staging | Open the support link and inspect the generated message | The link opens the configured support address and warns against sending passwords or budget exports | — | Not run |
| Household sharing | Staging | Create a household, invite a second account and accept the invite | The member can choose a device or household copy and both accounts see only the shared household | — | Not run |
| Offline sync and conflict | Staging | Edit offline, reconnect, then make competing edits on two devices | Queued edits upload safely and a genuine conflict presents an explicit version choice | — | Not run |
| Owner dashboard denial | Staging | Call the operator endpoint as an ordinary authenticated member | The response is HTTP 403 and no aggregate data is returned | — | Not run |
| Owner dashboard access | Staging | Call the operator endpoint as a configured operator | Only aggregate metrics and daily event counts are returned; no customer identifiers or financial values appear | — | Not run |

## Billing lifecycle and recovery

| Scenario | Environment | Steps | Expected result | Evidence link | Result |
| --- | --- | --- | --- | --- | --- |
| Payment failure | Staging | Use Stripe test tools to fail an invoice payment | The subscription status changes according to the documented grace-period policy and the customer sees a clear next action | — | Not run |
| Payment recovery | Staging | Correct the payment method and retry the invoice | Access is restored once the authoritative subscription status is active; no duplicate welcome or recovery event is created | — | Not run |
| Cancellation at period end | Staging | Cancel through the customer billing portal | Cancellation is scheduled, access remains until the period end, and household data is preserved | — | Not run |
| Refund | Staging | Issue a test refund through Stripe | The documented refund treatment is applied and access/data handling is recorded without manual database editing | — | Not run |
| Webhook replay | Staging | Re-send a processed Stripe event | Stripe receives HTTP 200; no duplicate subscription state, operational event or lifecycle email is created | — | Not run |
| Unknown webhook event | Staging | Send a validly signed unsupported event | The event is acknowledged safely and does not change subscription access | — | Not run |

## Data rights and recovery

| Scenario | Environment | Steps | Expected result | Evidence link | Result |
| --- | --- | --- | --- | --- | --- |
| Account export | Staging | Download an account copy while signed in | A complete export downloads without exposing another account or logging financial values | — | Not run |
| Account deletion | Staging | Resolve household ownership, enable MFA and delete the account | The account and permitted data are deleted, the cached device copy is clearly explained, and no household is orphaned | — | Not run |
| Backup restore | Staging | Restore a disposable backup into a disposable environment | The expected test records return and production credentials are not involved | — | Not run |
| Production smoke test | Production | Use the first-member rehearsal account for signup, payment, access, export and cancellation | Every production surface points at production services and the rehearsal account is removed afterwards | — | Not run |

## Exit decision

Paid early access is approved only when every applicable row passes, legal and
accounting approvals are recorded, live credentials are separate from staging,
monitoring alerts are verified, and a restore rehearsal has succeeded.
