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

- Account-based: hosted access requires a Harbourline account and an internet connection.
- Household-first: plans belong to a household, not a single device or person.
- Explainable: every projection exposes the inputs and calculation behind it.
- Australian by default: AUD, en-AU dates and Australian pay cycles.
- No advertising or sale of financial data.
- Portable: users can export and delete their data at any time.
- Focused: every supported customer uses the same Supabase-backed product and
  receives the same core planning experience.

## Commercial model

### Harbourline

The only plan includes:

- secure cloud backup
- multi-device synchronisation
- one shared household
- household member invitations
- reminders and history
- advanced plan comparisons
- priority support during the introductory release

Introductory early-access pricing is A$1 per week on one recurring plan.
Account creation is available from the public Harbourline homepage only. The
hosted application provides sign-in and payment handoff, but does not expose
registration.

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
- Event content should avoid financial amounts and sensitive descriptions by
  default, with any richer detail requiring an explicit product decision.
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
