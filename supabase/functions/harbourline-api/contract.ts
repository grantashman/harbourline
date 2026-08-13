const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface BillsQuery {
  dueAfter?: string;
  dueBefore?: string;
  search?: string;
  limit: number;
}

export interface TokenCreateRequest {
  householdId: string;
  name: string;
  expiresInDays: number;
}

export interface ApiBill {
  id: string;
  name: string;
  category: string;
  frequency: string;
  due: string;
  amountMinor: string | null;
  amountMajor: string | null;
  reservedAmountMinor: string | null;
  debtBalanceMinor: string | null;
  interestRate: number | null;
}

export type ApiRoute =
  | { resource: "households" }
  | { resource: "bills" | "status"; householdId: string }
  | { resource: "tokens" }
  | { resource: "token"; tokenId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireUuid(
  value: string,
  message = "household ID must be a UUID",
): string {
  if (!UUID_PATTERN.test(value)) throw new Error(message);
  return value;
}

function requireIsoDate(value: string, field: string): string {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${field} must be a valid ISO date (YYYY-MM-DD)`);
  }
  return value;
}

export function parseApiRoute(input: string): ApiRoute {
  const url = new URL(input);
  const prefix = "/functions/v1/harbourline-api/v1";
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== prefix && !path.startsWith(`${prefix}/`)) {
    throw new Error("Unknown Harbourline API route");
  }

  const segments = path.slice(prefix.length).split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    (segments.length === 1 && segments[0] === "households")
  ) {
    return { resource: "households" };
  }
  if (segments.length === 1 && segments[0] === "tokens") {
    return { resource: "tokens" };
  }
  if (segments.length === 2 && segments[0] === "tokens") {
    return {
      resource: "token",
      tokenId: requireUuid(segments[1]!, "token ID must be a UUID"),
    };
  }
  if (
    segments.length === 3 && segments[0] === "households" &&
    (segments[2] === "bills" || segments[2] === "status")
  ) {
    return { resource: segments[2], householdId: requireUuid(segments[1]!) };
  }
  throw new Error("Unknown Harbourline API route");
}

export function parseTokenCreateRequest(value: unknown): TokenCreateRequest {
  if (!isRecord(value)) throw new Error("Request body must be an object");
  const allowedKeys = new Set(["householdId", "name", "expiresInDays"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Request body contains unsupported fields");
  }
  if (typeof value.householdId !== "string") {
    throw new Error("householdId is required");
  }
  const householdId = requireUuid(value.householdId);
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 80) {
    throw new Error("name must be between 1 and 80 characters");
  }
  const expiresInDays = value.expiresInDays === undefined
    ? 30
    : Number(value.expiresInDays);
  if (
    !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365
  ) {
    throw new Error("expiresInDays must be between 1 and 365");
  }
  return { householdId, name, expiresInDays };
}

export function parseBillsQuery(search: string): BillsQuery {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const dueAfter = params.get("due_after") ?? undefined;
  const dueBefore = params.get("due_before") ?? undefined;
  const searchTerm = params.get("q")?.trim() || undefined;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? 100 : Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be between 1 and 100");
  }
  if (dueAfter) requireIsoDate(dueAfter, "due_after");
  if (dueBefore) requireIsoDate(dueBefore, "due_before");
  if (dueAfter && dueBefore && dueAfter >= dueBefore) {
    throw new Error("due_after must be before due_before");
  }
  if (searchTerm && searchTerm.length > 100) {
    throw new Error("q must be 100 characters or fewer");
  }

  return {
    ...(dueAfter ? { dueAfter } : {}),
    ...(dueBefore ? { dueBefore } : {}),
    ...(searchTerm ? { search: searchTerm } : {}),
    limit,
  };
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function nullableMinor(value: unknown): string | null {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value)) {
    return null;
  }
  return BigInt(value).toString();
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function minorToMajor(value: string, minorUnit: number): string {
  if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6) {
    throw new Error(
      "Currency minor-unit precision must be an integer from 0 to 6",
    );
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  if (minorUnit === 0) return `${negative ? "-" : ""}${unsigned}`;
  const padded = unsigned.padStart(minorUnit + 1, "0");
  const splitAt = padded.length - minorUnit;
  return `${negative ? "-" : ""}${padded.slice(0, splitAt)}.${
    padded.slice(splitAt)
  }`;
}

function majorToDisplay(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (
    typeof value === "string" &&
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value.trim())
  ) return value.trim();
  return null;
}

export function projectBills(
  state: unknown,
  currency: string,
  minorUnit: number,
): ApiBill[] {
  const source = isRecord(state) ? state : {};
  const exactMoney = source.moneyRepresentation === "minor-unit-string";
  const expenses = Array.isArray(source.expenses) ? source.expenses : [];

  return expenses.flatMap((value): ApiBill[] => {
    if (!isRecord(value)) return [];
    const id = text(value.id);
    if (!id) return [];
    const amountMinor = exactMoney ? nullableMinor(value.amount) : null;
    const reservedAmountMinor = exactMoney
      ? nullableMinor(value.reservedAmount)
      : null;
    const debtBalanceMinor = exactMoney
      ? nullableMinor(value.debtBalance)
      : null;
    return [{
      id,
      name: text(value.name, "Unnamed bill"),
      category: text(value.category, "Other"),
      frequency: text(value.frequency, "monthly"),
      due: text(value.due),
      amountMinor,
      amountMajor: amountMinor === null
        ? majorToDisplay(value.amount)
        : minorToMajor(amountMinor, minorUnit),
      reservedAmountMinor,
      debtBalanceMinor,
      interestRate: nullableNumber(value.interestRate),
    }];
  });
}

export function filterBills(bills: ApiBill[], query: BillsQuery): ApiBill[] {
  const search = query.search?.toLowerCase();
  return bills
    .filter((bill) => !query.dueAfter || bill.due > query.dueAfter)
    .filter((bill) => !query.dueBefore || bill.due < query.dueBefore)
    .filter((bill) =>
      !search || `${bill.name} ${bill.category}`.toLowerCase().includes(search)
    )
    .slice(0, query.limit);
}
