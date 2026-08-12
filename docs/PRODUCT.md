# Harbourline Product Foundation

## Product promise

Harbourline helps Australian households turn each payday into a clear plan for
bills, spending, debt and savings.

The product is designed for households that are paid weekly or fortnightly and
need to provision for expenses that arrive on different schedules.

## Primary customer

The initial customer is an Australian household that:

- manages at least five recurring bills
- receives income weekly or fortnightly
- wants to coordinate money with a partner
- needs a reliable safe-to-spend figure
- is actively building savings or paying down debt

## Core job

On payday, a household should be able to answer:

1. How much income arrived?
2. How much must move to the bills account?
3. Which bills are underfunded?
4. How much is allocated to savings and extra debt?
5. What is safe to spend until the next payday?

## Product principles

- Account-based for continuity: all application access requires a Harbourline account and sign-in; paid hosted access additionally requires an internet connection.
- Household-first for cloud plans: paid plans belong to a household, not a single device or person; the Free Starter remains local to one browser and device.
- Explainable: every projection exposes the inputs and calculation behind it.
- Australian by default: AUD, en-AU dates and Australian pay cycles.
- No advertising or sale of financial data.
- Portable: users can export and delete their data at any time.
- Focused: every supported customer receives the same core planning experience;
  paid cloud continuity additionally uses Supabase-backed account and household services.

### Currency availability

Harbourline is AUD-first. The current public release enables Australian dollars
(AUD) for budgeting and the introductory subscription; additional currencies are
pilot-only and must not be promised until their payment, tax, reporting,
precision, support and recovery gates are approved. Budget currency is metadata
for a household plan, not a foreign-exchange service, and Harbourline never
moves or converts customer money.

The product contains reviewed definitions for `AUD`, `BHD`, `CAD`, `EUR`, `GBP`,
`INR`, `JPY`, `MXN`, `NZD`, `SGD` and `USD`, but those definitions are not a
customer availability promise. The current public account experience and
database enable `AUD` only. A future pilot will name its enabled code, locale
and minor-unit precision in the account experience and release record.

A currency change never converts a non-empty budget. Users who need another
currency should keep an export and start a new empty budget only when that
currency appears in their approved account experience.

## Commercial model

### Harbourline

#### Free Starter

The Free Starter lets a household:

- build a local income, bills, savings and debt plan;
- use the payday planning and safe-to-spend views;
- keep the plan on one browser and device; and
- export a portable copy at any time.

An account and sign-in are required to use the application, but no payment card
is required. The browser copy is local, is scoped to the signed-in account on
that device, and is not a cloud backup; it may be lost if browser storage is
cleared.

#### Paid Household plan

The paid plan includes:

- secure cloud sync
- multi-device synchronisation
- one shared household
- household member invitations
- optional Google Calendar synchronisation

Introductory early-access pricing is A$2.50 per week on one recurring plan.
The subscription currency is configured independently from a budget's display
currency; it is not converted at checkout. Account creation is available from
the public Harbourline homepage only. The hosted application requires sign-in
for both the free local starter and paid cloud features; payment is only
required for the paid Household plan.

### Currency and pricing help

- **Which currencies are supported?** The current public release supports AUD.
  The source catalog has additional reviewed metadata, but a currency is not
  available until it is listed in your account and enabled in the release.
- **Will Harbourline convert my existing budget?** No. A non-empty budget is not
  silently converted; start a new empty budget and retain the original export.
- **Is the subscription charged in my budget currency?** Not necessarily. The
  subscription uses the reviewed Stripe price configured for the release, and
  Harbourline does not perform foreign exchange.
- **How are amounts rounded?** Input and recurring calculations use the selected
  currency's minor-unit precision. Values are rounded half-up at that boundary;
  zero-decimal currencies such as JPY do not inherit AUD's two-decimal rule.
- **What currency is displayed and settled?** The selected budget locale formats
  the planning display. Subscription charges and refunds use the original
  provider Price currency. Harbourline does not choose an FX rate or rewrite a
  budget for a settlement conversion.
- **How are refunds handled?** Refunds use the original provider billing
  currency and integer amount through the approved Stripe/support process.
  Support cannot promise an exchange-rate equivalent.
- **How is revenue checked?** Charges, refunds, credits and subscription access
  are reconciled by currency and provider ID. Provider payout conversion is an
  accounting concern and does not change the customer charge or budget.

### Bank connectivity

Automatic bank feeds are a later capability. They will be introduced only
after the product has a validated retention loop and a compliant Consumer Data
Right integration path.

### Google Calendar sync

Harbourline now offers optional Google Calendar synchronisation for the
calendar module. The first scope lets a paid customer authorise Google
Calendar and create, update and remove calendar events for planned paydays and
bill due dates.

The integration must be user-controlled and privacy-safe:

- Google access is granted through OAuth and can be disconnected or revoked.
- Harbourline never receives Google passwords or bank credentials.
- Event content avoids financial amounts and sensitive descriptions by default.
  Customers can explicitly opt in to showing expense names in bill titles; the
  setting is off by default and remains one-way Harbourline-to-Google.
- Calendar sync must not expose one household member's private data to another
  Google account without household permission.
- Account deletion and disconnect must document what happens to previously
  created Google Calendar events.

The initial implementation is one-way Harbourline-to-Google synchronisation;
two-way editing remains separate because edits in Google Calendar need
conflict, ownership and deletion rules.

## Success measures

- Activation: income plus five expenses plus a completed payday plan.
- Weekly value: the household opens the payday view and confirms allocations.
- Four-week retention: the household returns in at least three of four weeks.
- Reliability: no confirmed loss or cross-household exposure of customer data.
- Commercial validation: at least 25 paying founding households.

## Out of scope for the first paid release

- specific investment, superannuation, insurance or credit recommendations
- direct custody or movement of customer money
- bank credential collection
- financial product comparison
- open-ended AI advice
- native app-store billing
