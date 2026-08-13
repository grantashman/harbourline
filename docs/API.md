# Harbourline API

Harbourline exposes a small, read-only automation API through the Supabase Edge
Function `harbourline-api`. It is intended for integrations such as an email
workflow that needs to inspect upcoming bills before proposing an import.

## Safety boundary

- Browser sessions may use the existing Supabase JWT.
- Automation should use a household-scoped API key.
- API keys are created by an authenticated household owner, shown once, stored
  only as a SHA-256 hash, and can be revoked or allowed to expire.
- API keys are read-only in this first release. There is deliberately no
  endpoint that writes a bill or replaces a budget document.
- Bills are projected from the existing versioned household budget document;
  the full document, transactions, account details and household membership
  are not returned by the bills endpoint.
- Exact schema-version-4 money is returned as both integer minor units and a
  display decimal. Legacy documents expose the original display amount but
  return `null` for exact minor units rather than implying precision that is not
  available.

## Base URL

```text
https://<supabase-project-ref>.supabase.co/functions/v1/harbourline-api/v1
```

The Edge Function is intentionally configured with `verify_jwt = false` so it
can accept either a Supabase JWT or an automation key. The function itself
performs the authentication and authorization checks.

## Token lifecycle

Token management uses the existing Supabase-authenticated session and is owner-only.

```http
POST /tokens
Authorization: Bearer <supabase-access-token>
Content-Type: application/json

{
  "householdId": "<household-uuid>",
  "name": "Bills inbox",
  "expiresInDays": 90
}
```

The response contains the raw `token` exactly once. Store it in the email
automation secret store. Subsequent calls list metadata only:

```http
GET /tokens
Authorization: Bearer <supabase-access-token>
```

Revoke a token with:

```http
DELETE /tokens/<token-uuid>
Authorization: Bearer <supabase-access-token>
```

## Query endpoints

List households for the authenticated user:

```http
GET /households
Authorization: Bearer <supabase-access-token>
```

Query bills with a user JWT:

```http
GET /households/<household-uuid>/bills?due_after=2026-08-01&due_before=2026-09-01&limit=50
Authorization: Bearer <supabase-access-token>
```

Query bills with an automation key:

```http
GET /households/<household-uuid>/bills?due_after=2026-08-01&limit=50
Authorization: Bearer hl_live_<token>
```

The equivalent `X-Harbourline-Api-Key` header is also accepted. API keys may
only query the household they were created for.

The bills response has this shape:

```json
{
  "household": {
    "id": "...",
    "name": "Our household",
    "currency": "AUD",
    "revision": 42,
    "updatedAt": "2026-08-13T00:00:00.000Z"
  },
  "bills": [
    {
      "id": "rent",
      "name": "Rent",
      "category": "Housing",
      "frequency": "monthly",
      "due": "2026-08-15",
      "amountMinor": "123456",
      "amountMajor": "1234.56",
      "reservedAmountMinor": "123456",
      "debtBalanceMinor": null,
      "interestRate": null
    }
  ]
}
```

Date filters are exclusive: `due_after` means later than the given date and
`due_before` means earlier than the given date. `limit` is bounded to 1–100.
The `q` parameter searches bill name and category.

A compact status query is available at:

```http
GET /households/<household-uuid>/status
Authorization: Bearer <supabase-access-token-or-api-key>
```

It returns the household revision, last update and bill count, and explicitly
marks the result as `readOnly: true`.

## Future write path

Email automation should first parse a bill into a proposed record and present it
for approval. A future write endpoint should use an idempotency key, the current
budget revision, exact-money validation, audit records, and an explicit approval
boundary before it calls the existing `sync_budget` function. Do not bypass
`sync_budget` with direct `budget_documents` updates.
