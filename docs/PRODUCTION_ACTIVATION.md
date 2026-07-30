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

## 2. Configure the GitHub production environment

In the private `grantashman/harbourline` repository, create a GitHub Actions
environment named `production`. Add these environment secrets:

- `SUPABASE_ACCESS_TOKEN`: a fine-grained Supabase token with the minimum
  project read, database deployment and function deployment permissions
- `SUPABASE_PROJECT_REF`: the beta project's 20-character reference
- `SUPABASE_DB_PASSWORD`: the beta project's database password

Protect the environment with required approval before deployment. Browser
publishable keys belong in the web host's environment, not in GitHub source.

## 3. Run the first deployment

Open GitHub Actions and manually run `Deploy Supabase Production`.

The workflow:

1. runs all application, domain, sync and schema checks
2. verifies the target is healthy and in an approved Asia-Pacific region
3. previews pending migrations
4. applies migrations through Supabase migration history
5. deploys all Edge Functions
6. prints the final migration state

The workflow is manual until production has passed backup, email and recovery
tests. After that gate, a reviewed change can enable deployment on merges to
`main`.

## 4. Configure authentication

- set the exact production site URL and redirect URLs
- use a custom SMTP provider on a Harbourline-controlled domain
- disable SMTP link tracking
- brand confirmation, magic-link and recovery emails
- set sensible password, OTP and rate-limit controls
- enable CAPTCHA before a public signup launch
- enforce MFA for Supabase and GitHub administrators

## 5. Rehearse recovery

Before inviting customers:

- upgrade from the Free plan so production cannot be paused for inactivity
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

## Existing migration history

The current schema was applied through the SQL editor. Before the first
automated deployment, link it with the Supabase CLI and mark the already-applied
migration once:

```text
supabase migration repair 202607300001 --status applied
supabase migration list
```

Do this only after confirming the deployed schema matches the migration.
