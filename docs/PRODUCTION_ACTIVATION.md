# Harbourline Production Activation

This checklist promotes Harbourline from a test deployment to a controlled
Asia-Pacific beta environment. Sydney remains the preferred long-term region.
The beta currently uses Tokyo and that limitation must be recorded in the
privacy notice before external customers are invited.

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

The Supabase GitHub App is installed on the private
`grantashman/harbourline` repository only. The Harbourline project is connected
with:

- working directory: `.`
- production deployment: enabled
- production branch: `main`
- automatic preview branches: disabled on the current plan

Supabase applies changes under `supabase/` after they are merged into `main`.
The repository CI still runs application, domain, sync, schema and production
build checks before merge. No account-wide Supabase access token or database
password is stored in GitHub.

## 3. Release database and function changes

1. Create a timestamped migration in `supabase/migrations/`.
2. Update or add Edge Functions under `supabase/functions/`.
3. Run `pnpm check`.
4. Open and review a pull request.
5. Merge the reviewed change into `main`.
6. Confirm the Supabase integration reports a successful production update.

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

## 5. Rehearse recovery

Before inviting customers:

- use a Supabase production plan that cannot be paused for inactivity
- confirm the backup retention available on the selected plan
- take and restore a test backup
- document who owns an incident and how customers are notified
- test export and deletion with MFA
- test household ownership transfer before account deletion
- confirm a cancelled subscription never deletes a household budget

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

## Existing migration history

The Release 2 schema was originally applied through the SQL editor. Its deployed
schema was verified and migration `202607300001_release_2_household_sync.sql`
was recorded as applied before the GitHub integration was enabled.
