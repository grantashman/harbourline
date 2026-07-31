# Harbourline Early-Access Launch and Marketing Plan

Last reviewed: 31 July 2026

## Launch decision

Run Harbourline as a controlled paid beta before opening broad public signup.
Recruit 20 to 50 Australian households over four to six weeks at the single
introductory price of A$1 per week.

The beta has one job: prove that households who build a first payday plan keep
using it. Marketing should bring in the right households, help them reach that
first plan, and show where the funnel loses them.

### Beta exit criteria

- 70% or more of paid customers complete onboarding.
- 60% or more of the founding cohort returns in at least three of four weeks.
- 70% or more of account holders who start checkout complete payment.
- No confirmed cross-household data exposure or customer data loss.
- Failed payment, cancellation, export, deletion and restore paths work without
  manual database edits.
- Support demand stays within the founder's weekly capacity.

Keep paid acquisition paused until these criteria hold for one complete cohort.

## Positioning

### Primary customer

An Australian household that:

- receives income weekly or fortnightly;
- manages at least five recurring bills;
- shares money decisions with a partner or housemate; and
- wants a safe-to-spend number before the next payday.

### Core promise

> Know what your next payday needs to cover.

Harbourline turns income dates, bill due dates, savings and debt goals into a
plan the household can review each payday.

### Message house

| Layer | Message |
| --- | --- |
| Problem | The household knows its bills, but the timing of money still creates surprises. |
| Product | Harbourline shows what to set aside, what is safe to spend and what needs attention. |
| Proof | 13-week bills forecast, payday planning, shared household sync, savings and debt scenarios, exports. |
| Trust | AUD-first, account-protected, no bank credentials, no advertising or sale of financial data. |
| Offer | One plan at A$1 per week during early access. |
| CTA | Build your first payday plan. |

Use budgeting, cash-flow planning and financial education language. Keep
personalised investment, lending, insurance, superannuation and product
recommendations outside the product and its marketing.

### Homepage changes

The current homepage has the right feature set. Change the conversion path in
the next marketing pass:

- Replace “Sign up from the homepage” with “Build your first payday plan”.
- Put “Built for Australian households paid weekly or fortnightly” above the
  first call to action.
- Show the first-use sequence: add income, add five bills, open the payday plan.
- Add a short privacy block: “No bank passwords. No financial-product advice.
  Export or delete your data when you choose.”
- Add a FAQ covering price, cancellation, data location, Google Calendar sync,
  household sharing and the limits of the product.
- Keep the A$1/week price visible beside the primary CTA.
- Add campaign attribution without sending budget amounts, bill names or free
  text to analytics.

Suggested hero copy:

> Know what your next payday needs to cover.
>
> Harbourline helps Australian households set aside for bills, see what is safe
> to spend and keep savings and debt moving.

Primary CTA: `Start A$1/week early access`

Secondary CTA: `See how the payday plan works`

## Launch sequence

### Stage 0: Ready the funnel

Complete before inviting external customers.

- Confirm the production Supabase plan, region wording, backup retention and
  restore owner.
- Publish approved privacy, terms, billing, cancellation and refund wording.
- Configure custom-domain authentication email and the support inbox.
- Finish Stripe portal, failed-payment, renewal, refund and cancellation tests.
- Add Sentry alerts for frontend failures, Edge Function failures and webhook
  failures.
- Add first-touch campaign attribution and the acquisition events below.
- Create one operator view that shows funnel conversion by source and cohort.
- Test the homepage on mobile, including account confirmation and the handoff
  to the hosted app.

### Stage 1: Founder cohort, 5 to 10 households

Invite households through direct conversations and warm introductions. Offer a
15-minute setup call to the first five households. Watch them complete the
following path:

1. Create an account.
2. Subscribe.
3. Create a household.
4. Add income.
5. Add five recurring bills.
6. Open the payday plan.

Record the language customers use when they describe the problem. Use those
words in the homepage, onboarding and support replies.

### Stage 2: Controlled paid beta, 20 to 50 households

Release in batches of five to ten households each week. Send each batch a short
welcome message, an onboarding link and a clear support path.

Review the cohort every Monday:

- who paid;
- who reached a payday plan;
- who returned in the previous seven days;
- which onboarding step caused the most support;
- which source produced activated households; and
- whether any payment or data-safety issue needs a release pause.

### Stage 3: Public early access

Open public signup after the beta exit criteria hold. Keep the price and
positioning stable for the first public cohort. Add referral links and partner
distribution before testing paid advertising.

## Acquisition strategy

### Channel order

1. Founder network and direct outreach to households who match the profile.
2. Australian budgeting, frugal-living and household-finance communities, with
   moderator permission and useful contributions before any product mention.
3. Partnerships with bookkeepers, financial counsellors and household-planning
   educators who can share a neutral budgeting tool. Use legal review for any
   financial-services relationship.
4. Search content built around practical problems: bill provision, fortnightly
   budgeting, payday planning, safe-to-spend planning and debt payoff scenarios.
5. Paid search or social only after the beta shows retention and a measured
   acquisition cost below the six-month payback target.

### Content engine

Publish one useful “Payday note” each week. Turn the same source material into:

- one short article;
- one calculator, worksheet or worked example;
- one short screen recording;
- one email to the list; and
- two founder-approved social posts.

Automate drafting, formatting, UTM link creation and the publishing checklist.
Keep community posts, financial claims and customer stories human-approved.

Useful first topics:

- How to turn a fortnightly pay into weekly bill set-asides.
- The difference between a monthly budget and a payday plan.
- How to fund annual bills before they become urgent.
- A safe-to-spend method for households with irregular bills.
- How to compare debt payoff and savings allocations without guessing.

Avoid fear-based debt messaging, income promises, personalised financial
recommendations and claims that Harbourline prevents financial hardship.

## Automated funnel

The existing stack can run the core lifecycle: GitHub Pages homepage, Supabase
Auth and database, Supabase Edge Functions, Stripe and Resend. Add one daily
Supabase Cron job that calls a protected Edge Function to send eligible
messages. Supabase Cron can run SQL, database functions or HTTP calls to Edge
Functions; Resend supports email sending and delivery webhooks.

| Trigger | Automated action | Existing support | Add |
| --- | --- | --- | --- |
| Campaign landing | Store first-touch source, medium, campaign and landing path in a first-party cookie or local storage value. | Homepage exists. | Attribution capture and consent/privacy wording. |
| Account created | Associate the first-touch record with the account. | Supabase Auth signup exists. | Signup event and attribution handoff. |
| Checkout started | Record source and cohort. | `checkout_started` exists. | Link event to acquisition cohort. |
| Subscription active | Send welcome email and link to the app. | Welcome lifecycle email exists. | Add an idempotent message record and source context. |
| 24 hours paid, no household | Send a short “start your plan” email. | Onboarding progress exists. | Scheduled eligibility query and email template. |
| Household exists, no income | Send a one-step income prompt. | Onboarding step is stored. | Scheduled eligibility query and message suppression. |
| Income exists, fewer than five bills | Send the five-bill prompt. | `income_added` exists. | Scheduled eligibility query. |
| Payday view opened | Mark activation. | `payday_viewed` and `onboarding_completed` exist. | Funnel dashboard calculation. |
| Seven days with no payday view | Send a reminder with a direct app link. | Account email exists. | Scheduled reminder and frequency cap. |
| Onboarding complete, 14 days | Ask one product question and invite a reply. | Support event exists. | Feedback email and response capture. |
| Payment past due | Explain the issue and link to the billing portal. | Status is recorded. | Recovery email, retry timing and escalation alert. |
| Subscription cancelled | Explain end date and export path. | Cancellation email exists. | Add a one-question cancellation reason. |
| Support requested | Create an operator task or support email. | Event is recorded. | Support inbox automation and response-time alert. |

Send no customer-entered amounts, account names, bill descriptions or household
content to marketing systems. Use generic links and event states.

### Email sequence

Keep the sequence short and suppress each message as soon as the customer
reaches the relevant milestone.

| Timing | Subject direction | Stop condition |
| --- | --- | --- |
| On payment | Welcome to Harbourline | Onboarding complete |
| 1 day | Start with your next payday | Household created |
| 3 days | Add your regular income | Income added |
| 5 days | Add the bills that repeat | Five bills added or payday viewed |
| 7 days | Open your payday plan | Payday viewed |
| 14 days | What should Harbourline improve? | Reply received or support request |
| Weekly after activation | Review your next payday plan | Customer opts out or subscription ends |
| Past due | Update your payment method | Subscription active |

Use transactional email for account, payment and access messages. Treat product
education and launch updates as consent-based marketing email with a clear
unsubscribe path. Store the preference before sending a marketing message.
Keep both streams separate in the data model, sender configuration and
suppression logic.

## Measurement

### Acquisition events

Add these privacy-safe events to the marketing funnel:

- `landing_viewed`
- `cta_clicked`
- `signup_started`
- `signup_completed`
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

Store source metadata separately from operational events:

```text
marketing_touchpoints
- id
- anonymous_id
- user_id nullable
- source
- medium
- campaign
- content nullable
- landing_path
- first_seen_at
- last_seen_at

marketing_messages
- id
- user_id
- message_key
- channel
- sent_at
- provider_id nullable
- idempotency_key unique

marketing_preferences
- user_id primary key
- product_email_consent
- unsubscribed_at nullable
- updated_at
```

Keep access to these tables server-side. Use aggregate counts in the operator
view. Do not expose user-level marketing records to other household members.

### Weekly dashboard

Show these counts by week and acquisition source:

1. landing views;
2. account creation;
3. checkout starts;
4. paid subscriptions;
5. activation;
6. four-week retention;
7. support requests;
8. voluntary cancellations;
9. failed-payment cancellations; and
10. support minutes per active household.

The main decision metric is paid household to payday-plan activation. The
secondary metric is four-week retained usage. Page views and email opens support
diagnosis; they do not decide channel investment.

### Campaign naming

Use one consistent UTM format:

```text
utm_source=reddit|newsletter|partner|search|linkedin
utm_medium=community|email|referral|organic|paid
utm_campaign=early_access_2026_08
utm_content=payday_note_01|founder_demo_01
```

Use a distinct campaign link for each channel and message. Never put email
addresses or financial information in a URL parameter.

## Referral loop

Add referrals after the first 20 paid households complete onboarding. Give each
active household a private invite link for a partner or another household.
Start with recognition or early feedback access instead of a discount. The
A$1/week price leaves little room for referral economics, and a discount would
complicate the single-plan message.

Track:

- invite created;
- invite clicked;
- invite account created;
- invite subscribed; and
- referred household activated.

Ask the customer to invite someone only after they open a payday plan or return
for a second week.

## Implementation backlog

### P0: launch-critical

- Add first-touch attribution to the homepage and signup handoff.
- Add homepage, signup and funnel events with no financial payloads.
- Add lifecycle message storage with unique idempotency keys.
- Add scheduled onboarding and past-due emails through Resend.
- Add suppression rules and a frequency cap of one product-nudge email per 72
  hours.
- Add source and cohort aggregation to the operator dashboard.
- Add a billing-recovery email and a cancellation-reason prompt.
- Publish approved legal, privacy, billing and support pages.

### P1: beta learning

- Add one-question feedback email after activation.
- Add a support inbox task and response-time alert.
- Create five help articles from observed onboarding friction.
- Add a simple referral link after the first 20 activated households.
- Create the weekly Payday note content workflow.

### P2: public growth

- Add searchable practical calculators and worksheets.
- Add partner landing pages with distinct campaign links.
- Add a lightweight public case-study format using explicit customer consent.
- Test one paid channel with a fixed cap and a six-month payback rule.

## Launch operating rhythm

### Daily automation

- Send eligible lifecycle messages.
- Alert on failed email delivery, failed payment recovery and webhook errors.
- Refresh the operator funnel snapshot.

### Weekly founder review

- Read support requests and cancellation reasons.
- Watch one onboarding session or replay the flow with a test account.
- Pick one activation friction to remove.
- Publish one Payday note and its approved derivatives.
- Compare source-to-activation performance.

### Pause conditions

Pause new invitations when any of these occurs:

- a cross-household access defect;
- a confirmed data-loss incident;
- payment state and app access disagree;
- onboarding activation falls below 50% for two consecutive weekly batches; or
- support requests exceed the founder's response capacity.

Resume after the cause has a tested fix and the release record contains the
evidence.

## Recommended first 14 days

| Day | Work |
| --- | --- |
| 1 | Freeze the launch message and define the first cohort. |
| 2 | Add attribution fields, UTM links and funnel events. |
| 3 | Finish legal, support, billing and privacy pages. |
| 4 | Build lifecycle message storage and the daily sender. |
| 5 | Add welcome, activation-nudge and past-due templates. |
| 6 | Add source and cohort reporting to the operator view. |
| 7 | Run the full test matrix with a clean staging account. |
| 8 | Invite the first two households and observe setup. |
| 9 | Fix the highest-friction onboarding step. |
| 10 | Invite three more households and start the first Payday note. |
| 11 | Review activation and support signals. |
| 12 | Publish one practical article and one approved community contribution. |
| 13 | Rehearse failed payment, cancellation, export and deletion. |
| 14 | Decide whether to invite the next batch. |

## Current Harbourline foundation

Already in the repository:

- homepage-led account creation;
- A$1/week Stripe subscription flow;
- subscription lifecycle webhooks;
- welcome and cancellation emails;
- onboarding progress and activation events;
- privacy-safe operational events;
- an operator activity snapshot;
- Sentry monitoring hooks; and
- export and account deletion paths.

The launch work should extend this foundation. Keep one source of truth for
subscription state, one event vocabulary and one scheduled message sender.

## References

- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Vercel Cron management and secret protection](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Resend email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend webhooks](https://resend.com/docs/api-reference/webhooks/create-webhook)
- [ASIC RG 255: digital financial product advice](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-255-providing-digital-financial-product-advice-to-retail-clients/)

This plan is product and marketing guidance. Obtain Australian legal, privacy,
accounting and financial-services advice before relying on launch claims,
pricing, data-residency wording or partner arrangements.
