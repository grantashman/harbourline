# Harbourline Production Activation

This checklist promotes Harbourline from a test deployment to a controlled
Asia-Pacific beta environment. Sydney remains the preferred long-term region.
The beta currently uses Tokyo and that limitation must be recorded in the
privacy notice before external customers are invited.

For the commercial launch sequence, member-level cost model and profitability
thresholds, see
[`PRODUCTION_AND_PROFITABILITY.md`](PRODUCTION_AND_PROFITABILITY.md).

## Current controlled-beta checkpoint — 1 August 2026

The following public deployment identifiers were verified during the controlled
beta activation. Secret values remain in Supabase and Vercel only.

- public homepage: `https://www.harbourline.app`
- hosted app: `https://harbourline.app`
- legacy rollback app: `https://harbourline-zeta.vercel.app`
- Supabase project: `mnnppxznopuoqverlsex`
- Supabase API host: `https://mnnppxznopuoqverlsex.supabase.co`
- Supabase region: Northeast Asia (Tokyo), `ap-northeast-1`
- Google Cloud project: `harbourline-auth`
- Google Calendar callback: `https://mnnppxznopuoqverlsex.supabase.co/functions/v1/google-calendar-callback`
- live introductory Stripe price: `price_1U2AOcBha937Q1NNu8HrnIRJ` (A$2.50/week)

The `google_calendar_sync` migration and all five Google Calendar Edge
Functions are deployed. The project currently reports Supabase Free/NANO with
no scheduled backups; upgrading to a non-pausing production plan remains a
launch decision before opening the beta beyond a controlled cohort.

The domain migration is being staged with the new app domain as canonical and
the old Vercel URL retained for rollback. Google Workspace root email records
remain intact; Resend uses the isolated `auth.harbourline.app` sending
subdomain.

Resend DNS records were added in Cloudflare for `auth.harbourline.app`:

- DKIM TXT: `resend._domainkey.auth.harbourline.app`
- SPF MX/TXT: `send.auth.harbourline.app`
- Optional DMARC TXT: `_dmarc.auth.harbourline.app`

Resend still reports the domain as pending while DNS verification propagates.

## Multi-currency release status — 12 August 2026

The owner-authorized budgeting pilot enables `AUD`, `NZD` and `USD` in the
browser allowlist and database catalog. Subscription billing remains the reviewed
AUD Stripe contract; no non-AUD Stripe Price is enabled by this release.

The current `main` head `922507e47d41dfd9ca26bbdfd7d6d8c3b94ee2f3` passed the
required exact-head CI, security, dependency-review and preview checks. The
protected [production workflow run](https://github.com/grantashman/harbourline/actions/runs/31552755896)
completed successfully and verified that the remote database was up to date,
the reviewed AUD billing contract was configured, the Edge Functions were
deployed, and the production schema enabled exactly `AUD`, `NZD` and `USD` for
budgeting. The live browser surface also serves the paired `AUD,NZD,USD`
configuration with AUD as the default.

Do not expand beyond NZD/USD budgeting or change subscription billing until the
exact-money browser/export matrix, staging and hosted payment/refund/reconciliation
tests, backup/restore evidence, and product, tax/legal, accounting and support
approvals are recorded.

The release runbook, staged activation procedure, monitoring fields, support
responses and rollback constraints are in
[`MULTI_CURRENCY_RELEASE.md`](MULTI_CURRENCY_RELEASE.md). It records the
verified NZD/USD budgeting pilot and the remaining gates for any further
currency expansion or billing-currency change.

## 1. Confirm the beta project

The existing project may be used for the controlled beta with:

- name: `Harbourline`
- region: Northeast Asia (Tokyo), `ap-northeast-1`
- its database password stored in a password manager
- email confirmation enabled

Before wider launch, review whether Australian data residency is required and
create a Sydney project if appropriate. A Supabase project's primary region
cannot be changed after creation.

## 2. GitHub production integration

The repository contains a manual production workflow at
`.github/workflows/supabase-production.yml`. It runs only when deliberately
started from GitHub Actions in the protected `production` environment.

Add these GitHub Actions secrets to the `production` environment:

- `SUPABASE_ACCESS_TOKEN`: a Supabase personal access token
- `SUPABASE_PROJECT_REF`: the Harbourline project ref
- `SUPABASE_DB_PASSWORD`: the production database password

The hosted Vercel application and Supabase Edge Functions require separate
environment configuration. Configure the following names in the appropriate
environment; never commit their values:

Frontend build variables:

```text
VITE_HARBOURLINE_DEPLOYMENT=staging|production
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_HARBOURLINE_STAGING_SUPABASE_URL
VITE_HARBOURLINE_SUPPORT_EMAIL
VITE_HARBOURLINE_BILLING_CURRENCY (public display; default AUD)
VITE_HARBOURLINE_BILLING_LOCALE (public display; default en-AU)
VITE_SENTRY_DSN
VITE_HARBOURLINE_RELEASE
```

Currency rollout configuration is separate from billing configuration. The
hosted document bridge may receive a pre-bootstrap
`globalThis.HarbourlineCurrencyConfig` object with `enabledCurrencies`,
`defaultCurrency` and `currencies` definitions. The safe production value is
`enabledCurrencies: ["AUD", "NZD", "USD"]`; AUD must always remain available for
legacy records. The matching database control is `public.currency_catalog`, where a
row must include its ISO code, minor-unit precision, locale, verification
identity and timestamp before it can be enabled. Do not put secrets in this
object or in any `VITE_*` variable.

Use this safe production bootstrap and keep it paired with the database state:

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

The browser bridge calls the locale field `locale`; the domain package calls
the equivalent field `defaultLocale`. The eleven built-in definitions are
metadata only. Enabling a code requires a reviewed migration, a matching
catalog row, exact-money evidence, and an approved pilot record. Budget
enablement does not authorize a non-AUD subscription price.
Removing a code from the browser allowlist pauses new selection but must not
make existing documents unreadable.

Edge Function secrets:

```text
HARBOURLINE_DEPLOYMENT=staging|production
HARBOURLINE_APP_URL
HARBOURLINE_OPERATOR_EMAILS
HARBOURLINE_SUPPORT_EMAIL
HARBOURLINE_FROM_EMAIL
RESEND_API_KEY
SENTRY_DSN
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY
STRIPE_BILLING_CURRENCY (AUD until a reviewed non-AUD Stripe price is approved)
STRIPE_PRODUCT_ID (reviewed Stripe product identity)
STRIPE_LIVE_MODE (true for live, false for test mode)
```

The Edge Function runtime also receives the public `STRIPE_PRICE_ID` from the
protected GitHub production variable; it is configuration, not a credential,
and must not be added to the secret inventory above.

`STRIPE_PRICE_ID` is a non-secret production environment variable in GitHub
(`vars.STRIPE_PRICE_ID`) and is copied into the Edge Function runtime environment by
the protected deployment workflow. It must remain the verified live price ID;
do not store it as a GitHub secret or replace it with a test-mode price.

Staging and production must use different Supabase projects, Stripe modes,
webhook signing secrets, email sender configuration and monitoring
environments. The browser deployment check rejects a production build that
matches the configured staging Supabase URL.

The workflow links the project, applies migrations in timestamp order, and
deploys all Edge Functions. Keep the database password and access token in the
GitHub environment only; never commit them or place them in frontend variables.

For the multi-currency migration, the workflow is not a rollback mechanism. It
has no tested destructive down migration. Run it only after the disposable
backup restore, staging migration, database tests and forward-only recovery
procedure in [`MULTI_CURRENCY_RELEASE.md`](MULTI_CURRENCY_RELEASE.md) are
recorded. Keep the production allowlist and database catalog paired; the current pilot is
`AUD,NZD,USD`, while subscription billing remains AUD.
The repository CI still runs application, domain, sync, schema and production
build checks independently.

For a currency pilot, deploy the reviewed migration and Edge Functions before
changing the browser allowlist. Verify the catalog row, the active Stripe Price
and function health, then enable exactly one code for the named cohort. To pause
or roll back, stop new selection and checkout first, preserve `AUD`, keep any
existing pilot-currency read path available, reconcile open provider events and
use a reviewed forward migration or provider restore. This workflow has no
tested destructive down migration; never improvise `DROP` statements in the
production SQL editor.

The current beta project is also linked to `grantashman/harbourline` through
Supabase. The dashboard currently reports the calendar migration and functions
as deployed. Keep the protected workflow as the reviewed fallback until its
production environment secrets are configured and its first manual run is
recorded.

## 3. Release database and function changes

1. Create a timestamped migration in `supabase/migrations/`.
2. Update or add Edge Functions under `supabase/functions/`.
3. Run `pnpm check` when local verification is available.
4. Open and review a pull request.
5. Merge the reviewed change into `main`.
6. Start **Deploy Supabase production** from GitHub Actions.
7. Confirm the migration and Edge Function deployments succeeded before
   enabling the related product surface.

Do not edit the production schema directly in the SQL editor after this
activation. If an emergency manual change is unavoidable, immediately capture
the same change in a migration and reconcile the migration ledger before the
next merge.

## 4. Configure authentication

- set the exact production site URL and redirect URLs
- use a custom SMTP provider on a Harbourline-controlled domain
- disable SMTP link tracking
- brand confirmation, magic-link and recovery emails
- set sensible password, OTP and rate-limit controls
- enable CAPTCHA before homepage-led account requests and signup launch
- enforce MFA for Supabase and GitHub administrators

### Transactional email coverage

The production account journey has these email paths:

- Supabase confirmation email after password signup;
- Supabase magic-link email for passwordless access;
- Supabase recovery email returning to the password-reset screen;
- Stripe lifecycle email when a subscription becomes active, enters `past_due`,
  or is cancelled;
- an operator notification after a new account completes email verification or
  its first OAuth/magic-link sign-in; and
- support and household invite links rendered by the app.

The signup notification is idempotent per user and contains only the account
email, provider and timestamp. It sends to `HARBOURLINE_OPERATOR_EMAILS` via
Resend and records delivery only after Resend accepts the request. A temporary
Resend failure remains retryable on a later authenticated session. Household
invites remain private, expiring codes by design; the app does not send a
customer-entered invite address to a marketing or email provider.

## 5. Rehearse recovery

Before inviting customers:

- use a Supabase production plan that cannot be paused for inactivity
- confirm the backup retention available on the selected plan
- take and restore a test backup
- document who owns an incident and how customers are notified
- test export and deletion with MFA
- test household ownership transfer before account deletion
- confirm a cancelled subscription never deletes a household budget

## 5a. Enable repository safeguards

The repository runs CodeQL, dependency review and Dependabot from `.github`.
Before inviting the first paid beta cohort:

1. In GitHub, open **Settings > Code security and analysis** for
   `grantashman/harbourline`.
2. Enable secret scanning, push protection and private vulnerability reporting.
3. In **Settings > Branches**, protect `main` and require the Harbourline CI,
   CodeQL and dependency-review checks before a pull request can merge.
4. Review the Security tab each week and rotate any credential that is exposed.

## 6. Activate the hosted app

Set the hosted web application's public environment values:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Build the production PWA and verify registration, confirmation, sign-in,
first-copy selection, offline queueing, conflict handling, invitations,
export and account deletion.

The Vercel deployment applies the response security policy in `vercel.json`.
Keep its `connect-src` limited to the production Supabase project, and review
the policy before adding analytics, payment widgets or any other third-party
browser integration.

## 7. Activate customer signup and billing

The public homepage creates accounts. Enable and brand the Google and Azure
(Microsoft) providers in the Harbourline authentication settings, and add the
GitHub Pages URL and hosted app URL to the provider redirect allowlists.

Create one recurring Stripe price for A$2.50/week. Do not attach a coupon or
trial to the introductory price. Store the public Stripe price ID as the protected
GitHub production environment variable `vars.STRIPE_PRICE_ID`; the deployment
workflow copies it into the Edge Function runtime environment. Keep secret billing
values only as Edge Function secrets:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
HARBOURLINE_APP_URL
```

Deploy `create-checkout-session` and `stripe-webhook`, then register the
webhook endpoint for checkout completion and subscription create, update and
delete events. Confirm the webhook signature and replay handling in Stripe's
test mode before enabling live payments.

The hosted application has now reached the paid-beta source release. Before
opening paid signup, deploy the Supabase migration and functions from the
protected workflow, configure the required Edge Function secrets, and complete
the first-member billing rehearsal. Keep immediate cancellation and plan
switching disabled for the single-plan launch.

Budget currency is independent from the subscription price. The current public
release supports AUD, NZD and USD for budgeting and performs no foreign exchange;
the introductory subscription remains billed in AUD. Do not display or enable a
non-AUD subscription price until a matching Stripe Price, tax/legal treatment,
refund wording, reconciliation check and support response have been approved;
follow [`MULTI_CURRENCY_RELEASE.md`](MULTI_CURRENCY_RELEASE.md) for the staged
procedure.

To activate Google Calendar sync, enable the Google Calendar API, configure the
OAuth consent screen and an OAuth web client, then add the exact callback URL
`${GOOGLE_OAUTH_REDIRECT_URI}` to Google's authorised redirect URIs. The
callback should be the deployed `google-calendar-callback` Edge Function URL.
Generate a random 32-byte base64url key for
`GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`. The app only requests the
`calendar.events` scope and syncs generic all-day payday and bill-due events by
default. Customers can opt in to expense names in bill titles from the account
panel.

Record each rehearsal in
[`BETA_RELEASE_TEST_MATRIX.md`](BETA_RELEASE_TEST_MATRIX.md). Configure Sentry
alerts for frontend exceptions, Edge Function failures, webhook processing
failures, checkout failures and elevated authentication errors. Confirm that
the Sentry project receives only scrubbed technical events and no budget values.

## Existing migration history

The Release 2 schema was originally applied through the SQL editor. Its deployed
schema was verified and migration `202607300001_release_2_household_sync.sql`
was recorded as applied before the GitHub integration was enabled.
