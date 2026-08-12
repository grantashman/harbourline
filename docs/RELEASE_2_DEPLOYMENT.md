# Release 2 Deployment

Release 2 is implemented in source. Complete these steps to activate accounts
and household sync for a hosted Harbourline build.

## 1. Create the project

Create a Supabase project in an Australian region. Record the project URL and
the current publishable key beginning with `sb_publishable_`. Do not use a
secret or service-role key in the browser.

Supabase reference:

- https://supabase.com/docs/guides/getting-started/api-keys

## 2. Configure local development

Copy `.env.example` to `.env.local` and set:

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

The unconfigured build intentionally shows that a Supabase account connection
is required for the hosted experience. Account creation is not exposed in the
application; access requests are collected on the public product homepage.

## 3. Apply the database

Install the Supabase CLI, authenticate it, then run:

```text
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase test db
```

The migration creates profiles, households, membership, invitations, one
versioned budget document per household and idempotent sync receipts. Row-level
security is enabled for every exposed table.

Supabase reference:

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/local-development/testing/overview

## 4. Deploy account deletion

Deploy the authenticated Edge Function:

```text
supabase functions deploy delete-account
```

Test deletion with MFA enabled, then verify these cases:

- a non-owner can delete their account
- an owner cannot delete while a household would be orphaned
- ownership transfer or household deletion permits later account deletion
- the local device budget remains after cloud account deletion

Supabase reference:

- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/auth/auth-mfa/totp

## 5. Configure authentication

In Supabase Auth:

- set the production site URL
- add exact production and development redirect URLs
- enable email confirmation
- configure branded transactional email
- set appropriate password controls and rate limits
- require MFA for every administrative account

Email links use PKCE and return to the current Harbourline path.

Supabase reference:

- https://supabase.com/docs/reference/javascript/auth-signinwithotp

## 6. Build and verify

Run:

```text
pnpm check
pnpm dev
```

Verify at desktop and mobile widths:

- the first screen matches the original Harbourline interface
- direct `index.html` opening remains fully offline
- registration, email confirmation and sign-in work
- first sync requires a device or household copy choice
- offline edits queue and later upload
- two-device edits produce a conflict choice
- owner, member and unrelated accounts remain isolated
- account export and deletion work end to end

On narrow screens, also verify that the software keyboard does not hide the
focused field, account/onboarding dialogs scroll within the dynamic viewport,
safe-area insets leave controls clear of device cut-outs, and every primary or
destructive control remains at least 44px tall. Opening Account creates a
history entry so the browser Back button closes the panel before leaving the
planner. Service-worker updates are presented explicitly rather than reloading
over an unsaved local edit.

Realtime uses Postgres change notifications to prompt an authorised document
read. Reassess Supabase Broadcast before higher customer scale.

Supabase reference:

- https://supabase.com/docs/guides/realtime/subscribing-to-database-changes

## 7. Production operations

Before inviting paid customers:

- enable and rehearse database backups and restoration
- document retention and account-deletion timing
- nominate an incident owner and escalation path
- prepare an Australian privacy notice matching actual data flows
- remove financial values from logs, analytics and support captures
- run dependency, secret and policy checks in CI
- complete legal review of educational financial guidance
