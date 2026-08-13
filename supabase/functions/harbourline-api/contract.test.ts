import assert from "node:assert/strict";
import test from "node:test";
import {
  type ApiBill,
  filterBills,
  parseApiRoute,
  parseBillsQuery,
  parseTokenCreateRequest,
  projectBills,
} from "./contract.ts";
import { generateApiKey, hashApiKey, isApiKey } from "./api-key.ts";

test("parses the versioned household bills route", () => {
  assert.deepEqual(
    parseApiRoute(
      "https://harbourline.app/functions/v1/harbourline-api/v1/households/20000000-0000-0000-0000-000000000001/bills",
    ),
    {
      resource: "bills",
      householdId: "20000000-0000-0000-0000-000000000001",
    },
  );
});

test("parses the runtime-relative household bills route", () => {
  assert.deepEqual(
    parseApiRoute(
      "https://harbourline.app/v1/households/20000000-0000-0000-0000-000000000001/bills",
    ),
    {
      resource: "bills",
      householdId: "20000000-0000-0000-0000-000000000001",
    },
  );
});
test("parses the Supabase function-prefix household bills route", () => {
  assert.deepEqual(
    parseApiRoute(
      "https://harbourline.app/functions/v1/harbourline-api/households/20000000-0000-0000-0000-000000000001/bills",
    ),
    {
      resource: "bills",
      householdId: "20000000-0000-0000-0000-000000000001",
    },
  );
});

test("parses a gateway-prefixed household bills route", () => {
  assert.deepEqual(
    parseApiRoute(
      "https://harbourline.app/runtime/functions/v1/harbourline-api/households/20000000-0000-0000-0000-000000000001/bills",
    ),
    {
      resource: "bills",
      householdId: "20000000-0000-0000-0000-000000000001",
    },
  );
});

test("rejects an unknown API route", () => {
  assert.throws(
    () =>
      parseApiRoute(
        "https://harbourline.app/functions/v1/harbourline-api/v1/households/not-a-uuid/bills",
      ),
    /household ID must be a UUID/,
  );
});

test("parses token management routes and bounded token creation", () => {
  assert.deepEqual(
    parseApiRoute(
      "https://harbourline.app/functions/v1/harbourline-api/v1/tokens",
    ),
    { resource: "tokens" },
  );
  assert.deepEqual(
    parseTokenCreateRequest({
      householdId: "20000000-0000-0000-0000-000000000001",
      name: "Bills inbox",
      expiresInDays: 90,
    }),
    {
      householdId: "20000000-0000-0000-0000-000000000001",
      name: "Bills inbox",
      expiresInDays: 90,
    },
  );
  assert.throws(() =>
    parseTokenCreateRequest({
      householdId: "20000000-0000-0000-0000-000000000001",
      name: "Bills inbox",
      expiresInDays: 366,
    }), /expiresInDays must be between 1 and 365/);
});

test("rejects non-number token expiry values", () => {
  for (const expiresInDays of [true, [90], null, "90"]) {
    assert.throws(
      () =>
        parseTokenCreateRequest({
          householdId: "20000000-0000-0000-0000-000000000001",
          name: "Bills inbox",
          expiresInDays,
        }),
      /expiresInDays must be a number/,
    );
  }
});

test("parses bounded bill query filters", () => {
  assert.deepEqual(
    parseBillsQuery("?due_after=2026-08-01&due_before=2026-08-31&limit=25"),
    { dueAfter: "2026-08-01", dueBefore: "2026-08-31", limit: 25 },
  );
  assert.throws(
    () => parseBillsQuery("?limit=101"),
    /limit must be between 1 and 100/,
  );
});

test("projects exact minor-unit bills without converting through floating point", () => {
  const bills = projectBills(
    {
      currency: "AUD",
      moneyRepresentation: "minor-unit-string",
      expenses: [
        {
          id: "rent",
          name: "Rent",
          category: "Housing",
          amount: "123456",
          frequency: "monthly",
          due: "2026-08-15",
          reservedAmount: "123456",
        },
      ],
    },
    "AUD",
    2,
  );

  assert.deepEqual(bills[0], {
    id: "rent",
    name: "Rent",
    category: "Housing",
    frequency: "monthly",
    due: "2026-08-15",
    amountMinor: "123456",
    amountMajor: "1234.56",
    reservedAmountMinor: "123456",
    debtBalanceMinor: null,
    interestRate: null,
  });
});

test("rejects malformed exact-money documents instead of downgrading them", () => {
  assert.throws(
    () =>
      projectBills(
        {
          currency: "USD",
          moneyRepresentation: "minor-unit-string",
          expenses: [{
            id: "rent",
            amount: 12345,
            reservedAmount: "12345",
          }],
        },
        "AUD",
        2,
      ),
    /currency does not match/,
  );
  assert.throws(
    () =>
      projectBills(
        {
          currency: "AUD",
          moneyRepresentation: "minor-unit-string",
          expenses: [{
            id: "rent",
            amount: 12345,
            reservedAmount: "12345",
          }],
        },
        "AUD",
        2,
      ),
    /Exact-money value is invalid at \$\.expenses\[0\]\.amount/,
  );
  assert.throws(
    () =>
      projectBills(
        {
          currency: "AUD",
          moneyRepresentation: "minor-unit-string",
          expenses: [{ id: "rent", amount: "12345" }],
        },
        "AUD",
        2,
      ),
    /Exact-money bill field is invalid at \$\.expenses\[0\]\.reservedAmount/,
  );
});

test("marks legacy major-unit bills rather than inventing exact minor units", () => {
  const bills = projectBills(
    {
      expenses: [{
        id: "internet",
        name: "Internet",
        category: "Utilities",
        amount: 89.95,
        frequency: "monthly",
        due: "2026-08-20",
        reservedAmount: 89.95,
      }],
    },
    "AUD",
    2,
  );

  assert.equal(bills[0]?.amountMinor, null);
  assert.equal(bills[0]?.amountMajor, "89.95");
  assert.equal(bills[0]?.reservedAmountMinor, null);
});

test("uses the currency catalog precision for exact minor-unit bills", () => {
  const bills = projectBills(
    {
      currency: "BHD",
      moneyRepresentation: "minor-unit-string",
      expenses: [{
        id: "tax",
        name: "Tax",
        category: "Government",
        amount: "1234",
        frequency: "monthly",
        due: "2026-08-20",
        reservedAmount: "0",
      }],
    },
    "BHD",
    3,
  );

  assert.equal(bills[0]?.amountMajor, "1.234");
});

test("filters bills by ISO due dates and preserves stable ordering", () => {
  const bills: ApiBill[] = [
    {
      id: "a",
      name: "A",
      category: "",
      frequency: "monthly",
      due: "2026-08-01",
      amountMinor: "1",
      amountMajor: "0.01",
      reservedAmountMinor: "0",
      debtBalanceMinor: null,
      interestRate: null,
    },
    {
      id: "b",
      name: "B",
      category: "",
      frequency: "monthly",
      due: "2026-08-15",
      amountMinor: "2",
      amountMajor: "0.02",
      reservedAmountMinor: "0",
      debtBalanceMinor: null,
      interestRate: null,
    },
    {
      id: "c",
      name: "C",
      category: "",
      frequency: "monthly",
      due: "2026-09-01",
      amountMinor: "3",
      amountMajor: "0.03",
      reservedAmountMinor: "0",
      debtBalanceMinor: null,
      interestRate: null,
    },
  ];

  assert.deepEqual(
    filterBills(bills, {
      dueAfter: "2026-08-01",
      dueBefore: "2026-08-31",
      limit: 100,
    }).map((bill) => bill.id),
    ["b"],
  );
});

test("API keys are prefixed, one-time-verifiable, and hashable", async () => {
  const generated = generateApiKey(() =>
    new Uint8Array(Array.from({ length: 32 }, (_, index) => index))
  );
  assert.equal(isApiKey(generated.token), true);
  assert.equal(generated.token.startsWith("hl_live_"), true);
  assert.equal(generated.prefix, generated.token.slice(0, 20));
  assert.equal(
    await hashApiKey(generated.token),
    await hashApiKey(generated.token),
  );
  assert.notEqual(
    await hashApiKey(generated.token),
    await hashApiKey(`${generated.token}x`),
  );
  assert.equal(isApiKey("not-a-harbourline-key"), false);
});
