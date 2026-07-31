# Harbourline Production and Profitability Plan

Last reviewed: 31 July 2026

## Executive decision

Harbourline should launch as a controlled paid beta before a broad public
release. The product, account flow and Stripe sandbox checkout are far enough
along to support this, but live billing should not be enabled until customer
self-service, failed-payment handling, legal wording, recovery testing and
production monitoring are complete.

The commercial model remains:

- one subscription
- A$1 per week introductory early-access price
- no free plan
- no customer access without an active subscription

At A$1/week, payment fixed fees make the first few members economically thin;
the model improves as recurring volume grows. The main economic risks are
customer acquisition, churn, support time and compliance, not database or
hosting cost.

## Current position

Completed:

- public product homepage and hosted application
- account-based access with no customer local-budget option
- Google authentication
- Supabase household data and subscription state
- Stripe sandbox product, recurring price and webhook flow
- successful sandbox checkout flow ready for the A$1/week recurring price
- subscription gate opening after confirmed payment
- deployed customer billing portal, duplicate-checkout protection and
  replay-safe subscription webhook processing
- CodeQL, dependency-review and Dependabot repository safeguards
- source control, automated deployment and core project documentation
- deployment configuration validation and financial-data-scrubbed monitoring
  hooks
- resumable paid-member onboarding and a privacy-safe support entry point

Still required before live customers:

- Stripe live-mode configuration
- configure and complete sandbox testing of the customer billing portal,
  cancellation and payment recovery paths
- production and staging separation
- legal and accounting review
- legal review and publication of privacy, terms, billing, cancellation and
  refund documents
- transactional email on a Harbourline-controlled domain
- error monitoring, alerts and support workflow
- backup restoration and account deletion rehearsals
- closed-beta onboarding and product analytics
- staging and production execution of the paid early-access test matrix

## Production pathway

### Gate 1: Commercial and legal foundation

Target: complete before accepting live payment.

- Confirm the operating entity, ABN, business bank account and bookkeeping
  process with an accountant.
- Decide whether the advertised A$1/week price is GST-inclusive. Consumer
  pricing should be unambiguous.
- Obtain an Australian lawyer's review of the Terms of Service, Privacy Policy,
  subscription renewal, cancellation, refund and financial-guidance wording.
- Keep Harbourline positioned as budgeting, cash-flow planning and financial
  education. Do not recommend specific investments, superannuation products,
  insurance, credit products or lenders without specialist legal advice.
- Define a support email, response target and complaints process.
- Record all subprocessors and the location in which customer data is stored.

Why this is a launch gate: ASIC treats automated financial-product advice as
digital advice and its guidance covers licensing considerations. Harbourline
can offer useful calculations and general education while avoiding that
regulated boundary, but the exact product wording and algorithms require
Australian legal review.

### Gate 2: Live subscription lifecycle

Target: complete and test in sandbox, then reproduce in live mode.

- Create the live Stripe product with one recurring A$1/week price. Do not add
  a coupon or trial to the introductory price.
- Create a separate live webhook endpoint and live secrets.
- Configure and test the customer portal for payment-method updates, invoices
  and cancellation at period end. Keep immediate cancellation and plan changes
  disabled for the single-plan launch.
- Handle these states explicitly: `incomplete`, `active`, `past_due`,
  `unpaid`, `canceled` and `paused`.
- Process payment failures, successful renewals, cancellations and refunds,
  not only initial checkout.
- Make webhook processing idempotent and retain event IDs so replayed events
  cannot grant or remove access twice.
- Give a short grace period for recoverable failed payments, then remove access
  without deleting the household's data.
- Test cancellation at period end, immediate cancellation, payment recovery,
  refund, webhook delay and webhook replay.

Stripe recommends webhooks for subscription access because renewals, failures
and status changes are asynchronous. The database subscription record, not a
browser redirect, must remain the authority for app access.

### Gate 3: Production safety

Target: complete before the first paid beta cohort.

- Use Supabase Pro for production and keep sandbox/staging isolated from live
  customer data.
- Turn on provider spend caps and budget alerts where available.
- Require MFA for GitHub, Vercel, Supabase, Stripe, Google Cloud and the domain
  registrar.
- Verify Row Level Security with two unrelated test households.
- Configure custom SMTP and branded authentication emails.
- Add error reporting for frontend failures, Edge Function failures and
  unhandled webhook events.
- Alert on checkout failures, webhook delivery failures and elevated sign-in
  errors.
- Create a manual off-site logical database backup in addition to provider
  backups.
- Rehearse a restore, export, account deletion and household-data deletion.
- Write a lightweight incident-response checklist with an owner and customer
  communication template.

Supabase Pro currently includes daily backups with seven days of retention.
Point-in-time recovery is a separate add-on and should be considered after
revenue or risk justifies its cost.

### Gate 4: Closed paid beta

Target: 20 to 50 paying households over four to six weeks.

- Invite customers in small batches.
- Add a short onboarding flow that reaches first value quickly: income, five
  bills and the first payday plan.
- Instrument only the events needed to understand activation and retention.
  Do not send amounts, account names or financial descriptions to analytics.
- Conduct five observed onboarding sessions.
- Review support questions weekly and fix repeated friction.
- Do not start paid acquisition until four-week retention is understood.

Exit criteria:

- checkout completion above 70%
- at least 70% of paid users complete the activation event
- at least 60% four-week retained usage for the founding cohort
- no unresolved cross-household data exposure
- no confirmed data loss
- cancellation and failed-payment paths work without manual database editing

### Gate 5: Public launch

Target: open only after the beta exit criteria are met.

- Enable the public signup and checkout journey.
- Complete Microsoft sign-in.
- Publish customer-facing help, billing and cancellation pages.
- Add a public status page or concise service-status channel.
- Introduce referrals and partnerships before broad paid advertising.
- Review pricing after 100 paying households and again after 500.
- Delay native app wrappers and bank feeds until the web subscription has a
  reliable activation and retention loop.

## Unit economics

### Stripe cost per subscriber

This model uses Stripe Australia's published standard domestic-card fee of
1.7% + A$0.30 and Stripe Billing pay-as-you-go at 0.7% of billing volume.
Stripe states that Australian card-processing fees include GST.

| Charge | Customer pays | Payments fee | Billing fee | Net before platform costs |
| --- | ---: | ---: | ---: | ---: |
| One week | A$1.00 | A$0.317 | A$0.007 | A$0.676 |
| 52-week member | A$52.00 | A$16.484 | A$0.364 | A$35.152 |

The 52-week figure assumes 52 weekly invoices. Total estimated Stripe Payments
and Billing fees are A$16.848 per member-year.

International cards cost more. Keep the initial market and settlement currency
Australian where practical, and monitor the domestic/international mix rather
than assuming every payment will use the lowest rate.

### Core software cost

Supplier prices below are published in US dollars unless stated otherwise.
For internal budgeting only, this plan converts US$1 to A$1.60. Replace that
planning rate with the actual card statement rate each month.

| Tool | Entry production cost | Included scale | Cost trigger |
| --- | ---: | --- | --- |
| Supabase Pro | about A$40/month | 100,000 MAU, 8 GB database, 250 GB egress, daily backups | database, egress, compute or MAU overage |
| Vercel Pro | about A$32/month for one developer | US$20 usage credit | traffic, functions, builds or extra developer seats |
| Resend Free | A$0 | 3,000 emails/month and 100/day | launch bursts or more than 3,000 emails |
| Resend Pro | about A$32/month | 50,000 emails/month | more than 50,000 emails |
| GitHub and Pages | A$0 at the current public tier | source control, CI and marketing page | private/team controls or excess CI usage |
| Domain and DNS | plan A$3/month | one product domain | additional domains or premium DNS |
| Stripe | variable | no fixed platform fee in this model | each successful invoice |

Recommended minimum core stack:

- up to about 750 members at four emails each per month: approximately A$75/month
- above the Resend free allowance: approximately A$107/month
- hold a further 20% infrastructure reserve for usage and foreign-exchange
  movement

These figures exclude founder time, legal advice, accounting, insurance,
customer acquisition and optional monitoring products.

### One-off launch reserve

Use a separate launch budget rather than expecting the first subscriptions to
fund production preparation. These are planning allowances, not supplier
quotes:

| Item | Planning allowance |
| --- | ---: |
| Australian legal review and document revisions | A$2,000-A$7,500 |
| Accounting, structure and GST setup advice | A$500-A$2,000 |
| Independent privacy/security review | A$1,000-A$5,000 |
| Domain, business email and launch administration | A$200-A$600 |
| Insurance advice and first-year cover | A$800-A$2,500 |
| Contingency | A$1,000-A$2,000 |

A lean founder-led beta may fit inside A$5,000-A$8,000 if professional reviews
are tightly scoped. A more prudent production reserve is A$10,000-A$15,000.
Obtain written quotes before committing, and do not reduce the legal or
security scope merely to make the spreadsheet look profitable.

### Member scaling model

The table shows a steady-state month where every member is paying A$1/week
with a domestic card, using 52/12 weeks per month. "Contribution" is revenue
less estimated Stripe fees and core software. It is not accounting profit and
excludes GST, tax, support labour, marketing and professional services.

| Paying members | MRR | Stripe fees | Core software | Contribution before overhead |
| ---: | ---: | ---: | ---: | ---: |
| 25 | A$108.33 | A$35.10 | A$75 | -A$1.77 |
| 100 | A$433.33 | A$140.40 | A$75 | A$217.93 |
| 500 | A$2,166.67 | A$702.00 | A$75 | A$1,389.67 |
| 1,000 | A$4,333.33 | A$1,404.00 | A$107 | A$2,822.33 |
| 2,500 | A$10,833.33 | A$3,510.00 | A$107 | A$7,216.33 |
| 5,000 | A$21,666.67 | A$7,020.00 | A$107 | A$14,539.67 |

Core platform break-even is approximately 26 steady-state subscribers:

```text
A$75 / A$2.929 net contribution per A$1/week member-month = 25.6
```

A more realistic operating break-even should include a monthly allowance for
accounting, support, monitoring, insurance, legal work and marketing. With
A$500 of monthly overhead in addition to the core stack, break-even becomes
approximately 197 steady-state subscribers.

### GST and tax planning

The ATO requires most Australian businesses to register for GST when GST
turnover reaches A$75,000. At a steady A$1/week, that is roughly 1,443 paying
members:

```text
A$75,000 / (A$1 x 52) = 1,442.3 members
```

The actual threshold timing depends on current and projected GST turnover, the
introductory month, other business revenue and the business structure. Use an
accountant. If the public prices are GST-inclusive, the GST component is 1/11
of the collected amount before eligible input-tax credits.

Income tax, founder drawings and payroll are deliberately not treated as
software costs. Keep a separate tax reserve account and set the reserve
percentage with an accountant.

## Profit levers

### Retention before acquisition

At A$1/week, Harbourline cannot support careless paid acquisition. The
strongest early profit lever is keeping customers long enough for the recurring
margin to accumulate.

Approximate contribution lifetime before fixed platform costs:

| Monthly churn | Approximate lifetime | Approximate contribution lifetime |
| ---: | ---: | ---: |
| 3% | 33 months | about A$97 |
| 5% | 20 months | about A$59 |
| 8% | 13 months | about A$38 |

These are directional estimates using a recurring A$1/week price and the
estimated net contribution before fixed platform costs. Cohort data should
replace them as soon as Harbourline has real customers.

Until retention is known:

- favour founder-led onboarding, referrals, community partnerships and useful
  educational content
- target customer acquisition cost below A$20
- do not scale a paid channel unless its payback is under six months
- review churn reasons every month

### Reduce payment friction

The A$0.30 fixed card fee is 30% of a A$1 weekly invoice before percentage fees.
Do not change the one-plan launch now, but after retention is proven, test an
optional annual payment. Fewer invoices can improve payment margin and reduce
involuntary churn. Any annual offer should be a billing-frequency option for
the same product, not a confusing second feature tier.

### Protect support margin

- design onboarding around the first payday plan
- put explanations next to calculations
- provide self-service billing and account recovery
- create short help articles from repeated support questions
- track support minutes per active subscriber
- avoid adding complex features that do not improve activation or retention

## Metrics dashboard

Review weekly during beta and monthly after launch:

- visitors to account creation
- account creation to checkout start
- checkout completion
- paid user to activation
- weekly and four-week retention
- monthly recurring revenue
- new MRR, expansion MRR, contraction MRR and churned MRR
- voluntary and failed-payment churn
- average revenue per paying household
- Stripe fee percentage
- software cost per paying household
- support minutes per active household
- customer acquisition cost by channel
- contribution margin and cash runway

Never send customer-entered financial amounts or descriptions into marketing
analytics.

## Cost control thresholds

| Threshold | Decision |
| --- | --- |
| 20 paid households | confirm onboarding and support process |
| 50 paid households | formal beta review and restore rehearsal |
| 100 paid households | review pricing, churn and customer acquisition |
| 750 paid households or 3,000 monthly emails | move email to the appropriate paid allowance |
| 1,000 paid households | obtain a fresh privacy, security and insurance review |
| approaching A$75,000 GST turnover | complete GST registration planning with accountant |
| 5,000 paid households | load test, review compute, support staffing and incident coverage |
| 100,000 MAU or provider allowance pressure | negotiate or model the next infrastructure tier before overage |

## Work Codex can execute next

In recommended order:

1. Build and test the Stripe customer portal and cancellation experience.
2. Harden webhook idempotency, renewal, failure, refund and grace-period logic.
3. Separate sandbox/staging and live configuration and add deployment checks.
4. Add production-safe operational events and an owner dashboard for MRR,
   churn, failed payments and activation.
5. Configure branded transactional email and customer lifecycle templates.
6. Finalise the legal-document drafts with an Australian lawyer, then publish
   the approved Privacy Policy, Terms and billing/cancellation wording.
7. Build onboarding and the activation funnel without exposing financial data
   to analytics.
8. Add backup/export automation, a restore rehearsal and incident runbook.
9. Run the closed-beta production-readiness test matrix.

The repository now contains the onboarding flow, deployment guard and test
matrix structure. The remaining work is to connect real staging and production
services, execute the matrix, and record the evidence.

## Launch rule

Do not turn on live signup merely because live Stripe keys exist. Launch when
Harbourline can reliably answer all four questions:

1. Can a customer subscribe and gain access without manual intervention?
2. Can a customer update payment details or cancel without contacting us?
3. Can a failed payment or webhook replay be handled without incorrect access?
4. Can customer data be recovered, exported and deleted safely?

## Sources and assumptions

Official references reviewed on 31 July 2026:

- [Stripe Australia pricing](https://stripe.com/au/pricing)
- [Stripe Billing pricing](https://stripe.com/au/billing/pricing)
- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Vercel pricing](https://vercel.com/pricing)
- [Resend pricing](https://resend.com/pricing)
- [ASIC RG 255: digital financial product advice](https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/rg-255-providing-digital-financial-product-advice-to-retail-clients/)
- [OAIC small-business privacy guidance](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business)
- [Australian Consumer Law and business](https://business.gov.au/legal/fair-trading/australian-consumer-law-and-your-business)
- [ATO GST overview](https://www.ato.gov.au/api/public/content/0-28262f91-6835-40bb-a9fe-99ee7d0b7c72)

Provider prices, exchange rates and regulations change. Recheck the model before
launch and quarterly thereafter. This plan is operational guidance, not legal,
tax or financial advice.
