import {
  type SupabaseClient,
  type User,
} from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  createServiceRoleClient,
  errorResponse,
  HttpError,
  jsonResponse,
  requireAuthenticatedUser,
} from "../_shared/beta.ts";
import { generateApiKey, hashApiKey, isApiKey } from "./api-key.ts";
import {
  type ApiRoute,
  type BillsQuery,
  filterBills,
  parseApiRoute,
  parseBillsQuery,
  parseTokenCreateRequest,
  projectBills,
  type TokenCreateRequest,
} from "./contract.ts";

const API_CORS_HEADERS = {
  ...corsHeaders,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-harbourline-api-key",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function withApiCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(API_CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const TOKEN_PREFIX_LENGTH = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TokenRow = {
  id: string;
  household_id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

type HouseholdRow = {
  id: string;
  name: string;
  currency: string;
  updated_at: string;
};

type CurrencyRow = {
  minor_unit: number;
};

type MembershipRow = {
  household_id: string;
  role: "owner" | "member";
};

type BudgetRow = {
  household_id: string;
  revision: number;
  schema_version: number;
  state: unknown;
  updated_at: string;
};

function requireMethod(request: Request, ...methods: string[]): void {
  if (!methods.includes(request.method)) {
    throw new HttpError(405, "Method not allowed");
  }
}

function parseRoute(request: Request): ApiRoute {
  try {
    return parseApiRoute(request.url);
  } catch (error) {
    throw new HttpError(
      error instanceof Error && error.message.includes("Unknown") ? 404 : 400,
      error instanceof Error ? error.message : "Invalid API route",
    );
  }
}

function parseQuery(request: Request): BillsQuery {
  try {
    return parseBillsQuery(new URL(request.url).search);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Invalid bill query",
    );
  }
}

function parseTokenBody(value: unknown): TokenCreateRequest {
  try {
    return parseTokenCreateRequest(value);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Invalid token request",
    );
  }
}

function requireUuid(
  value: string,
  message = "A valid UUID is required",
): string {
  if (!UUID_PATTERN.test(value)) throw new HttpError(400, message);
  return value;
}

function serviceClient(): ReturnType<typeof createServiceRoleClient> {
  return createServiceRoleClient();
}

async function requireOwner(
  client: ReturnType<typeof createServiceRoleClient>,
  householdId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await client
    .from("household_members")
    .select("role")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.role !== "owner") {
    throw new HttpError(403, "Household owner access is required");
  }
}

async function requireMember(
  client: ReturnType<typeof createServiceRoleClient>,
  householdId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await client
    .from("household_members")
    .select("household_id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(403, "You do not belong to this household");
}

function isoNow(): string {
  return new Date().toISOString();
}

function tokenResponse(row: TokenRow): Record<string, unknown> {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

async function createToken(
  client: ReturnType<typeof createServiceRoleClient>,
  user: User,
  request: TokenCreateRequest,
): Promise<Response> {
  await requireOwner(client, request.householdId, user.id);
  const generated = generateApiKey();
  const hash = await hashApiKey(generated.token);
  const expiresAt = new Date(
    Date.now() + request.expiresInDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await client
    .from("api_tokens")
    .insert({
      household_id: request.householdId,
      created_by: user.id,
      name: request.name,
      token_prefix: generated.token.slice(0, TOKEN_PREFIX_LENGTH),
      token_hash: hash,
      scopes: ["household:read", "bills:read"],
      expires_at: expiresAt,
    })
    .select(
      "id, household_id, name, token_prefix, scopes, expires_at, revoked_at, last_used_at, created_at",
    )
    .single();
  if (error) throw error;
  return jsonResponse({
    token: generated.token,
    tokenDetails: tokenResponse(data as TokenRow),
    warning: "Store this token now. Harbourline will not show it again.",
  }, 201);
}

async function listTokens(
  client: ReturnType<typeof createServiceRoleClient>,
  user: User,
): Promise<Response> {
  const { data: memberships, error: membershipError } = await client
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .eq("role", "owner");
  if (membershipError) throw membershipError;
  const householdIds = (memberships ?? []).map((
    row: { household_id: string },
  ) => row.household_id);
  if (!householdIds.length) return jsonResponse({ tokens: [] });
  const { data, error } = await client
    .from("api_tokens")
    .select(
      "id, household_id, name, token_prefix, scopes, expires_at, revoked_at, last_used_at, created_at",
    )
    .in("household_id", householdIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return jsonResponse({
    tokens: ((data ?? []) as TokenRow[]).map(tokenResponse),
  });
}

async function revokeToken(
  client: ReturnType<typeof createServiceRoleClient>,
  user: User,
  tokenId: string,
): Promise<Response> {
  const { data: token, error: tokenError } = await client
    .from("api_tokens")
    .select("id, household_id")
    .eq("id", tokenId)
    .maybeSingle();
  if (tokenError) throw tokenError;
  if (!token) throw new HttpError(404, "API token not found");
  await requireOwner(client, token.household_id, user.id);
  const { error } = await client
    .from("api_tokens")
    .update({ revoked_at: isoNow() })
    .eq("id", tokenId)
    .is("revoked_at", null);
  if (error) throw error;
  return jsonResponse({ revoked: true });
}

async function authenticateApiKey(
  client: ReturnType<typeof createServiceRoleClient>,
  request: Request,
): Promise<{ token: TokenRow; scopes: Set<string> }> {
  const authorization = request.headers.get("Authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : (request.headers.get("X-Harbourline-Api-Key") ?? "").trim();
  if (!isApiKey(supplied)) {
    throw new HttpError(401, "A valid Harbourline API key is required");
  }
  const hash = await hashApiKey(supplied);
  const { data, error } = await client
    .from("api_tokens")
    .select(
      "id, household_id, name, token_prefix, scopes, expires_at, revoked_at, last_used_at, created_at",
    )
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) throw error;
  const token = data as TokenRow | null;
  if (
    !token || token.revoked_at ||
    new Date(token.expires_at).getTime() <= Date.now()
  ) {
    throw new HttpError(401, "This Harbourline API key is invalid or expired");
  }
  void client.from("api_tokens").update({ last_used_at: isoNow() }).eq(
    "id",
    token.id,
  );
  return { token, scopes: new Set(token.scopes) };
}

async function loadHousehold(
  client: SupabaseClient,
  householdId: string,
): Promise<{
  household: HouseholdRow;
  budget: BudgetRow;
  currencyMinorUnit: number;
}> {
  const [
    { data: household, error: householdError },
    { data: budget, error: budgetError },
  ] = await Promise.all([
    client.from("households").select("id, name, currency, updated_at").eq(
      "id",
      householdId,
    ).single(),
    client.from("budget_documents").select(
      "household_id, revision, schema_version, state, updated_at",
    ).eq("household_id", householdId).single(),
  ]);
  if (householdError) throw householdError;
  if (budgetError) throw budgetError;
  const householdRow = household as HouseholdRow;
  const { data: currency, error: currencyError } = await client
    .from("currency_catalog")
    .select("minor_unit")
    .eq("code", householdRow.currency)
    .eq("enabled", true)
    .single();
  if (currencyError) throw currencyError;
  return {
    household: householdRow,
    budget: budget as BudgetRow,
    currencyMinorUnit: (currency as CurrencyRow).minor_unit,
  };
}

async function listHouseholds(
  client: SupabaseClient,
  userId: string,
): Promise<Response> {
  const { data: memberships, error: membershipError } = await client
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", userId);
  if (membershipError) throw membershipError;
  const rows = (memberships ?? []) as MembershipRow[];
  if (!rows.length) return jsonResponse({ households: [] });
  const ids = rows.map((row) => row.household_id);
  const [
    { data: households, error: householdError },
    { data: budgets, error: budgetError },
  ] = await Promise.all([
    client.from("households").select("id, name, currency, updated_at").in(
      "id",
      ids,
    ),
    client.from("budget_documents").select("household_id, revision, updated_at")
      .in("household_id", ids),
  ]);
  if (householdError) throw householdError;
  if (budgetError) throw budgetError;
  const householdMap = new Map(
    ((households ?? []) as unknown as HouseholdRow[]).map((
      row,
    ) => [row.id, row]),
  );
  const budgetMap = new Map(
    ((budgets ?? []) as unknown as Pick<
      BudgetRow,
      "household_id" | "revision" | "updated_at"
    >[])
      .map((row) => [row.household_id, row]),
  );
  return jsonResponse({
    households: rows.flatMap((membership) => {
      const household = householdMap.get(membership.household_id);
      if (!household) return [];
      const budget = budgetMap.get(membership.household_id);
      return [{
        id: household.id,
        name: household.name,
        currency: household.currency,
        role: membership.role,
        revision: Number(budget?.revision ?? 0),
        updatedAt: budget?.updated_at ?? household.updated_at,
      }];
    }),
  });
}

async function getBills(
  client: SupabaseClient,
  householdId: string,
  query: BillsQuery,
): Promise<Response> {
  const { household, budget, currencyMinorUnit } = await loadHousehold(
    client,
    householdId,
  );
  const bills = filterBills(
    projectBills(budget.state, household.currency, currencyMinorUnit),
    query,
  );
  return jsonResponse({
    household: {
      id: household.id,
      name: household.name,
      currency: household.currency,
      revision: Number(budget.revision),
      updatedAt: budget.updated_at,
    },
    bills,
  });
}

async function getStatus(
  client: SupabaseClient,
  householdId: string,
): Promise<Response> {
  const { household, budget, currencyMinorUnit } = await loadHousehold(
    client,
    householdId,
  );
  const bills = projectBills(
    budget.state,
    household.currency,
    currencyMinorUnit,
  );
  return jsonResponse({
    household: {
      id: household.id,
      name: household.name,
      currency: household.currency,
      revision: Number(budget.revision),
      updatedAt: budget.updated_at,
    },
    counts: { bills: bills.length },
    readOnly: true,
  });
}

async function handleApiKeyRequest(
  request: Request,
  route: ApiRoute,
  client: ReturnType<typeof createServiceRoleClient>,
): Promise<Response> {
  requireMethod(request, "GET");
  const auth = await authenticateApiKey(client, request);
  if (route.resource === "households") {
    throw new HttpError(400, "API keys must be bound to a household resource");
  }
  if (route.resource === "tokens" || route.resource === "token") {
    throw new HttpError(
      403,
      "API key token management is not available with an API key",
    );
  }
  if (route.householdId !== auth.token.household_id) {
    throw new HttpError(
      403,
      "This API key is not authorised for that household",
    );
  }
  if (route.resource === "bills" && !auth.scopes.has("bills:read")) {
    throw new HttpError(403, "This API key does not include bills:read");
  }
  if (route.resource === "status" && !auth.scopes.has("household:read")) {
    throw new HttpError(403, "This API key does not include household:read");
  }
  if (route.resource === "bills") {
    return getBills(client, route.householdId, parseQuery(request));
  }
  return getStatus(client, route.householdId);
}

async function handleUserRequest(
  request: Request,
  route: ApiRoute,
  user: User,
  client: ReturnType<typeof createServiceRoleClient>,
): Promise<Response> {
  requireMethod(request, "GET", "POST", "DELETE");
  if (route.resource === "tokens") {
    if (request.method === "GET") return listTokens(client, user);
    if (request.method !== "POST") {
      throw new HttpError(405, "Method not allowed");
    }
    const body = await request.json().catch(() => null);
    return createToken(client, user, parseTokenBody(body));
  }
  if (route.resource === "token") {
    if (request.method !== "DELETE") {
      throw new HttpError(405, "Method not allowed");
    }
    return revokeToken(client, user, route.tokenId);
  }
  if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
  if (route.resource === "households") return listHouseholds(client, user.id);
  await requireMember(client, route.householdId, user.id);
  if (route.resource === "bills") {
    return getBills(client, route.householdId, parseQuery(request));
  }
  return getStatus(client, route.householdId);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: API_CORS_HEADERS });
  }
  try {
    const route = parseRoute(request);
    const client = serviceClient();
    const authorization = request.headers.get("Authorization") ?? "";
    const apiKeyHeader = request.headers.get("X-Harbourline-Api-Key") ?? "";
    if (
      isApiKey(
        authorization.startsWith("Bearer ")
          ? authorization.slice(7).trim()
          : apiKeyHeader.trim(),
      )
    ) {
      return withApiCors(await handleApiKeyRequest(request, route, client));
    }
    const user = await requireAuthenticatedUser(request);
    return withApiCors(await handleUserRequest(request, route, user, client));
  } catch (error) {
    return withApiCors(errorResponse(error));
  }
});
