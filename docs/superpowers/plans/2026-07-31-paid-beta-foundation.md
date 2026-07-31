# Paid Beta Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new paid Harbourline member complete a resumable first-run setup, while the operator can measure privacy-safe activation and safely rehearse a public paid beta.

**Architecture:** Keep the existing root planning interface and its `HarbourlineLocal` bridge. Add a hosted onboarding overlay that writes through that bridge, so every guided edit follows the existing local-save and cloud-sync path. Store only progress and event metadata in new private Supabase tables; Edge Functions authorise event writes and return aggregate operator metrics. Paid members who already have a household when this release lands keep their current dashboard and are never forced into onboarding.

**Tech Stack:** TypeScript, Vite PWA, `@supabase/supabase-js`, Supabase Postgres/RLS/Edge Functions, Stripe webhooks, Resend HTTP API, Sentry browser and Deno SDKs, Node test runner, pgTAP, Deno test.

## Global Constraints

- Hosted access requires a signed-in user with an active or trialing subscription.
- Signup remains public. The beta has no automatic household cap.
- Keep all calculations in the existing planning interface. Do not add a second budget model.
- Operational events must never contain financial amounts, names, categories, notes, addresses or device fingerprints.
- Customers cannot read or write beta-event or onboarding tables directly.
- Operator access uses the comma-separated `HARBOURLINE_OPERATOR_EMAILS` Edge Function secret. Do not hard-code an email address.
- Browser configuration uses only `VITE_*` public values. Stripe, Resend, Sentry server and operator secrets remain server-side.
- Use AUD and en-AU date formatting in all customer-facing copy.
- Preserve existing member dashboards and current household-sync behaviour.
- Every feature task starts red, turns green with the smallest implementation, runs its focused test, then commits.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/domain/src/beta.ts` | Pure onboarding milestones and safe event-name validation. |
| `packages/domain/test/domain.test.mjs` | Node tests for onboarding state transitions and event payload boundaries. |
| `supabase/migrations/202607310002_paid_beta_foundation.sql` | Onboarding/event tables, RLS, indexes and private aggregate helpers. |
| `supabase/tests/database/paid_beta_rls.test.sql` | pgTAP checks for event-table isolation and no direct customer writes. |
| `supabase/functions/_shared/beta.ts` | Deno helpers for event validation, operator allowlists and aggregate mapping. |
| `supabase/functions/_shared/beta-email.ts` | Resend delivery and fixed welcome/cancellation email bodies. |
| `supabase/functions/_shared/beta.test.ts` | Deno tests for event and operator helpers. |
| `supabase/functions/record-beta-progress/index.ts` | JWT-protected onboarding progress and customer event writes. |
| `supabase/functions/get-beta-operations/index.ts` | JWT-protected aggregate dashboard for listed operators. |
| `supabase/functions/create-checkout-session/index.ts` | Adds the server-owned `checkout_started` event. |
| `supabase/functions/stripe-webhook/index.ts` | Adds subscription events and lifecycle email delivery. |
| `apps/web/src/beta-types.ts` | Browser contracts for onboarding progress, operator metrics and safe events. |
| `apps/web/src/onboarding-flow.ts` | Resumable full-screen onboarding UI and bridge-backed budget edits. |
| `apps/web/src/operator-dashboard.ts` | Read-only, operator-only aggregate beta dashboard. |
| `apps/web/src/cloud.ts` | Calls new Edge Functions and exposes typed beta operations. |
| `apps/web/src/account-panel.ts` | Starts onboarding after subscription confirmation and exposes support/operator controls. |
| `apps/web/src/release2-types.ts` | Extends the local bridge with `openWorkspace("payday")`. |
| `apps/web/src/release2.ts` | Starts account and onboarding controllers once the root bridge is ready. |
| `apps/web/src/release2.css` | Responsive onboarding and operator-dashboard styling. |
| `index.html` | Adds `openWorkspace` to the root bridge without changing calculations. |
| `scripts/verify-beta-deployment-config.mjs` | Validates deployment mode and required public configuration without printing secrets. |
| `.github/workflows/ci.yml` | Runs Deno helper tests and deployment-configuration fixture checks. |
| `.env.example` | Documents the public deployment mode, support address and optional Sentry browser DSN. |
| `docs/BETA_RELEASE_TEST_MATRIX.md` | Staging-to-production test matrix and recorded expected results. |
| `docs/PRODUCTION_ACTIVATION.md` | Production secret, SMTP, monitoring and recovery setup instructions. |

## Task 1: Define Pure Beta State and Event Contracts

**Files:**
- Create: `packages/domain/src/beta.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/test/domain.test.mjs`

**Interfaces:**
- Produces `BetaEventName`, `BetaOnboardingStep`, `BetaOnboardingSnapshot`, `deriveBetaOnboardingStep()` and `nextBetaMilestoneEvents()`.
- Consumed by `apps/web/src/onboarding-flow.ts` and `supabase/functions/_shared/beta.ts`.

- [ ] **Step 1: Write failing domain tests for the onboarding milestones**

```js
import {
  deriveBetaOnboardingStep,
  nextBetaMilestoneEvents
} from "../dist/index.js";

describe("paid beta onboarding", () => {
  it("moves from household to income, bills and payday", () => {
    assert.equal(deriveBetaOnboardingStep({ householdId: null, incomeCount: 0, billCount: 0, paydayViewed: false }), "household");
    assert.equal(deriveBetaOnboardingStep({ householdId: "household-1", incomeCount: 1, billCount: 0, paydayViewed: false }), "bills");
    assert.equal(deriveBetaOnboardingStep({ householdId: "household-1", incomeCount: 1, billCount: 1, paydayViewed: false }), "payday");
  });

  it("emits only new privacy-safe milestones", () => {
    assert.deepEqual(
      nextBetaMilestoneEvents(
        { householdId: "household-1", incomeCount: 0, billCount: 0, paydayViewed: false },
        { householdId: "household-1", incomeCount: 1, billCount: 5, paydayViewed: true }
      ),
      ["income_added", "five_bills_added", "payday_viewed", "onboarding_completed"]
    );
  });
});
```

- [ ] **Step 2: Run the focused domain test to verify it fails**

Run: `pnpm --filter @harbourline/domain test`

Expected: FAIL because `deriveBetaOnboardingStep` and `nextBetaMilestoneEvents` do not exist.

- [ ] **Step 3: Add the smallest exported contract in `packages/domain/src/beta.ts`**

```ts
export const BETA_EVENT_NAMES = [
  "checkout_started", "subscription_activated", "onboarding_started",
  "household_created", "income_added", "five_bills_added", "payday_viewed",
  "onboarding_completed", "support_requested", "subscription_past_due",
  "subscription_cancelled"
] as const;

export type BetaEventName = (typeof BETA_EVENT_NAMES)[number];
export type BetaOnboardingStep = "household" | "income" | "bills" | "payday" | "complete";

export interface BetaOnboardingSnapshot {
  householdId: string | null;
  incomeCount: number;
  billCount: number;
  paydayViewed: boolean;
}
```

Implement `deriveBetaOnboardingStep(snapshot)` with the ordered conditions from the design, and `nextBetaMilestoneEvents(previous, next)` so it returns only event names from `BETA_EVENT_NAMES`.

- [ ] **Step 4: Export the module and run the focused test**

```ts
export * from "./beta.js";
```

Run: `pnpm --filter @harbourline/domain test`

Expected: PASS with the existing 14 tests plus the new onboarding tests.

- [ ] **Step 5: Commit the pure beta contracts**

```bash
git add packages/domain/src/beta.ts packages/domain/src/index.ts packages/domain/test/domain.test.mjs
git commit -m "feat: add paid beta onboarding contracts"
```

## Task 2: Add Private Onboarding and Operational Data

**Files:**
- Create: `supabase/migrations/202607310002_paid_beta_foundation.sql`
- Create: `supabase/tests/database/paid_beta_rls.test.sql`
- Modify: `supabase/tests/database/release_2_rls.test.sql`

**Interfaces:**
- Produces private `beta_onboarding` and `beta_operational_events` tables.
- Produces `private.beta_operations_summary()` for service-role use only.
- Consumed by the beta Edge Functions in Task 3.

- [ ] **Step 1: Write the failing pgTAP assertions**

```sql
select has_table('public', 'beta_onboarding', 'beta onboarding table exists');
select has_table('public', 'beta_operational_events', 'beta operational events table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.beta_operational_events'::regclass),
  'beta operational events has RLS enabled'
);
select throws_ok(
  $$insert into public.beta_operational_events (user_id, event_name)
    values (auth.uid(), 'income_added')$$,
  '42501', null, 'customers cannot insert beta events directly'
);
```

- [ ] **Step 2: Run the database test to verify it fails**

Run: `supabase test db`

Expected: FAIL because the beta tables do not exist.

- [ ] **Step 3: Create the migration with closed customer access**

```sql
create table public.beta_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  step text not null check (step in ('household', 'income', 'bills', 'payday', 'complete')),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.beta_operational_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  event_name text not null check (event_name in (
    'checkout_started', 'subscription_activated', 'onboarding_started',
    'household_created', 'income_added', 'five_bills_added', 'payday_viewed',
    'onboarding_completed', 'support_requested', 'subscription_past_due',
    'subscription_cancelled'
  )),
  occurred_at timestamptz not null default timezone('utc', now())
);
```

Enable RLS on both tables, revoke all privileges from `anon` and `authenticated`, add only service-role-compatible helpers, and add indexes on `(user_id, updated_at desc)` and `(event_name, occurred_at desc)`. Define `private.beta_operations_summary()` as `security definer`, set `search_path = ''`, and return only day, event name and count. The operator endpoint derives signups from `auth.users.created_at`; `account_created` is intentionally not stored as an operational event.

- [ ] **Step 4: Extend account export and deletion coverage**

Update `public.export_my_account()` in the same migration to include onboarding progress but exclude operational-event rows. Confirm foreign keys cascade operational data during account deletion.

- [ ] **Step 5: Run the database test suite**

Run: `supabase test db`

Expected: PASS with the existing household isolation tests and the new beta-event access tests.

- [ ] **Step 6: Commit the data boundary**

```bash
git add supabase/migrations/202607310002_paid_beta_foundation.sql supabase/tests/database/paid_beta_rls.test.sql supabase/tests/database/release_2_rls.test.sql
git commit -m "feat: add private paid beta operations data"
```

## Task 3: Build Event, Progress and Operator Edge Functions

**Files:**
- Create: `supabase/functions/_shared/beta.ts`
- Create: `supabase/functions/_shared/beta.test.ts`
- Create: `supabase/functions/record-beta-progress/index.ts`
- Create: `supabase/functions/get-beta-operations/index.ts`
- Modify: `supabase/config.toml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes `BetaEventName` values from Task 1 and the tables from Task 2.
- Produces `POST /record-beta-progress` and `POST /get-beta-operations`.
- Returns `BetaOnboardingProgress` and `BetaOperationsSnapshot` used by Task 5.

- [ ] **Step 1: Write failing Deno helper tests**

```ts
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { parseOperatorEmails, validateBetaEvent } from "./beta.ts";

Deno.test("validates the fixed customer event allowlist", () => {
  assertEquals(validateBetaEvent("income_added"), "income_added");
  assertThrows(() => validateBetaEvent("expense_name"));
});

Deno.test("matches normalised operator emails", () => {
  assertEquals(parseOperatorEmails(" owner@harbourline.test,ops@harbourline.test "), new Set([
    "owner@harbourline.test", "ops@harbourline.test"
  ]));
});
```

- [ ] **Step 2: Run the Deno helper test to verify it fails**

Run: `deno test supabase/functions/_shared/beta.test.ts`

Expected: FAIL because the shared beta helper does not exist.

- [ ] **Step 3: Add shared validation and aggregate contracts**

Implement `validateBetaEvent(value)`, `parseOperatorEmails(value)`, `requireAuthenticatedUser(request)` and `jsonResponse(body, status)`. `validateBetaEvent` accepts only the fixed list in Task 1. `requireAuthenticatedUser` creates a Supabase client with the caller's bearer token and rejects a missing user with HTTP 401.

Define these serialisable response shapes:

```ts
export interface BetaOnboardingProgress {
  householdId: string | null;
  step: "household" | "income" | "bills" | "payday" | "complete";
  completedAt: string | null;
}

export interface BetaOperationsSnapshot {
  daily: Array<{ day: string; eventName: string; count: number }>;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  cancelledSubscriptions: number;
}
```

- [ ] **Step 4: Implement `record-beta-progress`**

Accept only this request body:

```ts
{
  action: "get" | "progress" | "event";
  householdId?: string | null;
  step?: "household" | "income" | "bills" | "payday" | "complete";
  eventName?: BetaEventName;
}
```

For `get`, return the signed-in user’s progress row or HTTP 404 when none exists. For `progress`, upsert the signed-in user’s row and set `completed_at` only for `step: "complete"`. For `event`, check that the user belongs to the supplied household when one is supplied, then insert only a validated event. All table writes use a service-role client only after `requireAuthenticatedUser()` succeeds. Return 400 for malformed data, 401 for an unauthenticated caller and 403 for a household the caller does not belong to.

- [ ] **Step 5: Implement `get-beta-operations`**

Authenticate the caller, lower-case the email, compare it against `HARBOURLINE_OPERATOR_EMAILS`, then call the private aggregate helper with the service-role client. Return 403 for every other signed-in user. Include signups by day from `auth.users.created_at`, plus active, past-due and cancelled subscription counts using aggregate queries. Do not return user IDs, email addresses, household IDs or budget state.

- [ ] **Step 6: Register functions and make CI run the helper tests**

Add to `supabase/config.toml`:

```toml
[functions.record-beta-progress]
verify_jwt = true

[functions.get-beta-operations]
verify_jwt = true
```

Add a Deno setup and test step after checkout in `.github/workflows/ci.yml`:

```yaml
- uses: denoland/setup-deno@v2
  with:
    deno-version: v2.x
- run: deno test supabase/functions/_shared/beta.test.ts
```

- [ ] **Step 7: Run focused tests**

Run: `deno test supabase/functions/_shared/beta.test.ts`

Expected: PASS with both validation and operator allowlist tests.

- [ ] **Step 8: Commit the protected beta APIs**

```bash
git add supabase/functions/_shared/beta.ts supabase/functions/_shared/beta.test.ts supabase/functions/record-beta-progress/index.ts supabase/functions/get-beta-operations/index.ts supabase/config.toml .github/workflows/ci.yml
git commit -m "feat: add protected paid beta operations APIs"
```

## Task 4: Record Server-Owned Billing Events and Send Lifecycle Messages

**Files:**
- Create: `supabase/functions/_shared/beta-email.ts`
- Modify: `supabase/functions/create-checkout-session/index.ts`
- Modify: `supabase/functions/stripe-webhook/index.ts`
- Modify: `supabase/functions/_shared/beta.test.ts`

**Interfaces:**
- Consumes the private event table from Task 2.
- Uses `RESEND_API_KEY`, `HARBOURLINE_FROM_EMAIL`, `HARBOURLINE_SUPPORT_EMAIL` and `HARBOURLINE_APP_URL` only from Edge Function secrets.
- Produces exactly one checkout event per checkout start and lifecycle email delivery after the associated Stripe status update succeeds.

- [ ] **Step 1: Add failing helper tests for email eligibility**

```ts
import { lifecycleEmailFor } from "./beta-email.ts";

Deno.test("sends welcome only when a subscription first becomes active", () => {
  assertEquals(lifecycleEmailFor({ previousStatus: "incomplete", nextStatus: "active" })?.kind, "welcome");
  assertEquals(lifecycleEmailFor({ previousStatus: "active", nextStatus: "active" }), null);
});

Deno.test("sends cancellation guidance only after cancellation", () => {
  assertEquals(lifecycleEmailFor({ previousStatus: "active", nextStatus: "canceled" })?.kind, "cancelled");
});
```

- [ ] **Step 2: Run Deno tests to verify the new helper fails**

Run: `deno test supabase/functions/_shared/beta.test.ts`

Expected: FAIL because `beta-email.ts` and `lifecycleEmailFor` do not exist.

- [ ] **Step 3: Implement fixed lifecycle email bodies**

Create `beta-email.ts` with `lifecycleEmailFor()` and `sendLifecycleEmail()`. The welcome message links to `HARBOURLINE_APP_URL` and says the member can add income, bills and their first payday plan. The cancellation message confirms the end-of-period date, preserved data, export route and support address. Do not include any budget values.

`sendLifecycleEmail()` posts to `https://api.resend.com/emails` only when all three Resend/sender/support secrets are configured. It logs a safe error and returns `false` when email configuration is missing. A failed email must never fail a verified Stripe webhook or roll back subscription status.

- [ ] **Step 4: Record checkout starts in `create-checkout-session`**

After the authenticated user passes the existing duplicate-subscription guard and before calling Stripe, insert:

```ts
await admin.from("beta_operational_events").insert({
  user_id: user.id,
  event_name: "checkout_started"
});
```

Create that service-role client inside the function from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; retain the existing caller-token client for user authentication and subscription checks. If the event write fails, return HTTP 500 before creating a Stripe session so the metrics do not falsely omit a checkout.

- [ ] **Step 5: Add subscription lifecycle events to the webhook**

Before the subscription upsert, read the previous billing status. After a successful upsert, insert one of:

```ts
"subscription_activated"
"subscription_past_due"
"subscription_cancelled"
```

Only insert an event when the stored status changed. Call `sendLifecycleEmail()` after the event insert. Preserve current replay protection: a second Stripe event with the same `event_id` returns HTTP 200 and emits no duplicate event or email.

- [ ] **Step 6: Run helper tests and type checks**

Run: `deno test supabase/functions/_shared/beta.test.ts`

Run: `pnpm typecheck`

Expected: both commands exit 0.

- [ ] **Step 7: Commit billing instrumentation and emails**

```bash
git add supabase/functions/_shared/beta-email.ts supabase/functions/_shared/beta.test.ts supabase/functions/create-checkout-session/index.ts supabase/functions/stripe-webhook/index.ts
git commit -m "feat: add beta billing events and lifecycle emails"
```

## Task 5: Add Typed Browser Access to Beta APIs

**Files:**
- Create: `apps/web/src/beta-types.ts`
- Modify: `apps/web/src/cloud.ts`
- Modify: `apps/web/src/release2-types.ts`
- Modify: `index.html`

**Interfaces:**
- Consumes `record-beta-progress` and `get-beta-operations` from Task 3.
- Produces `HarbourlineCloud.getBetaOnboarding()`, `saveBetaProgress()`, `recordBetaEvent()`, `getBetaOperations()` and `openWorkspace("payday")`.
- Consumed by Tasks 6 and 7.

- [ ] **Step 1: Write failing type-level usage in `apps/web/src/beta-types.ts`**

```ts
export type BetaOnboardingStep = "household" | "income" | "bills" | "payday" | "complete";
export type BetaEventName =
  | "onboarding_started" | "household_created" | "income_added"
  | "five_bills_added" | "payday_viewed" | "onboarding_completed" | "support_requested";

export interface BetaOnboardingProgress {
  householdId: string | null;
  step: BetaOnboardingStep;
  completedAt: string | null;
}
```

Temporarily import `BetaOnboardingProgress` into `cloud.ts` and call the missing methods from a compile-only helper. This makes `pnpm --filter @harbourline/web typecheck` fail before the methods are implemented.

- [ ] **Step 2: Run web typecheck to verify it fails**

Run: `pnpm --filter @harbourline/web typecheck`

Expected: FAIL because the beta cloud methods and bridge method do not exist.

- [ ] **Step 3: Implement typed function invocations in `HarbourlineCloud`**

Add methods with these signatures:

```ts
async getBetaOnboarding(): Promise<BetaOnboardingProgress | null>
async saveBetaProgress(progress: { householdId: string | null; step: BetaOnboardingStep }): Promise<BetaOnboardingProgress>
async recordBetaEvent(eventName: BetaEventName, householdId?: string | null): Promise<void>
async getBetaOperations(): Promise<BetaOperationsSnapshot | null>
```

`getBetaOnboarding()` calls `record-beta-progress` with `{ action: "get" }` and treats HTTP 404 as no existing progress. `getBetaOperations()` treats HTTP 403 as `null` so ordinary members never see an operator error.

- [ ] **Step 4: Extend the root bridge with focused navigation**

Add this method to `HarbourlineLocalBridge`:

```ts
openWorkspace(tab: "payday"): void;
```

In `index.html`, extract the existing workspace-tab DOM update into a reusable function and expose it through `window.HarbourlineLocal.openWorkspace`. It must select the existing `payday` tab and scroll the planning workspace into view. It must not alter the budget state.

- [ ] **Step 5: Run the web typecheck**

Run: `pnpm --filter @harbourline/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the browser contracts**

```bash
git add apps/web/src/beta-types.ts apps/web/src/cloud.ts apps/web/src/release2-types.ts index.html
git commit -m "feat: add browser access to paid beta APIs"
```

## Task 6: Build the Resumable Onboarding Flow

**Files:**
- Create: `apps/web/src/onboarding-flow.ts`
- Modify: `apps/web/src/account-panel.ts`
- Modify: `apps/web/src/release2.ts`
- Modify: `apps/web/src/release2.css`

**Interfaces:**
- Consumes the Task 1 domain helpers, Task 5 cloud methods and `HarbourlineLocalBridge`.
- Produces `OnboardingFlow.refresh(session, subscriptionActive, households)` and `OnboardingFlow.dispose()`.
- Writes only through `bridge.replace(nextState, "onboarding")`.

- [ ] **Step 1: Write the failing onboarding controller test cases in comments and compile contracts**

Create a `OnboardingDependencies` interface that requires the following members, then instantiate it from a compile-only test fixture in the file:

```ts
interface OnboardingDependencies {
  bridge: HarbourlineLocalBridge;
  cloud: Pick<HarbourlineCloud, "getBetaOnboarding" | "saveBetaProgress" | "recordBetaEvent">;
  createHousehold(name: string): Promise<string>;
  linkHousehold(householdId: string): Promise<void>;
}
```

The fixture must fail typecheck until `OnboardingFlow` and `refresh()` exist.

- [ ] **Step 2: Run web typecheck to verify it fails**

Run: `pnpm --filter @harbourline/web typecheck`

Expected: FAIL because `OnboardingFlow` does not exist.

- [ ] **Step 3: Implement the four-step flow without duplicating the planner**

Create a full-screen dialog-like overlay with a stable progress indicator and four forms:

```ts
type OnboardingStep = "household" | "income" | "bills" | "payday";
```

- **Household:** call the injected `createHousehold(name)`, call `linkHousehold(householdId)`, save progress, then record `household_created`.
- **Income:** clone `bridge.read()`, set the first income source's `label`, `amount`, `frequency` and `nextPayDate`, then call `bridge.replace(nextState, "onboarding")`. Save progress and record `income_added` only when the amount is greater than zero.
- **Bills:** add one bill at a time with name, category, amount, frequency and due date. Use `crypto.randomUUID()` for each bill ID. Let the user proceed with one bill. Record `five_bills_added` when the count first reaches five.
- **Payday:** call `bridge.openWorkspace("payday")`, record `payday_viewed`, save `step: "complete"`, then record `onboarding_completed` and remove the overlay.

Never show this overlay until `subscriptionActive` is true. Show it only when the user has no stored progress and no existing household, or when a stored progress row is incomplete. A paid member with an existing household and no progress row is treated as a legacy member and keeps the dashboard without a forced setup flow. Re-read progress after every successful action. If a network call fails after a bridge save, keep the local budget edit, display a retry message and retry the progress update when the member chooses Continue.

- [ ] **Step 4: Integrate the flow through `AccountPanel`**

Add a private `onboarding: OnboardingFlow` field. Construct it with wrappers around `this.cloud`, `this.sync.linkDevice(householdId, "device")` and `this.cloud.createHousehold(name)`. In `refreshAccount()`, call:

```ts
await this.onboarding.refresh({
  session: this.state.session,
  subscriptionActive: Boolean(this.subscriptionActive),
  households: this.state.households
});
```

After a confirmed Stripe redirect, call `refreshAccount()` before opening onboarding. Existing users with a completed progress record, or an existing household and no progress row, must never see the flow.

- [ ] **Step 5: Style desktop and mobile states**

Add isolated `.release2-onboarding-*` rules. The overlay uses the existing Harbourline dark/light variables, a maximum content width of 720px, `overflow-x: hidden`, 44px minimum controls and a one-column mobile layout below 720px. It must not use nested cards or alter the original dashboard layout.

- [ ] **Step 6: Run browser build checks**

Run: `pnpm --filter @harbourline/web typecheck`

Run: `pnpm --filter @harbourline/web build`

Expected: both commands exit 0.

- [ ] **Step 7: Commit onboarding**

```bash
git add apps/web/src/onboarding-flow.ts apps/web/src/account-panel.ts apps/web/src/release2.ts apps/web/src/release2.css
git commit -m "feat: add paid member onboarding flow"
```

## Task 7: Add Operator Metrics and Customer Support Entry

**Files:**
- Create: `apps/web/src/operator-dashboard.ts`
- Modify: `apps/web/src/account-panel.ts`
- Modify: `apps/web/src/release2.css`
- Modify: `.env.example`

**Interfaces:**
- Consumes `HarbourlineCloud.getBetaOperations()` and `recordBetaEvent()`.
- Produces `OperatorDashboard.refresh()` that renders only aggregate metrics.

- [ ] **Step 1: Write compile-only dashboard contracts**

```ts
export interface OperatorDashboardDependencies {
  getSnapshot(): Promise<BetaOperationsSnapshot | null>;
}

export class OperatorDashboard {
  constructor(private readonly dependencies: OperatorDashboardDependencies) {}
  async refresh(): Promise<HTMLElement | null> { throw new Error("not implemented"); }
}
```

Import it into `account-panel.ts` before implementing `refresh()` so the web typecheck fails.

- [ ] **Step 2: Run web typecheck to verify it fails**

Run: `pnpm --filter @harbourline/web typecheck`

Expected: FAIL because `refresh()` does not return the required element.

- [ ] **Step 3: Implement the aggregate dashboard**

Render the dashboard only when `getSnapshot()` returns data. Show six compact metrics: signups, checkout starts, active paid households, past-due subscriptions, cancellations and onboarding completions. Derive each from the aggregate daily series and subscription counts. Do not render customer names, emails, household IDs or financial values.

Add a daily event table with `en-AU` dates, event labels and counts. Refresh when the Account panel opens, then every 60 seconds while it remains open. Stop the timer when the dialog closes.

- [ ] **Step 4: Add the support path**

Document this public value in `.env.example`:

```text
VITE_HARBOURLINE_SUPPORT_EMAIL=support@example.com
```

In the signed-in Account panel, render `mailto:${encodeURIComponent(supportEmail)}` only when the value is configured. The mail subject is `Harbourline support request`; the body says to avoid including account numbers, passwords or a budget export. On click, call `recordBetaEvent("support_requested")` without blocking the mail link.

- [ ] **Step 5: Add responsive CSS and run the typecheck**

Use `.release2-operations-*` rules with a two-column metric grid above 720px and one column below 720px. Ensure number labels wrap rather than stretch cards. Run: `pnpm --filter @harbourline/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the operator and support UI**

```bash
git add apps/web/src/operator-dashboard.ts apps/web/src/account-panel.ts apps/web/src/release2.css .env.example
git commit -m "feat: add beta operations dashboard and support path"
```

## Task 8: Add Safe Error Monitoring and Deployment Validation

**Files:**
- Create: `apps/web/src/monitoring.ts`
- Create: `supabase/functions/_shared/monitoring.ts`
- Create: `scripts/verify-beta-deployment-config.mjs`
- Modify: `apps/web/src/release2.ts`
- Modify: `supabase/functions/_shared/beta.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example`

**Interfaces:**
- Browser monitoring starts only when `VITE_SENTRY_DSN` and `VITE_HARBOURLINE_DEPLOYMENT` are set.
- Server monitoring starts only when `SENTRY_DSN` and `HARBOURLINE_DEPLOYMENT` are set.
- `verify-beta-deployment-config.mjs --fixture` passes in CI without secrets.

- [ ] **Step 1: Add failing deployment-fixture checks**

Create `scripts/verify-beta-deployment-config.mjs` that exits non-zero when a fixture has an invalid mode or an HTTP Supabase URL:

```js
const mode = process.env.VITE_HARBOURLINE_DEPLOYMENT;
if (!['staging', 'production'].includes(mode)) throw new Error('VITE_HARBOURLINE_DEPLOYMENT must be staging or production.');
if (!process.env.VITE_SUPABASE_URL?.startsWith('https://')) throw new Error('VITE_SUPABASE_URL must use HTTPS.');
```

Add a fixture invocation to CI with `VITE_HARBOURLINE_DEPLOYMENT=staging`, `VITE_SUPABASE_URL=https://staging.example.supabase.co` and a non-secret placeholder publishable key. Confirm the script fails before the complete validation is implemented.

- [ ] **Step 2: Implement validation and a production-mode guard**

Require `VITE_HARBOURLINE_SUPPORT_EMAIL` in production mode, validate it with a conservative email expression, and reject a production build whose Supabase URL equals `VITE_HARBOURLINE_STAGING_SUPABASE_URL`. The script prints only the deployment mode and project host, never a key.

Add this root script:

```json
"deploy:verify": "node scripts/verify-beta-deployment-config.mjs"
```

- [ ] **Step 3: Add Sentry initialisation with financial-data scrubbing**

Install the current supported browser SDK and initialise it in `apps/web/src/monitoring.ts`. In `beforeSend`, remove `request.data`, `extra`, `contexts`, breadcrumb messages and any tag whose key matches `budget|income|expense|transaction|amount|state|description`. Do not initialise when the DSN is empty.

Add a Deno shared helper that performs the same safe-key deletion before passing an error to the Sentry Deno SDK. Existing billing functions call this helper only in their catch paths.

- [ ] **Step 4: Start monitoring before AccountPanel initialisation**

```ts
import { initialiseMonitoring } from "./monitoring";

initialiseMonitoring();
```

Place it at the top of `startRelease2()` in `apps/web/src/release2.ts` so application failures are captured after the scrubber is installed.

- [ ] **Step 5: Run validation and builds**

Run: `VITE_HARBOURLINE_DEPLOYMENT=staging VITE_SUPABASE_URL=https://staging.example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture pnpm deploy:verify`

Run: `pnpm check`

Expected: both commands exit 0.

- [ ] **Step 6: Commit observability and guards**

```bash
git add apps/web/src/monitoring.ts supabase/functions/_shared/monitoring.ts scripts/verify-beta-deployment-config.mjs apps/web/src/release2.ts package.json .github/workflows/ci.yml .env.example pnpm-lock.yaml
git commit -m "feat: add safe beta monitoring and deployment checks"
```

## Task 9: Document Production Setup and the Beta Test Matrix

**Files:**
- Create: `docs/BETA_RELEASE_TEST_MATRIX.md`
- Modify: `docs/PRODUCTION_ACTIVATION.md`
- Modify: `docs/PRODUCTION_AND_PROFITABILITY.md`
- Modify: `README.md`

**Interfaces:**
- Produces one manual test record for staging and production rehearsal.
- Names every required secret and external configuration without containing its value.

- [ ] **Step 1: Create the release matrix with explicit pass criteria**

Include rows for password signup, Google sign-in, checkout, payment receipt, onboarding resume, five-bill activation, support mail link, payment failure, payment recovery, cancellation at period end, refund, webhook replay, account export, deletion, backup restore, owner dashboard denial for an ordinary user and owner dashboard success for an operator.

Use this row format:

```markdown
| Scenario | Environment | Steps | Expected result | Evidence link | Result |
| --- | --- | --- | --- | --- | --- |
| Stripe webhook replay | Staging | Re-send a processed Stripe event | HTTP 200; no duplicate subscription event or email | Stripe event URL | Pending |
```

- [ ] **Step 2: Document exact production configuration**

Add required secret names to `docs/PRODUCTION_ACTIVATION.md`:

```text
HARBOURLINE_OPERATOR_EMAILS
HARBOURLINE_FROM_EMAIL
HARBOURLINE_SUPPORT_EMAIL
RESEND_API_KEY
SENTRY_DSN
HARBOURLINE_DEPLOYMENT=production
```

Document separate staging values, verified sender-domain requirements, Stripe receipt configuration, Sentry alert rules, backup export location and the decision owner for an incident.

- [ ] **Step 3: Document beta success metrics**

Update `docs/PRODUCTION_AND_PROFITABILITY.md` and `README.md` with the approved public-beta target: public signup, first 20 paid households, no cap, monitoring support demand, at least 70% first payday-plan activation and at least 60% four-week retention.

- [ ] **Step 4: Verify documentation and repository state**

Run: `git diff --check`

Run: `rg -n "to be decided|owner: unassigned|evidence link: pending" docs/BETA_RELEASE_TEST_MATRIX.md docs/PRODUCTION_ACTIVATION.md docs/PRODUCTION_AND_PROFITABILITY.md README.md`

Expected: `git diff --check` exits 0 and the placeholder scan returns no matches.

- [ ] **Step 5: Commit release operations documentation**

```bash
git add docs/BETA_RELEASE_TEST_MATRIX.md docs/PRODUCTION_ACTIVATION.md docs/PRODUCTION_AND_PROFITABILITY.md README.md
git commit -m "docs: add paid beta release operations"
```

## Task 10: Run the Staging Release Gate and Publish

**Files:**
- Modify: `docs/BETA_RELEASE_TEST_MATRIX.md`
- Modify: `docs/PRODUCTION_ACTIVATION.md`

**Interfaces:**
- Consumes all previous tasks and real staging configuration.
- Produces completed evidence links and a dated production-readiness decision.

- [ ] **Step 1: Deploy the migration and Edge Functions to staging through GitHub**

Run: `pnpm check`

Expected: TypeScript, 14 existing financial-domain tests, onboarding tests, 7 sync tests, Deno helper tests, schema verification and production build all pass.

Push the reviewed branch and confirm GitHub CI, CodeQL, dependency review and the Supabase staging deployment report success.

- [ ] **Step 2: Run the customer journey in staging**

Use a new test email and Stripe test card. Complete signup, confirmation, sign-in, checkout, onboarding, sign-out, sign-in and resume. Record the result and links in the test matrix.

- [ ] **Step 3: Run the adverse billing and security paths**

Use Stripe test tools to trigger payment failure, recovery, cancellation at period end, refund and webhook replay. Attempt the operator endpoint as an ordinary member and verify HTTP 403. Attempt direct reads and writes to beta tables as an authenticated member and verify RLS denies them.

- [ ] **Step 4: Rehearse recovery**

Export a test account, delete the test account, restore a disposable staging backup and confirm the restored environment contains the expected test household. Record the backup identifier and date in the test matrix without recording personal financial data.

- [ ] **Step 5: Make the production decision**

Mark production ready only when every matrix row passes, legal and accounting approvals are recorded, the production SMTP sender and monitoring alerts are verified, and production has separate credentials. Otherwise document the failing row, owner and repair release before accepting paid members.

- [ ] **Step 6: Commit evidence and release decision**

```bash
git add docs/BETA_RELEASE_TEST_MATRIX.md docs/PRODUCTION_ACTIVATION.md
git commit -m "docs: record paid beta release gate"
```

## Plan Self-Review

| Design requirement | Implementing task |
| --- | --- |
| Resumable setup and unchanged existing dashboards | Tasks 1, 5 and 6 |
| Income, bills and first payday plan | Task 6 |
| Branded account, billing and support messages | Tasks 4, 7 and 9 |
| Privacy-safe event collection and operator view | Tasks 1, 2, 3, 4 and 7 |
| Staging/production separation and monitoring | Tasks 8, 9 and 10 |
| Backup, export, deletion and billing recovery rehearsals | Tasks 2, 9 and 10 |
| Public signup with demand monitoring | Tasks 4, 7, 9 and 10 |

The plan adds no unapproved financial product advice, bank connectivity, price tier, member cap, in-app chat or second budgeting model. Every new browser and server interface is defined before a consuming task, and every database table is protected from direct customer access.
